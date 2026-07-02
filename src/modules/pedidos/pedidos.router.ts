// src/modules/pedidos/pedidos.router.ts

import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { requireAdmin, requireRol } from '../../middlewares/rol.middleware';
import {
  getPedidos, getPedido, getDetallePedido,
  postAbrirPedido, postAgregarRonda,
  postSolicitarCuenta, postCancelarPedido
} from './pedidos.controller';

export const pedidosRouter = Router();

pedidosRouter.use(authMiddleware);

// Listar — con filtros opcionales
// ?estado=Abierto  ?mesaID=xxx  ?turnoID=xxx  ?fecha=2026-02-26
pedidosRouter.get('/',
  requireRol('Administrador', 'Mesero', 'Cajero'),
  getPedidos
);

pedidosRouter.get('/:id',
  requireRol('Administrador', 'Mesero', 'Cajero'),
  getPedido
);

// Detalle completo con todos los ítems del pedido
pedidosRouter.get('/:id/detalle',
  requireRol('Administrador', 'Mesero', 'Cajero'),
  getDetallePedido
);

// Abrir pedido — mesero selecciona mesa y manda primera comanda
pedidosRouter.post('/',
  requireRol('Administrador', 'Mesero'),
  postAbrirPedido
);

// Nueva ronda — cliente pide más sin cancelar lo anterior
pedidosRouter.post('/:id/ronda',
  requireRol('Administrador', 'Mesero'),
  postAgregarRonda
);

// Solicitar cuenta — mesa pasa a "Por Pagar"
pedidosRouter.post('/:id/solicitar-cuenta',
  requireRol('Administrador', 'Mesero'),
  postSolicitarCuenta
);

// Cancelar — solo admin o mesero con pedido no pagado
pedidosRouter.post('/:id/cancelar',
  requireRol('Administrador', 'Mesero'),
  postCancelarPedido
);