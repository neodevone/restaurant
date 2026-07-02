// src/modules/articulos/articulos.controller.ts
// ── Solo lectura — los artículos se gestionan en el sistema existente ──

import { Request, Response, NextFunction } from 'express';
import { respond } from '../../shared/response.helper';
import { listarCategorias, listarArticulos, obtenerArticulo } from './articulos.service';

// ── Categorías ───────────────────────────────────────

export async function getCategorias(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await listarCategorias();
    respond.ok(res, data);
  } catch (err) { next(err); }
}

// ── Artículos ────────────────────────────────────────

export async function getArticulos(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const soloActivos = req.query.soloActivos !== 'false'; // true por defecto
    const categoriaID = req.query.categoriaID
      ? parseInt(req.query.categoriaID as string)
      : undefined;

    const data = await listarArticulos(soloActivos, categoriaID);
    respond.ok(res, data);
  } catch (err) { next(err); }
}

export async function getArticulo(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) {
      respond.badRequest(res, 'El ID del artículo debe ser un número entero');
      return;
    }
    const data = await obtenerArticulo(id);
    respond.ok(res, data);
  } catch (err) { next(err); }
}