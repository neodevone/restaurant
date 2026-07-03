// src/modules/mesas/mesas.router.ts

import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { requireAdmin, requireRol } from '../../middlewares/rol.middleware';
import {
  getZonas, postZona, patchZonaToggle,
  getMesas, getMesa, postMesa,
  patchMesa, patchEstadoMesa, patchMesaToggle, patchPosicionMesa
} from './mesas.controller';

export const mesasRouter = Router();

mesasRouter.use(authMiddleware);

// ── Zonas ─────────────────────────────────────────────
mesasRouter.get( '/zonas',             requireRol('Administrador', 'Mesero', 'Cajero'), getZonas);
mesasRouter.post('/zonas',             requireAdmin, postZona);
mesasRouter.patch('/zonas/:id/toggle', requireAdmin, patchZonaToggle);

// ── Mesas ─────────────────────────────────────────────
// ?conPedido=true  → mapa visual con info del pedido activo
// ?zonaID=xxx      → filtrar por zona
mesasRouter.get( '/',               requireRol('Administrador', 'Mesero', 'Cajero'), getMesas);
mesasRouter.get( '/:id',            requireRol('Administrador', 'Mesero', 'Cajero'), getMesa);
mesasRouter.post('/',               requireAdmin, postMesa);
mesasRouter.patch('/:id',           requireAdmin, patchMesa);
mesasRouter.patch('/:id/toggle',    requireAdmin, patchMesaToggle);

// Estado — mesero y cajero pueden cambiar estado en operación
mesasRouter.patch('/:id/estado',
  requireRol('Administrador', 'Mesero', 'Cajero'),
  patchEstadoMesa
);

// Guardar posición desde el editor visual
mesasRouter.patch('/:id/posicion',
  requireRol('Administrador', 'Cajero'),
  patchPosicionMesa
);