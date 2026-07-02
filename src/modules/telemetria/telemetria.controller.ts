// src/modules/telemetria/telemetria.controller.ts

import { Request, Response, NextFunction } from 'express';
import { respond } from '../../shared/response.helper';
import {
  obtenerMetricasHoy, ventasPorHora, rendimientoPorMesero,
  topArticulos, ventasPorMetodo, estadoMesas,
  alertasKDS, comparativoSemanal, dashboardCompleto
} from './telemetria.service';

export async function getDashboard(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const fecha = req.query.fecha as string | undefined;
    const data  = await dashboardCompleto(fecha);
    respond.ok(res, data);
  } catch (err) { next(err); }
}

export async function getMetricasHoy(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await obtenerMetricasHoy();
    respond.ok(res, data);
  } catch (err) { next(err); }
}

export async function getVentasPorHora(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const fecha = req.query.fecha as string | undefined;
    const data  = await ventasPorHora(fecha);
    respond.ok(res, data);
  } catch (err) { next(err); }
}

export async function getRendimientoMeseros(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const fecha = req.query.fecha as string | undefined;
    const data  = await rendimientoPorMesero(fecha);
    respond.ok(res, data);
  } catch (err) { next(err); }
}

export async function getTopArticulos(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const fecha = req.query.fecha as string | undefined;
    const top   = req.query.top ? parseInt(req.query.top as string) : 10;
    const data  = await topArticulos(fecha, top);
    respond.ok(res, data);
  } catch (err) { next(err); }
}

export async function getVentasPorMetodo(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const fecha = req.query.fecha as string | undefined;
    const data  = await ventasPorMetodo(fecha);
    respond.ok(res, data);
  } catch (err) { next(err); }
}

export async function getEstadoMesas(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await estadoMesas();
    respond.ok(res, data);
  } catch (err) { next(err); }
}

export async function getAlertasKDS(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await alertasKDS();
    respond.ok(res, data);
  } catch (err) { next(err); }
}

export async function getComparativoSemanal(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await comparativoSemanal();
    respond.ok(res, data);
  } catch (err) { next(err); }
}