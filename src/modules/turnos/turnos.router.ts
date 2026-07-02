// src/modules/turnos/turnos.router.ts

import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { requireAdmin, requireRol } from '../../middlewares/rol.middleware';
import {
  getTurnoActivo, getTurno, getTurnos,
  postAbrirTurno, postCerrarTurno, getResumenTurno
} from './turnos.controller';

export const turnosRouter = Router();

turnosRouter.use(authMiddleware);

// Turno activo del usuario autenticado
turnosRouter.get('/activo',
  requireRol('Administrador', 'Cajero'),
  getTurnoActivo
);

// Historial — ?fecha=2026-02-26
turnosRouter.get('/',
  requireRol('Administrador', 'Cajero'),
  getTurnos
);

turnosRouter.get('/:id',
  requireRol('Administrador', 'Cajero'),
  getTurno
);

// Reporte de cierre — top artículos, totales por método de pago
turnosRouter.get('/:id/resumen',
  requireRol('Administrador', 'Cajero'),
  getResumenTurno
);

turnosRouter.post('/abrir',
  requireRol('Administrador', 'Cajero'),
  postAbrirTurno
);

turnosRouter.post('/:id/cerrar',
  requireRol('Administrador', 'Cajero'),
  postCerrarTurno
);