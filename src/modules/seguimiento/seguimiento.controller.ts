// src/modules/seguimiento/seguimiento.controller.ts

import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { respond } from '../../shared/response.helper';
import {
  panelSeguimiento, listarSeguimiento, guardarSeguimiento,
  quitarSeguimiento, articulosConfigurables
} from './seguimiento.service';

const guardarSchema = Joi.object({
  articuloID: Joi.number().integer().positive().required(),
  grupo: Joi.string().max(60).allow('', null).optional(),
  equivalencia: Joi.number().positive().max(999).required().messages({
    'number.positive': 'La equivalencia debe ser mayor a cero',
  }),
  orden: Joi.number().integer().min(0).optional(),
  activo: Joi.boolean().required(),
});

// GET /seguimiento/panel
// Lo que el cajero ve al costado del mapa de mesas.
export async function getPanel(
  _req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await panelSeguimiento();
    respond.ok(res, data);
  } catch (err) { next(err); }
}

// GET /seguimiento
export async function getSeguimiento(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await listarSeguimiento(req.query.soloActivos === 'true');
    respond.ok(res, data);
  } catch (err) { next(err); }
}

// GET /seguimiento/configurables
// La carta completa, marcando cuáles ya están en seguimiento.
export async function getConfigurables(
  _req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await articulosConfigurables();
    respond.ok(res, data);
  } catch (err) { next(err); }
}

// POST /seguimiento
export async function postSeguimiento(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const { error, value } = guardarSchema.validate(req.body);
    if (error) { respond.badRequest(res, error.details[0].message); return; }

    await guardarSeguimiento(value);
    respond.ok(res, null, 'Configuración guardada');
  } catch (err) { next(err); }
}

// DELETE /seguimiento/:articuloID
export async function deleteSeguimiento(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const id = parseInt(req.params.articuloID as string);
    if (isNaN(id)) { respond.badRequest(res, 'ID inválido'); return; }

    await quitarSeguimiento(id);
    respond.ok(res, null, 'Artículo retirado del seguimiento');
  } catch (err) { next(err); }
}