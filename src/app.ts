// src/app.ts

import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';

import { env } from './config/environment';
import { getPool } from './config/database';
import { initSocket } from './sockets/socket.manager';
import { errorMiddleware } from './middlewares/error.middleware';


// ── Routers (los iremos agregando módulo a módulo) ──
import { authRouter }     from './modules/auth/auth.router';
import { usuariosRouter } from './modules/usuarios/usuarios.router';
import { mesasRouter }    from './modules/mesas/mesas.router';
import { pedidosRouter }  from './modules/pedidos/pedidos.router';
import { comandasRouter } from './modules/comandas/comandas.router';
import { articulosRouter } from './modules/articulos/articulos.router';
import { pagosRouter }    from './modules/pagos/pagos.router';
import { turnosRouter }   from './modules/turnos/turnos.router';
import { telemetriaRouter } from './modules/telemetria/telemetria.router';
import { reportesRouter } from './modules/reportes/reportes.router';

const app = express();
const httpServer = createServer(app);

// ── Seguridad ────────────────────────────────────────
app.use(helmet());

app.use(cors({
  origin: env.socket.corsOrigin,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use('/imagenes', express.static(path.join(__dirname, '../public/imagenes')));

// Rate limiting — máximo 200 requests por IP cada 10 minutos
const limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 200,
  message: { success: false, message: 'Demasiadas solicitudes, intenta más tarde' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', limiter);

// ── Parsers ──────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Health check (no requiere auth) ─────────────────
app.get('/health', (_req, res) => {
  res.json({
    success: true,
    message: 'API Restaurante funcionando',
    timestamp: new Date().toISOString(),
    environment: env.nodeEnv,
  });
});

app.get('/api/status', (_req, res) => {
  res.json({
    success: true,  
    message: 'API Restaurante operativa',
    timestamp: new Date().toISOString(),
    environment: env.nodeEnv,
  });
});

// ── Rutas de la API ──────────────────────────────────
// Se van descomentando conforme creamos cada módulo
app.use('/api/auth', authRouter);
app.use('/api/usuarios', usuariosRouter);
app.use('/api/mesas', mesasRouter);
app.use('/api/pedidos', pedidosRouter);
app.use('/api/comandas', comandasRouter);
app.use('/api/articulos', articulosRouter);
app.use('/api/pagos', pagosRouter);
app.use('/api/turnos',turnosRouter);
app.use('/api/telemetria', telemetriaRouter);
app.use('/api/reportes', reportesRouter);

// ── 404 para rutas no encontradas ───────────────────
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    message: 'Ruta no encontrada',
  });
});

// ── Middleware global de errores (siempre al final) ──
app.use(errorMiddleware);



// ── Arranque del servidor ────────────────────────────
async function bootstrap(): Promise<void> {
  try {
    // 1. Conectar a BD antes de aceptar requests
    await getPool();

    // 2. Inicializar WebSocket
    initSocket(httpServer);
    console.log('✅ WebSocket inicializado');

    // 3. Levantar servidor HTTP
    httpServer.listen(env.port, () => {
      console.log('');
      console.log('🍽️  API Restaurante POS');
      console.log(`🚀 Servidor corriendo en http://localhost:${env.port}`);
      console.log(`🔌 WebSocket activo en puerto ${env.port}`);
      console.log(`🌍 Entorno: ${env.nodeEnv}`);
      console.log(`❤️  Health: http://localhost:${env.port}/health`);
      console.log('');
    });

  } catch (error) {
    console.error('❌ Error al iniciar el servidor:', error);
    process.exit(1); // Si no hay BD, el servidor no debe arrancar
  }
}

// Manejo de errores no capturados — evita que el proceso muera silenciosamente
process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

bootstrap();