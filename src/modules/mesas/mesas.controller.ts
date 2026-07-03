// src/modules/mesas/mesas.controller.ts

import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { respond } from '../../shared/response.helper';
import { registrarEvento } from '../../shared/eventos.service';
import {
  listarZonas, crearZona, toggleZona,
  listarMesas, listarMesasConPedido, obtenerMesa,
  crearMesa, actualizarMesa, cambiarEstadoMesa, toggleMesa, actualizarPosicionMesa
} from './mesas.service';

// ── Schemas ──────────────────────────────────────────

const zonaSchema = Joi.object({
  nombre: Joi.string().min(2).max(50).required(),
  orden:  Joi.number().integer().min(0).optional(),
});

const mesaSchema = Joi.object({
  zonaID:    Joi.string().uuid().required(),
  alias:     Joi.string().min(1).max(20).required(),
  capacidad: Joi.number().integer().min(1).max(50).optional(),
  posicionX: Joi.number().integer().min(0).optional(),
  posicionY: Joi.number().integer().min(0).optional(),
});

const actualizarMesaSchema = Joi.object({
  zonaID:    Joi.string().uuid().optional(),
  alias:     Joi.string().min(1).max(20).optional(),
  capacidad: Joi.number().integer().min(1).max(50).optional(),
  posicionX: Joi.number().integer().min(0).optional(),
  posicionY: Joi.number().integer().min(0).optional(),
}).min(1);

const estadoSchema = Joi.object({
  estado: Joi.string()
    .valid('Libre', 'Ocupada', 'Reservada', 'Sucia', 'Cuenta-Pedida')
    .required()
    .messages({
      'any.only': 'Estado inválido. Valores permitidos: Libre, Ocupada, Reservada, Sucia, Cuenta-Pedida',
    }),
});

// ── Zonas ─────────────────────────────────────────────

export async function getZonas(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await listarZonas();
    respond.ok(res, data);
  } catch (err) { next(err); }
}

export async function postZona(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const { error, value } = zonaSchema.validate(req.body);
    if (error) { respond.badRequest(res, error.details[0].message); return; }

    const data = await crearZona(value);
    respond.created(res, data, 'Zona creada');
  } catch (err) { next(err); }
}

export async function patchZonaToggle(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const { activa } = req.body;
    if (typeof activa !== 'boolean') {
      respond.badRequest(res, 'El campo activa debe ser true o false');
      return;
    }
    await toggleZona(req.params.id as string, activa);
    respond.ok(res, null, `Zona ${activa ? 'activada' : 'desactivada'}`);
  } catch (err) { next(err); }
}

// ── Mesas ─────────────────────────────────────────────

export async function getMesas(
  req: Request, res: Response, next: NextFunction
) {
  try {
    // ?conPedido=true → devuelve vista enriquecida para el mapa visual
    if (req.query.conPedido === 'true') {
      const data = await listarMesasConPedido();
      respond.ok(res, data);
      return;
    }
    const zonaID = req.query.zonaID as string | undefined;
    const data = await listarMesas(zonaID);
    respond.ok(res, data);
  } catch (err) { next(err); }
}

export async function getMesa(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await obtenerMesa(req.params.id as string);
    respond.ok(res, data);
  } catch (err) { next(err); }
}

export async function postMesa(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const { error, value } = mesaSchema.validate(req.body);
    if (error) { respond.badRequest(res, error.details[0].message); return; }

    const data = await crearMesa(value);
    respond.created(res, data, 'Mesa creada');
  } catch (err) { next(err); }
}

export async function patchMesa(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const { error, value } = actualizarMesaSchema.validate(req.body);
    if (error) { respond.badRequest(res, error.details[0].message); return; }

    const data = await actualizarMesa(req.params.id as string, value);
    respond.ok(res, data, 'Mesa actualizada');
  } catch (err) { next(err); }
}

export async function patchEstadoMesa(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const { error, value } = estadoSchema.validate(req.body);
    if (error) { respond.badRequest(res, error.details[0].message); return; }

    const mesaID = req.params.id as string;
    const mesa = await cambiarEstadoMesa(mesaID, value.estado);

    // Emitir evento en tiempo real a sala y admin
    await registrarEvento({
      tipo:        value.estado === 'Libre' ? 'MESA_CERRADA' : 'MESA_ABIERTA',
      entidadTipo: 'Mesa',
      entidadID:   mesaID,
      usuarioID:   req.usuario!.usuarioID,
      payload:     { mesaID, alias: mesa.alias, estado: value.estado },
    });

    respond.ok(res, mesa, `Mesa marcada como ${value.estado}`);
  } catch (err) { next(err); }
}

export async function patchMesaToggle(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const { activa } = req.body;
    if (typeof activa !== 'boolean') {
      respond.badRequest(res, 'El campo activa debe ser true o false');
      return;
    }
    await toggleMesa(req.params.id as string, activa);
    respond.ok(res, null, `Mesa ${activa ? 'activada' : 'desactivada'}`);
  } catch (err) { next(err); }
}

export async function patchPosicionMesa(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const { posicionX, posicionY } = req.body;
    if (posicionX === undefined || posicionY === undefined) {
      respond.badRequest(res, 'posicionX y posicionY son requeridos');
      return;
    }
    await actualizarPosicionMesa(
      req.params.id as string,
      posicionX, posicionY
    );
    respond.ok(res, null, 'Posición actualizada');
  } catch (err) { next(err); }
}