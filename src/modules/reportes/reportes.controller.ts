// src/modules/reportes/reportes.controller.ts

import { Request, Response, NextFunction } from 'express';
import {
  reporteVentasDiarias,
  reporteVentasMensuales,
  reporteVentasAnuales,
  reporteMeseros,
  detallePedidosMesero,
  reporteProductos,
  resumenTurno,
  resumenHoy,
} from './reportes.service';

// ── Helper para fechas ───────────────────────────────

function getFiltroFecha(req: Request) {
  const hoy   = new Date().toISOString().split('T')[0];
  const desde = (req.query.desde as string) ?? hoy;
  const hasta = (req.query.hasta as string) ?? hoy;
  return { desde, hasta };
}

// ── Ventas ───────────────────────────────────────────

// GET /reportes/ventas/diarias?desde=2026-01-01&hasta=2026-01-31
export async function getVentasDiarias(req: Request, res: Response, next: NextFunction) {
  try {
    const filtro = getFiltroFecha(req);
    const data   = await reporteVentasDiarias(filtro);
    res.json({ ok: true, filtro, data });
  } catch (err) {
    next(err);
  }
}

// GET /reportes/ventas/mensuales?anio=2026
export async function getVentasMensuales(req: Request, res: Response, next: NextFunction) {
  try {
    const anio = parseInt(req.query.anio as string) || new Date().getFullYear();
    const data  = await reporteVentasMensuales(anio);
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

// ── Meseros ──────────────────────────────────────────

// GET /reportes/meseros?desde=2026-01-01&hasta=2026-01-31
export async function getMeseros(req: Request, res: Response, next: NextFunction) {
  try {
    const filtro = getFiltroFecha(req);
    const data   = await reporteMeseros(filtro);
    res.json({ ok: true, filtro, data });
  } catch (err) {
    next(err);
  }
}

// GET /reportes/meseros/:id/pedidos?desde=&hasta=
export async function getDetalleMesero(req: Request, res: Response, next: NextFunction) {
  try {
    const filtro = getFiltroFecha(req);
    const data   = await detallePedidosMesero(req.params.id as string, filtro);
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
    const data   = await reporteProductos(filtro);
    res.json({ ok: true, filtro, data });
  } catch (err) {
    next(err);
  }
}

// ── Turno ─────────────────────────────────────────────

// GET /reportes/turno/:id
export async function getResumenTurno(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await resumenTurno(req.params.id as string);
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
}

// ── Resumen hoy (dashboard Windows Forms) ────────────

// GET /reportes/hoy
export async function getResumenHoy(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await resumenHoy();
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
}