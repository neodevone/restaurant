// src/modules/turnos/turnos.controller.ts

import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { respond } from '../../shared/response.helper';
import {
  abrirTurno, cerrarTurno, obtenerTurnoAbierto,
  obtenerTurnoPorID, listarTurnos, resumenTurno,
  arqueoTurno, registrarMovimiento, listarMovimientos,
  anularMovimiento, TIPOS_MOVIMIENTO
} from './turnos.service';

// ── Schemas ───────────────────────────────────────────

const abrirSchema = Joi.object({
  montoInicial: Joi.number().min(0).required().messages({
    'any.required': 'El monto inicial es requerido',
    'number.min':   'El monto inicial no puede ser negativo',
  }),
  observaciones: Joi.string().max(500).allow('', null).optional(),
});

const cerrarSchema = Joi.object({
  montoFinal: Joi.number().min(0).required().messages({
    'any.required': 'El monto contado en caja es requerido',
    'number.min':   'El monto contado no puede ser negativo',
  }),
  observaciones: Joi.string().max(500).allow('', null).optional(),
});

const movimientoSchema = Joi.object({
  tipo: Joi.string().valid(...TIPOS_MOVIMIENTO).required().messages({
    'any.only':     'Tipo de movimiento no válido',
    'any.required': 'El tipo de movimiento es requerido',
  }),
  monto: Joi.number().positive().required().messages({
    'any.required':    'El monto es requerido',
    'number.positive': 'El monto debe ser mayor a cero',
  }),
  concepto: Joi.string().min(3).max(200).required().messages({
    'any.required': 'El concepto es requerido',
    'string.min':   'Describe el motivo del movimiento',
  }),
  beneficiario: Joi.string().max(150).allow('', null).optional(),
  soporte:      Joi.string().max(100).allow('', null).optional(),
});

const anularSchema = Joi.object({
  motivo: Joi.string().min(5).max(255).required().messages({
    'any.required': 'El motivo de anulación es requerido',
  }),
});

// ── Turno ─────────────────────────────────────────────

// GET /turnos/activo
export async function getTurnoActivo(
  _req: Request, res: Response, next: NextFunction
) {
  try {
    const turno = await obtenerTurnoAbierto();
    if (!turno) {
      respond.ok(res, null, 'No hay turno de caja abierto');
      return;
    }
    respond.ok(res, turno);
  } catch (err) { next(err); }
}

// GET /turnos/:id
export async function getTurno(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await obtenerTurnoPorID(req.params.id as string);
    respond.ok(res, data);
  } catch (err) { next(err); }
}

// GET /turnos?desde=&hasta=&estado=
export async function getTurnos(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await listarTurnos({
      desde:  req.query.desde  as string | undefined,
      hasta:  req.query.hasta  as string | undefined,
      estado: req.query.estado as string | undefined,
    });
    respond.ok(res, data);
  } catch (err) { next(err); }
}

// POST /turnos/abrir
export async function postAbrirTurno(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const { error, value } = abrirSchema.validate(req.body);
    if (error) { respond.badRequest(res, error.details[0].message); return; }

    const turno = await abrirTurno({
      usuarioID:     req.usuario!.usuarioID,
      montoInicial:  value.montoInicial,
      observaciones: value.observaciones,
    });

    respond.created(
      res, turno,
      `Caja abierta con $${turno.montoInicial.toLocaleString()}`);
  } catch (err) { next(err); }
}

// POST /turnos/:id/cerrar
export async function postCerrarTurno(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const { error, value } = cerrarSchema.validate(req.body);
    if (error) { respond.badRequest(res, error.details[0].message); return; }

    const result = await cerrarTurno(
      req.params.id as string,
      req.usuario!.usuarioID,
      value
    );

    const dif = result.turno.diferencia ?? 0;
    const mensaje = Math.abs(dif) < 1
      ? 'Turno cerrado. La caja cuadra exactamente.'
      : dif > 0
        ? `Turno cerrado. Sobran $${Math.abs(dif).toLocaleString()} en caja.`
        : `Turno cerrado. Faltan $${Math.abs(dif).toLocaleString()} en caja.`;

    respond.ok(res, result, mensaje);
  } catch (err) { next(err); }
}

// GET /turnos/:id/arqueo
export async function getArqueo(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await arqueoTurno(req.params.id as string);
    respond.ok(res, data);
  } catch (err) { next(err); }
}

// GET /turnos/:id/resumen
export async function getResumenTurno(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await resumenTurno(req.params.id as string);
    respond.ok(res, data);
  } catch (err) { next(err); }
}

// ── Movimientos de caja ───────────────────────────────

// GET /turnos/tipos-movimiento
export async function getTiposMovimiento(
  _req: Request, res: Response, next: NextFunction
) {
  try {
    respond.ok(res, TIPOS_MOVIMIENTO);
  } catch (err) { next(err); }
}

// GET /turnos/:id/movimientos
export async function getMovimientos(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await listarMovimientos(
      req.params.id as string,
      req.query.incluirAnulados === 'true'
    );
    respond.ok(res, data);
  } catch (err) { next(err); }
}

// POST /turnos/:id/movimientos
export async function postMovimiento(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const { error, value } = movimientoSchema.validate(req.body);
    if (error) { respond.badRequest(res, error.details[0].message); return; }

    const mov = await registrarMovimiento({
      turnoID:      req.params.id as string,
      usuarioID:    req.usuario!.usuarioID,
      tipo:         value.tipo,
      monto:        value.monto,
      concepto:     value.concepto,
      beneficiario: value.beneficiario,
      soporte:      value.soporte,
    });

    respond.created(
      res, mov,
      `${mov.esIngreso ? 'Ingreso' : 'Egreso'} de ` +
      `$${mov.monto.toLocaleString()} registrado`);
  } catch (err) { next(err); }
}

// POST /turnos/movimientos/:movimientoID/anular
export async function postAnularMovimiento(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const { error, value } = anularSchema.validate(req.body);
    if (error) { respond.badRequest(res, error.details[0].message); return; }

    await anularMovimiento(
      req.params.movimientoID as string,
      req.usuario!.usuarioID,
      value.motivo
    );

    respond.ok(res, null, 'Movimiento anulado');
  } catch (err) { next(err); }
}