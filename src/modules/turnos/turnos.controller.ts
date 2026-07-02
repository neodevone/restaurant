// src/modules/turnos/turnos.controller.ts

import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { respond } from '../../shared/response.helper';
import {
  abrirTurno, cerrarTurno, obtenerTurnoAbierto,
  obtenerTurnoPorID, listarTurnos, resumenTurno
} from './turnos.service';

const abrirSchema = Joi.object({
  montoInicial: Joi.number().min(0).required().messages({
    'any.required':  'El monto inicial es requerido',
    'number.min':    'El monto inicial no puede ser negativo',
  }),
});

const cerrarSchema = Joi.object({
  montoFinal: Joi.number().min(0).required().messages({
    'any.required': 'El monto final contado es requerido',
    'number.min':   'El monto final no puede ser negativo',
  }),
  observaciones: Joi.string().max(500).optional(),
});

export async function getTurnoActivo(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const turno = await obtenerTurnoAbierto(req.usuario!.usuarioID);
    if (!turno) {
      respond.ok(res, null, 'No hay turno abierto');
      return;
    }
    respond.ok(res, turno);
  } catch (err) { next(err); }
}

export async function getTurno(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await obtenerTurnoPorID(req.params.id as string);
    respond.ok(res, data);
  } catch (err) { next(err); }
}

export async function getTurnos(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const fecha = req.query.fecha as string | undefined;
    const data  = await listarTurnos(fecha);
    respond.ok(res, data);
  } catch (err) { next(err); }
}

export async function postAbrirTurno(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const { error, value } = abrirSchema.validate(req.body);
    if (error) { respond.badRequest(res, error.details[0].message); return; }

    const turno = await abrirTurno({
      montoInicial: value.montoInicial,
      usuarioID:    req.usuario!.usuarioID,
    });

    respond.created(res, turno, 'Turno abierto exitosamente');
  } catch (err) { next(err); }
}

export async function postCerrarTurno(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const { error, value } = cerrarSchema.validate(req.body);
    if (error) { respond.badRequest(res, error.details[0].message); return; }

    const turno = await cerrarTurno(
      req.params.id as string,
      req.usuario!.usuarioID,
      value
    );

    respond.ok(res, turno, 'Turno cerrado. Cuadre de caja completado.');
  } catch (err) { next(err); }
}

export async function getResumenTurno(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await resumenTurno(req.params.id as string);
    respond.ok(res, data);
  } catch (err) { next(err); }
}