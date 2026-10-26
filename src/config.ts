// Configuration is read from the environment only. No external service
// endpoints are configured here: the system is self-hosted (blueprint §1).
export interface AppConfig {
  port: number;
  databaseUrl: string;
  jwt: JwtConfig;
}

export interface JwtConfig {
  // PEM (SPKI) public key of the internal identity provider (Keycloak realm
  // key). Tokens are verified locally; no network call is made.
  publicKey: string;
  issuer: string;
  audience: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: Number(env.PORT ?? 3000),
    databaseUrl: required(env, 'DATABASE_URL'),
    jwt: {
      publicKey: required(env, 'JWT_PUBLIC_KEY').replace(/\\n/g, '\n'),
      issuer: required(env, 'JWT_ISSUER'),
      audience: required(env, 'JWT_AUDIENCE'),
    },
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}
