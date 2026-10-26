// Configuration is read from the environment only. No external service
// endpoints are configured here: the system is self-hosted (blueprint §1).
export interface AppConfig {
  port: number;
  databaseUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  return {
    port: Number(env.PORT ?? 3000),
    databaseUrl,
  };
}
