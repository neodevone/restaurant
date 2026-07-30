// src/modules/reportes/reportes.router.ts

import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { requireRol } from '../../middlewares/rol.middleware';
import {
  getResumenPeriodo,
  getVentasPorDia,
  getVentasPorHora,
  getVentasDiarias,
  getVentasMensuales,
  getVentasAnuales,
  getMetodosPago,
  getMeseros,
  getDetalleMesero,
  getProductos,
  getBuscarPedidos,
  getDetallePedido,
  getResumenHoy,
} from './reportes.controller';

export const reportesRouter = Router();

reportesRouter.use(authMiddleware);

const rolesReporte = requireRol('Administrador', 'Cajero');

// ── Portada ──────────────────────────────────────────
// GET /reportes/resumen?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
reportesRouter.get('/resumen', rolesReporte, getResumenPeriodo);

// GET /reportes/hoy
reportesRouter.get('/hoy', rolesReporte, getResumenHoy);

// ── Ventas ───────────────────────────────────────────
reportesRouter.get('/ventas/dias', rolesReporte, getVentasPorDia);
reportesRouter.get('/ventas/horas', rolesReporte, getVentasPorHora);
reportesRouter.get('/ventas/diarias', rolesReporte, getVentasDiarias);
reportesRouter.get('/ventas/mensuales', rolesReporte, getVentasMensuales);
reportesRouter.get('/ventas/anuales', rolesReporte, getVentasAnuales);

// ── Métodos de pago ──────────────────────────────────
reportesRouter.get('/metodos-pago', rolesReporte, getMetodosPago);

// ── Meseros ──────────────────────────────────────────
reportesRouter.get('/meseros', rolesReporte, getMeseros);
reportesRouter.get('/meseros/:id/pedidos', rolesReporte, getDetalleMesero);

// ── Productos ─────────────────────────────────────────
reportesRouter.get('/productos', rolesReporte, getProductos);

// ── Pedidos ───────────────────────────────────────────
// El listado va antes que '/pedidos/:id' para que no lo capture.
reportesRouter.get('/pedidos', rolesReporte, getBuscarPedidos);
reportesRouter.get('/pedidos/:id', rolesReporte, getDetallePedido);