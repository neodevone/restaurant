// src/modules/pedidos/pedidos.router.ts

import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { requireAdmin, requireRol } from '../../middlewares/rol.middleware';
import {
  getPedidos, getPedido, getDetallePedido,
  postAbrirPedido, postAgregarRonda,
  postSolicitarCuenta, postCancelarPedido,
  postCancelarItem, getItemsCancelados, getMotivosAnulacion
} from './pedidos.controller';

export const pedidosRouter = Router();

pedidosRouter.use(authMiddleware);

// Motivos disponibles para anular un artículo.
// Va antes de '/:id' para que la ruta genérica no lo capture.
pedidosRouter.get('/motivos-anulacion',
  requireRol('Administrador', 'Mesero', 'Cajero'),
  getMotivosAnulacion
);

// Listar — con filtros opcionales
// ?estado=Abierto  ?mesaID=xxx  ?fecha=2026-02-26
pedidosRouter.get('/',
  requireRol('Administrador', 'Mesero', 'Cajero'),
  getPedidos
);

pedidosRouter.get('/:id',
  requireRol('Administrador', 'Mesero', 'Cajero'),
  getPedido
);

// Detalle vigente del pedido — excluye artículos cancelados
pedidosRouter.get('/:id/detalle',
  requireRol('Administrador', 'Mesero', 'Cajero'),
  getDetallePedido
);

// Artículos que fueron retirados de este pedido
pedidosRouter.get('/:id/items-cancelados',
  requireRol('Administrador', 'Mesero', 'Cajero'),
  getItemsCancelados
);

// Abrir pedido — el mesero desde la mesa, el cajero desde el mostrador
pedidosRouter.post('/',
  requireRol('Administrador', 'Mesero', 'Cajero'),
  postAbrirPedido
);

// Nueva ronda — cliente pide más sin cancelar lo anterior
pedidosRouter.post('/:id/ronda',
  requireRol('Administrador', 'Mesero', 'Cajero'),
  postAgregarRonda
);

// Quitar un artículo del pedido.
// El cajero también puede: un plato en mal estado o un ítem de más
// se resuelve en la caja, con el cliente enfrente.
// Queda registrado con el usuario, el motivo y la hora.
pedidosRouter.post('/:id/items/:detalleID/cancelar',
  requireRol('Administrador', 'Mesero', 'Cajero'),
  postCancelarItem
);

// Solicitar cuenta — mesa pasa a "Por Pagar"
pedidosRouter.post('/:id/solicitar-cuenta',
  requireRol('Administrador', 'Mesero', 'Cajero'),
  postSolicitarCuenta
);

// Cancelar el pedido completo. El cajero lo necesita para descartar
// una venta de mostrador que el cliente abandonó antes de pagar.
pedidosRouter.post('/:id/cancelar',
  requireRol('Administrador', 'Mesero', 'Cajero'),
  postCancelarPedido
);