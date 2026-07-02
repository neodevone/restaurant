// src/modules/comandas/comandas.controller.ts

import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { respond } from '../../shared/response.helper';
import {
  listarComandasKDS, obtenerComanda, obtenerItemsComanda,
  marcarVista, marcarEnPreparacion, marcarLista, marcarDespachada,
  cambiarPrioridad, agregarNotaCocina, historialComandasPedido
} from './comandas.service';

const prioridadSchema = Joi.object({
  prioridad: Joi.number().integer().min(0).max(10).required().messages({
    'number.min': 'La prioridad mínima es 0',
    'number.max': 'La prioridad máxima es 10',
  }),
});

const notaSchema = Joi.object({
  nota: Joi.string().min(1).max(255).required().messages({
    'any.required': 'La nota es requerida',
  }),
});

// Vista principal del KDS — todas las comandas activas
export async function getKDS(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await listarComandasKDS();
    respond.ok(res, data);
  } catch (err) { next(err); }
}

export async function getComanda(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await obtenerComanda(req.params.id as string);
    respond.ok(res, data);
  } catch (err) { next(err); }
}

export async function getItemsComanda(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await obtenerItemsComanda(req.params.id as string);
    respond.ok(res, data);
  } catch (err) { next(err); }
}

export async function getHistorialPedido(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await historialComandasPedido(req.params.pedidoID as string);
    respond.ok(res, data);
  } catch (err) { next(err); }
}

// ── Transiciones de estado del KDS ──────────────────

export async function postMarcarVista(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await marcarVista(
      req.params.id as string,
      req.usuario!.usuarioID
    );
    respond.ok(res, data, 'Comanda marcada como Vista');
  } catch (err) { next(err); }
}

export async function postMarcarEnPreparacion(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await marcarEnPreparacion(
      req.params.id as string,
      req.usuario!.usuarioID
    );
    respond.ok(res, data, 'Comanda En Preparación — el reloj corre');
  } catch (err) { next(err); }
}

export async function postMarcarLista(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await marcarLista(
      req.params.id as string,
      req.usuario!.usuarioID
    );
    respond.ok(res, data, '✅ Comanda Lista — notificando al mesero');
  } catch (err) { next(err); }
}

export async function postMarcarDespachada(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await marcarDespachada(
      req.params.id as string,
      req.usuario!.usuarioID
    );
    respond.ok(res, data, 'Comanda Despachada — platos entregados en mesa');
  } catch (err) { next(err); }
}

export async function patchPrioridad(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const { error, value } = prioridadSchema.validate(req.body);
    if (error) { respond.badRequest(res, error.details[0].message); return; }

    await cambiarPrioridad(req.params.id as string, value.prioridad);
    respond.ok(res, null, 'Prioridad actualizada');
  } catch (err) { next(err); }
}

export async function patchNotaCocina(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const { error, value } = notaSchema.validate(req.body);
    if (error) { respond.badRequest(res, error.details[0].message); return; }

    await agregarNotaCocina(req.params.id as string, value.nota);
    respond.ok(res, null, 'Nota agregada a la comanda');
  } catch (err) { next(err); }
}