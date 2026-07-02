// src/config/environment.ts

interface Environment {
  port: number;
  nodeEnv: string;
  db: {
    server: string;
    name: string;
    user: string;
    password: string;
    port: number;
  };
  jwt: {
    secret: string;
    expiresIn: string;
  };
  socket: {
    corsOrigin: string;
  };
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`❌ Variable de entorno requerida no encontrada: ${key}`);
  }
  return value;
}

export const env: Environment = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  db: {
    server:   requireEnv('DB_SERVER'),
    name:     requireEnv('DB_NAME'),
    user:     requireEnv('DB_USER'),
    password: requireEnv('DB_PASSWORD'),
    port:     parseInt(process.env.DB_PORT || '1433', 10),
  },
  jwt: {
    secret:    requireEnv('JWT_SECRET'),
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  },
  socket: {
    corsOrigin: process.env.SOCKET_CORS_ORIGIN || 'http://localhost:3001',
  },
};