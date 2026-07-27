// src/modules/articulos/articulos.controller.ts
// ── Solo lectura — los artículos se gestionan en el sistema existente ──

import { Request, Response, NextFunction } from 'express';

import { respond } from '../../shared/response.helper';
import { 
  listarCategorias, 
  listarArticulos, 
  obtenerArticulo, 
  guardarImagenArticulo, 
  eliminarImagenArticulo } 
from './articulos.service';

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

// ── Subir imagen ─────────────────────────────────────
 
export async function postImagen(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) {
      respond.badRequest(res, 'El ID debe ser un número entero');
      return;
    }

    const file = (req as any).file;  // ← castear aquí
    if (!file) {
      respond.badRequest(res, 'No se recibió ningún archivo');
      return;
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const imagenURL = `${baseUrl}/imagenes/articulos/${id}.jpg`;

    await guardarImagenArticulo(id, imagenURL);

    respond.ok(res, { imagenURL }, 'Imagen actualizada correctamente');
  } catch (err) { next(err); }
}
 
// ── Eliminar imagen ───────────────────────────────────
 
export async function deleteImagen(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) {
      respond.badRequest(res, 'El ID debe ser un número entero');
      return;
    }
 
    await eliminarImagenArticulo(id);
    respond.ok(res, null, 'Imagen eliminada correctamente');
  } catch (err) { next(err); }
}