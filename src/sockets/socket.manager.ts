// src/sockets/socket.manager.ts

import { Server as HttpServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import { env } from '../config/environment';

// Rooms (canales) del sistema
export const ROOMS = {
  COCINA:     'cocina',       // KDS — ve comandas en tiempo real
  CAJA:       'caja',         // Ve pagos y cierres
  SALA:       'sala',         // Meseros — ve estado de mesas
  ADMIN:      'admin',        // Dashboard del dueño
} as const;

// Eventos que viajan por WebSocket
export const EVENTOS_SOCKET = {
  // Mesas
  MESA_ACTUALIZADA:     'mesa:actualizada',
  // Comandas / KDS
  COMANDA_NUEVA:        'comanda:nueva',
  COMANDA_ACTUALIZADA:  'comanda:actualizada',
  COMANDA_LISTA:        'comanda:lista',
  ALERTA_KDS:           'comanda:alerta_kds',
  // Pedidos
  PEDIDO_ACTUALIZADO:   'pedido:actualizado',
  // Pagos
  PAGO_RECIBIDO:        'pago:recibido',
  // Telemetría
  METRICAS_ACTUALIZADAS: 'telemetria:metricas',
} as const;

let io: SocketServer | null = null;

export function initSocket(server: HttpServer): SocketServer {
  io = new SocketServer(server, {
    cors: {
      origin: env.socket.corsOrigin,
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket: Socket) => {
    console.log(`🔌 Cliente conectado: ${socket.id}`);

    // El cliente se une a su room según su rol
    socket.on('join:room', (room: string) => {
      socket.join(room);
      console.log(`📡 ${socket.id} se unió a: ${room}`);
    });

    socket.on('disconnect', () => {
      console.log(`🔌 Cliente desconectado: ${socket.id}`);
    });
  });

  return io;
}

// Función que usan los servicios para emitir eventos
export function emitirEvento(
  room: string,
  evento: string,
  data: unknown
): void {
  if (!io) {
    console.warn('⚠️ Socket no inicializado');
    return;
  }
  io.to(room).emit(evento, data);
}

// Emitir a múltiples rooms a la vez
export function emitirEventoMultiple(
  rooms: string[],
  evento: string,
  data: unknown
): void {
  rooms.forEach(room => emitirEvento(room, evento, data));
}

export function getIO(): SocketServer {
  if (!io) throw new Error('Socket no inicializado');
  return io;
}