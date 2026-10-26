import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { importSPKI, jwtVerify, KeyLike } from 'jose';
import { loadConfig, JwtConfig } from '../config';

export interface Principal {
  subject: string;
}

export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  principal?: Principal;
}

// Verifies the bearer token issued by the internal identity provider
// (Keycloak, blueprint §10) against its configured public key.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly config: JwtConfig = loadConfig().jwt;
  private key?: Promise<KeyLike>;

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers.authorization;
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) {
      throw new UnauthorizedException();
    }
    this.key ??= importSPKI(this.config.publicKey, 'RS256');
    try {
      const { payload } = await jwtVerify(token, await this.key, {
        issuer: this.config.issuer,
        audience: this.config.audience,
        algorithms: ['RS256'],
      });
      if (!payload.sub) {
        throw new UnauthorizedException();
      }
      req.principal = { subject: payload.sub };
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
