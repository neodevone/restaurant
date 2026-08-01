// src/modules/turnos/turnos.router.ts

import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { requireAdmin, requireRol } from '../../middlewares/rol.middleware';
import {
  getTurnoActivo, getTurno, getTurnos,
  postAbrirTurno, postCerrarTurno,
  getArqueo, getResumenTurno,
  getTiposMovimiento, getMovimientos,
  postMovimiento, postAnularMovimiento
} from './turnos.controller';

export const turnosRouter = Router();

turnosRouter.use(authMiddleware);

const rolesCaja = requireRol('Administrador', 'Cajero');

// ── Rutas fijas primero, para que '/:id' no las capture ──

// Turno abierto en este momento. La caja es una sola, así que
// no depende del usuario que pregunte.
turnosRouter.get('/activo', rolesCaja, getTurnoActivo);

// Tipos de movimiento válidos, para armar el formulario
turnosRouter.get('/tipos-movimiento', rolesCaja, getTiposMovimiento);

// Historial — ?desde=&hasta=&estado=Cerrado
turnosRouter.get('/', rolesCaja, getTurnos);

// Abrir caja
turnosRouter.post('/abrir', rolesCaja, postAbrirTurno);

// Anular un movimiento ya registrado
turnosRouter.post('/movimientos/:movimientoID/anular',
  rolesCaja, postAnularMovimiento);

// ── Rutas por turno ──────────────────────────────────

turnosRouter.get('/:id', rolesCaja, getTurno);

// Arqueo en vivo: cuánto debería haber en el cajón ahora mismo
turnosRouter.get('/:id/arqueo', rolesCaja, getArqueo);

// Resumen de cierre: totales, métodos, movimientos y top productos
turnosRouter.get('/:id/resumen', rolesCaja, getResumenTurno);

// Movimientos de caja del turno
turnosRouter.get('/:id/movimientos', rolesCaja, getMovimientos);
turnosRouter.post('/:id/movimientos', rolesCaja, postMovimiento);

// Cerrar caja con el conteo físico
turnosRouter.post('/:id/cerrar', rolesCaja, postCerrarTurno);