// src/modules/pagos/pagos.router.ts

import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { requireAdmin, requireRol } from '../../middlewares/rol.middleware';
import {
  getMetodosPago, getPago, getResumenPedido,
  getPagosTurno, postRegistrarPago, postAnularPago
} from './pagos.controller';

export const pagosRouter = Router();

pagosRouter.use(authMiddleware);

// Métodos de pago disponibles — para el formulario de cobro
pagosRouter.get('/metodos',
  requireRol('Administrador', 'Cajero', 'Mesero'),
  getMetodosPago
);

// Resumen de pagos de un pedido — cuánto se pagó, cuánto falta
pagosRouter.get('/pedido/:pedidoID',
  requireRol('Administrador', 'Cajero', 'Mesero'),
  getResumenPedido
);

// Pagos de un turno — para el reporte de cierre
pagosRouter.get('/turno/:turnoID',
  requireRol('Administrador', 'Cajero'),
  getPagosTurno
);

pagosRouter.get('/:id',
  requireRol('Administrador', 'Cajero'),
  getPago
);

// Registrar pago — soporta parciales y mixtos
pagosRouter.post('/',
  requireRol('Administrador', 'Cajero'),
  postRegistrarPago
);

// Anular pago — solo admin, queda en historial
pagosRouter.post('/:id/anular',
  requireAdmin,
  postAnularPago
);