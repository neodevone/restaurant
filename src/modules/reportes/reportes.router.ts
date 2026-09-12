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
  getCanales,
  getMeseros,
  getDetalleMesero,
  getProductos,
  getBuscarPedidos,
  getDetallePedido,
  getResumenHoy,
} from './reportes.controller';

export const reportesRouter = Router();

reportesRouter.use(authMiddleware);

// El cajero solo puede buscar un pedido puntual (p. ej. para resolver un
// reclamo). Ventas por período, meseros, productos, métodos de pago y
// canales son cifras del negocio completo: eso queda para el dueño.
const soloAdmin = requireRol('Administrador');
const rolesPedidos = requireRol('Administrador', 'Cajero');

// ── Portada ──────────────────────────────────────────
// GET /reportes/resumen?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
reportesRouter.get('/resumen', soloAdmin, getResumenPeriodo);

// GET /reportes/hoy
reportesRouter.get('/hoy', soloAdmin, getResumenHoy);

// ── Ventas ───────────────────────────────────────────
reportesRouter.get('/ventas/dias', soloAdmin, getVentasPorDia);
reportesRouter.get('/ventas/horas', soloAdmin, getVentasPorHora);
reportesRouter.get('/ventas/diarias', soloAdmin, getVentasDiarias);
reportesRouter.get('/ventas/mensuales', soloAdmin, getVentasMensuales);
reportesRouter.get('/ventas/anuales', soloAdmin, getVentasAnuales);

// ── Métodos de pago ──────────────────────────────────
reportesRouter.get('/metodos-pago', soloAdmin, getMetodosPago);

// ── Canales de venta: Mesa / Para Llevar / Domicilio ─
reportesRouter.get('/canales', soloAdmin, getCanales);

// ── Meseros ──────────────────────────────────────────
reportesRouter.get('/meseros', soloAdmin, getMeseros);
reportesRouter.get('/meseros/:id/pedidos', soloAdmin, getDetalleMesero);

// ── Productos ─────────────────────────────────────────
reportesRouter.get('/productos', soloAdmin, getProductos);

// ── Pedidos ───────────────────────────────────────────
// El listado va antes que '/pedidos/:id' para que no lo capture.
reportesRouter.get('/pedidos', rolesPedidos, getBuscarPedidos);
reportesRouter.get('/pedidos/:id', rolesPedidos, getDetallePedido);