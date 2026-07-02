// src/modules/reportes/reportes.router.ts

import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { requireRol } from '../../middlewares/rol.middleware';
import {
    getVentasDiarias,
    getVentasMensuales,
    getVentasAnuales,
    getMeseros,
    getDetalleMesero,
    getProductos,
    getResumenTurno,
    getResumenHoy,
} from './reportes.controller';

export const reportesRouter = Router();

reportesRouter.use(authMiddleware);

// Todos los reportes requieren rol Admin o Cajero
const rolesReporte = requireRol('Administrador', 'Cajero');

// ── Ventas ───────────────────────────────────────────
// GET /reportes/ventas/diarias?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
reportesRouter.get('/ventas/diarias', rolesReporte, getVentasDiarias);

// GET /reportes/ventas/mensuales?anio=2026
reportesRouter.get('/ventas/mensuales', rolesReporte, getVentasMensuales);

// GET /reportes/ventas/anuales
reportesRouter.get('/ventas/anuales', rolesReporte, getVentasAnuales);

// ── Meseros ──────────────────────────────────────────
// GET /reportes/meseros?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
reportesRouter.get('/meseros', rolesReporte, getMeseros);

// GET /reportes/meseros/:id/pedidos?desde=&hasta=
reportesRouter.get('/meseros/:id/pedidos', rolesReporte, getDetalleMesero);

// ── Productos ─────────────────────────────────────────
// GET /reportes/productos?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
reportesRouter.get('/productos', rolesReporte, getProductos);

// ── Turno ─────────────────────────────────────────────
// GET /reportes/turno/:id
reportesRouter.get('/turno/:id', rolesReporte, getResumenTurno);

// ── Resumen del día ───────────────────────────────────
// GET /reportes/hoy
reportesRouter.get('/hoy', rolesReporte, getResumenHoy);