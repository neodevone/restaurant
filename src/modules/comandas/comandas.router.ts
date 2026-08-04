// src/modules/comandas/comandas.router.ts

import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { requireRol } from '../../middlewares/rol.middleware';
import {
  getComanda, getItemsComanda, getHistorialPedido, getPendientesPedido,
  postMarcarDespachada, postMarcarPedidoEntregado
} from './comandas.controller';

export const comandasRouter = Router();

comandasRouter.use(authMiddleware);

const lectura = requireRol('Administrador', 'Mesero', 'Cajero');
// Solo quien atiende la mesa confirma la entrega. El cajero no:
// él no ve si los platos llegaron.
const entrega = requireRol('Administrador', 'Mesero');

// ── Rutas por pedido (van antes de '/:id') ───────────

// Rondas de un pedido, con su hora de entrega
comandasRouter.get('/pedido/:pedidoID', lectura, getHistorialPedido);

// ¿Se puede cobrar ya? El escritorio consulta esto.
comandasRouter.get('/pedido/:pedidoID/pendientes', lectura, getPendientesPedido);

// El mesero entregó todo lo que faltaba del pedido
comandasRouter.post('/pedido/:pedidoID/entregado', entrega, postMarcarPedidoEntregado);

// ── Rutas por comanda ────────────────────────────────

comandasRouter.get('/:id', lectura, getComanda);
comandasRouter.get('/:id/items', lectura, getItemsComanda);

// El mesero entregó una ronda concreta
comandasRouter.post('/:id/despachada', entrega, postMarcarDespachada);