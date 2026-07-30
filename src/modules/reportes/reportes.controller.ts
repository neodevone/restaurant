// src/modules/reportes/reportes.controller.ts

import { Request, Response, NextFunction } from 'express';
import {
  reporteVentasDiarias,
  reporteVentasMensuales,
  reporteVentasAnuales,
  reporteMeseros,
  detallePedidosMesero,
  reporteProductos,
  resumenHoy,
  resumenPeriodo,
  ventasPorDia,
  ventasPorHora,
  reporteMetodosPago,
  buscarPedidos,
  detalleCompletoPedido,
} from './reportes.service';

// ── Helper para fechas ───────────────────────────────

function getFiltroFecha(req: Request) {
  const hoy = new Date().toISOString().split('T')[0];
  const desde = (req.query.desde as string) ?? hoy;
  const hasta = (req.query.hasta as string) ?? hoy;
  return { desde, hasta };
}

// ── Resumen de período (portada) ─────────────────────

// GET /reportes/resumen?desde=&hasta=
export async function getResumenPeriodo(req: Request, res: Response, next: NextFunction) {
  try {
    const filtro = getFiltroFecha(req);
    const data = await resumenPeriodo(filtro);
    res.json({ ok: true, filtro, data });
  } catch (err) {
    next(err);
  }
}

// ── Ventas ───────────────────────────────────────────

// GET /reportes/ventas/dias?desde=&hasta=
export async function getVentasPorDia(req: Request, res: Response, next: NextFunction) {
  try {
    const filtro = getFiltroFecha(req);
    const data = await ventasPorDia(filtro);
    res.json({ ok: true, filtro, data });
  } catch (err) {
    next(err);
  }
}

// GET /reportes/ventas/horas?desde=&hasta=
export async function getVentasPorHora(req: Request, res: Response, next: NextFunction) {
  try {
    const filtro = getFiltroFecha(req);
    const data = await ventasPorHora(filtro);
    res.json({ ok: true, filtro, data });
  } catch (err) {
    next(err);
  }
}

// GET /reportes/ventas/diarias?desde=&hasta=   (compatibilidad)
export async function getVentasDiarias(req: Request, res: Response, next: NextFunction) {
  try {
    const filtro = getFiltroFecha(req);
    const data = await reporteVentasDiarias(filtro);
    res.json({ ok: true, filtro, data });
  } catch (err) {
    next(err);
  }
}

// GET /reportes/ventas/mensuales?anio=2026
export async function getVentasMensuales(req: Request, res: Response, next: NextFunction) {
  try {
    const anio = parseInt(req.query.anio as string) || new Date().getFullYear();
    const data = await reporteVentasMensuales(anio);
    res.json({ ok: true, anio, data });
  } catch (err) {
    next(err);
  }
}

// GET /reportes/ventas/anuales
export async function getVentasAnuales(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await reporteVentasAnuales();
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
}

// ── Métodos de pago ──────────────────────────────────

// GET /reportes/metodos-pago?desde=&hasta=
export async function getMetodosPago(req: Request, res: Response, next: NextFunction) {
  try {
    const filtro = getFiltroFecha(req);
    const data = await reporteMetodosPago(filtro);
    res.json({ ok: true, filtro, data });
  } catch (err) {
    next(err);
  }
}

// ── Meseros ──────────────────────────────────────────

// GET /reportes/meseros?desde=&hasta=
export async function getMeseros(req: Request, res: Response, next: NextFunction) {
  try {
    const filtro = getFiltroFecha(req);
    const data = await reporteMeseros(filtro);
    res.json({ ok: true, filtro, data });
  } catch (err) {
    next(err);
  }
}

// GET /reportes/meseros/:id/pedidos?desde=&hasta=
export async function getDetalleMesero(req: Request, res: Response, next: NextFunction) {
  try {
    const filtro = getFiltroFecha(req);
    const data = await detallePedidosMesero(req.params.id as string, filtro);
    res.json({ ok: true, filtro, data });
  } catch (err) {
    next(err);
  }
}

// ── Productos ─────────────────────────────────────────

// GET /reportes/productos?desde=&hasta=
export async function getProductos(req: Request, res: Response, next: NextFunction) {
  try {
    const filtro = getFiltroFecha(req);
    const data = await reporteProductos(filtro);
    res.json({ ok: true, filtro, data });
  } catch (err) {
    next(err);
  }
}

// ── Pedidos: búsqueda y detalle ──────────────────────

// GET /reportes/pedidos?desde=&hasta=&texto=&estado=&limite=
export async function getBuscarPedidos(req: Request, res: Response, next: NextFunction) {
  try {
    const filtro = getFiltroFecha(req);
    const data = await buscarPedidos({
      desde: filtro.desde,
      hasta: filtro.hasta,
      texto: req.query.texto as string | undefined,
      estado: req.query.estado as string | undefined,
      limite: req.query.limite ? parseInt(req.query.limite as string) : undefined,
    });
    res.json({ ok: true, filtro, data });
  } catch (err) {
    next(err);
  }
}

// GET /reportes/pedidos/:id
export async function getDetallePedido(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await detalleCompletoPedido(req.params.id as string);
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
}

// ── Resumen hoy (dashboard) ──────────────────────────

// GET /reportes/hoy
export async function getResumenHoy(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await resumenHoy();
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
}