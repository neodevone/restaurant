// src/modules/pagos/pagos.controller.ts

import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { respond } from '../../shared/response.helper';
import {
  listarMetodosPago, obtenerPago, resumenPagosPedido,
  registrarPago, anularPago, listarPagosTurno
} from './pagos.service';

const pagoSchema = Joi.object({
  pedidoID:          Joi.string().uuid().required().messages({
    'any.required': 'El pedidoID es requerido',
  }),
  metodoID:          Joi.string().uuid().required().messages({
    'any.required': 'El método de pago es requerido',
  }),
  montoPagado:       Joi.number().positive().required().messages({
    'any.required':    'El monto pagado es requerido',
    'number.positive': 'El monto debe ser mayor a 0',
  }),
  propina:           Joi.number().min(0).optional(),
  referenciaExterna: Joi.string().max(100).optional(),
});

const anularSchema = Joi.object({
  motivo: Joi.string().min(5).max(255).required().messages({
    'any.required': 'El motivo de anulación es requerido',
    'string.min':   'El motivo debe tener al menos 5 caracteres',
  }),
});

export async function getMetodosPago(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await listarMetodosPago();
    respond.ok(res, data);
  } catch (err) { next(err); }
}

export async function getPago(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await obtenerPago(req.params.id as string);
    respond.ok(res, data);
  } catch (err) { next(err); }
}

export async function getResumenPedido(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await resumenPagosPedido(req.params.pedidoID as string);
    respond.ok(res, data);
  } catch (err) { next(err); }
}

export async function getPagosTurno(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await listarPagosTurno(req.params.turnoID as string);
    respond.ok(res, data);
  } catch (err) { next(err); }
}

export async function postRegistrarPago(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const { error, value } = pagoSchema.validate(req.body);
    if (error) { respond.badRequest(res, error.details[0].message); return; }

    const result = await registrarPago(req.usuario!.usuarioID, value);

    const mensaje = result.resumen.pagadoCompletamente
      ? `✅ Pago completo. Vuelto: $${result.pago.vuelto.toLocaleString()}`
      : `Pago parcial. Saldo pendiente: $${result.resumen.saldoPendiente.toLocaleString()}`;

    respond.created(res, result, mensaje);
  } catch (err) { next(err); }
}

export async function postAnularPago(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const { error, value } = anularSchema.validate(req.body);
    if (error) { respond.badRequest(res, error.details[0].message); return; }

    await anularPago(
      req.params.id as string,
      req.usuario!.usuarioID,
      value.motivo
    );

    respond.ok(res, null, 'Pago anulado. El pedido volvió a estado Por Pagar.');
  } catch (err) { next(err); }
}