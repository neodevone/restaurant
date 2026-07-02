// src/config/database.ts

import sql, { config as SqlConfig, ConnectionPool } from 'mssql';
import { env } from './environment';

const dbConfig: SqlConfig = {
  server:   env.db.server,
  database: env.db.name,
  user:     env.db.user,
  password: env.db.password,
  port:     env.db.port,
  options: {
    encrypt: false,          // true si usas Azure
    trustServerCertificate: true,
  },
  pool: {
    max: 20,                 // Máximo 20 conexiones simultáneas
    min: 2,                  // Siempre mantiene 2 listas
    idleTimeoutMillis: 30000 // Cierra conexiones inactivas a los 30s
  },
  connectionTimeout: 15000,
  requestTimeout:    15000,
};

console.log('---- DB CONFIG REAL ----');
console.log({
  server: env.db.server,
  database: env.db.name,
  user: env.db.user,
  password: env.db.password,
});
console.log('-------------------------');

// Singleton del pool — una sola instancia en toda la app
let pool: ConnectionPool | null = null;

export async function getPool(): Promise<ConnectionPool> {
  if (pool && pool.connected) return pool;

  try {
    pool = await new ConnectionPool(dbConfig).connect();
    console.log('✅ Conexión a SQL Server establecida');

    pool.on('error', (err) => {
      console.error('❌ Error en el pool de BD:', err);
      pool = null; // Fuerza reconexión en el siguiente request
    });

    return pool;
  } catch (error) {
    console.error('❌ No se pudo conectar a SQL Server:', error);
    throw error;
  }
}

// Helper para ejecutar queries de forma limpia desde cualquier servicio
export async function query<T>(
  queryString: string,
  params?: (req: sql.Request) => void
): Promise<T[]> {
  const connection = await getPool();
  const request = connection.request();

  if (params) params(request); // Aquí se inyectan los parámetros

  const result = await request.query(queryString);
  return result.recordset as T[];
}

export { sql };