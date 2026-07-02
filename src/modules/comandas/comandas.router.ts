// src/modules/comandas/comandas.router.ts

import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { requireRol } from '../../middlewares/rol.middleware';
import {
  getKDS, getComanda, getItemsComanda, getHistorialPedido,
  postMarcarVista, postMarcarEnPreparacion,
  postMarcarLista, postMarcarDespachada,
  patchPrioridad, patchNotaCocina
} from './comandas.controller';

export const comandasRouter = Router();

comandasRouter.use(authMiddleware);

// Vista principal KDS — cocina la consume en tiempo real
comandasRouter.get('/kds',
  requireRol('Administrador', 'Cocina'),
  getKDS
);

// Historial de comandas de un pedido específico
comandasRouter.get('/pedido/:pedidoID',
  requireRol('Administrador', 'Mesero', 'Cajero', 'Cocina'),
  getHistorialPedido
);

comandasRouter.get('/:id',
  requireRol('Administrador', 'Cocina', 'Mesero'),
  getComanda
);

// Ítems de una comanda
comandasRouter.get('/:id/items',
  requireRol('Administrador', 'Cocina', 'Mesero'),
  getItemsComanda
);

// ── Flujo del KDS (transiciones de estado) ───────────
// Pendiente → Vista → En Preparacion → Lista → Despachada

comandasRouter.post('/:id/vista',
  requireRol('Administrador', 'Cocina'),
  postMarcarVista
);

comandasRouter.post('/:id/en-preparacion',
  requireRol('Administrador', 'Cocina'),
  postMarcarEnPreparacion
);

comandasRouter.post('/:id/lista',
  requireRol('Administrador', 'Cocina'),
  postMarcarLista
);

// Despachar — mesero confirma que llevó los platos
comandasRouter.post('/:id/despachada',
  requireRol('Administrador', 'Mesero'),
  postMarcarDespachada
);

// Urgente — sube la comanda al tope del KDS
comandasRouter.patch('/:id/prioridad',
  requireRol('Administrador', 'Cocina', 'Mesero'),
  patchPrioridad
);

// Nota especial a cocina
comandasRouter.patch('/:id/nota',
  requireRol('Administrador', 'Cocina', 'Mesero'),
  patchNotaCocina
);