// src/modules/pagos/pagos.router.ts

import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { requireAdmin, requireRol } from '../../middlewares/rol.middleware';
import {
  getMetodosPago, getPago, getResumenPedido,
  postRegistrarPago, postRegistrarFiado,
  getCuentasPorCobrar, postAnularPago
} from './pagos.controller';

export const pagosRouter = Router();

pagosRouter.use(authMiddleware);

// Métodos de pago disponibles — para el formulario de cobro
pagosRouter.get('/metodos',
  requireRol('Administrador', 'Cajero', 'Mesero'),
  getMetodosPago
);

// Cartera — cuentas por cobrar (?estado=PENDIENTE  ?cedula=123456)
// Va antes de '/:id' para que no lo capture la ruta genérica.
pagosRouter.get('/cuentas-por-cobrar',
  requireRol('Administrador', 'Cajero'),
  getCuentasPorCobrar
);

// Resumen de pagos de un pedido — cuánto se pagó, cuánto falta
pagosRouter.get('/pedido/:pedidoID',
  requireRol('Administrador', 'Cajero', 'Mesero'),
  getResumenPedido
);

pagosRouter.get('/:id',
  requireRol('Administrador', 'Cajero'),
  getPago
);

// Registrar pago — soporta parciales y mixtos.
// También sirve para abonar a una deuda ya existente.
pagosRouter.post('/',
  requireRol('Administrador', 'Cajero'),
  postRegistrarPago
);

// Registrar cuenta por cobrar (fiado) — MontoPagado = 0
pagosRouter.post('/fiado',
  requireRol('Administrador', 'Cajero'),
  postRegistrarFiado
);

// Anular pago — solo admin, queda en historial
pagosRouter.post('/:id/anular',
  requireAdmin,
  postAnularPago
);