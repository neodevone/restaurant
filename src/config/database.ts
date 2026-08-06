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
    max: 20,                 // Máximo 20 conexiones simultáneas por instancia de cluster
    min: 2,                  // Siempre mantiene 2 listas
    idleTimeoutMillis: 30000 // Cierra conexiones inactivas a los 30s
  },
  connectionTimeout: 15000,
  requestTimeout:    15000,
};

// Log de config SIN password — nunca loguear credenciales, ni en desarrollo
console.log('---- DB CONFIG ----');
console.log({
  server: env.db.server,
  database: env.db.name,
  user: env.db.user,
  port: env.db.port,
});
console.log('--------------------');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Singleton del pool — una sola instancia en toda la app.
// Guardamos la PROMESA de conexión (no solo el pool ya resuelto) para evitar
// que varias peticiones concurrentes disparen conexiones duplicadas mientras
// se está reconectando.
let poolPromise: Promise<ConnectionPool> | null = null;

async function createPoolWithRetry({
  maxRetries = 5,
  baseDelayMs = 2000,
}: { maxRetries?: number; baseDelayMs?: number } = {}): Promise<ConnectionPool> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const newPool = await new ConnectionPool(dbConfig).connect();
      console.log(`✅ Conexión a SQL Server establecida (intento ${attempt})`);

      newPool.on('error', (err) => {
        console.error('❌ Error en el pool de BD:', err.message);
        poolPromise = null; // Fuerza reconexión en el siguiente request
      });

      return newPool;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`❌ Intento ${attempt}/${maxRetries} fallido al conectar a SQL Server: ${message}`);

      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1); // backoff exponencial
        console.log(`⏳ Reintentando en ${delay / 1000}s...`);
        await sleep(delay);
      }
    }
  }

  poolPromise = null;
  throw lastError;
}

export async function getPool(): Promise<ConnectionPool> {
  if (!poolPromise) {
    poolPromise = createPoolWithRetry();
  }

  try {
    const pool = await poolPromise;

    // Si el pool quedó en un estado no conectado (ej: cayó justo antes de este request),
    // forzamos una reconexión limpia en vez de devolver un pool muerto.
    if (!pool.connected && !pool.connecting) {
      poolPromise = null;
      return getPool();
    }

    return pool;
  } catch (error) {
    // La promesa ya se limpió dentro de createPoolWithRetry si falló del todo
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