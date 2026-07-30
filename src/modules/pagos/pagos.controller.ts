// src/modules/pagos/pagos.controller.ts

import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { respond } from '../../shared/response.helper';
import {
  listarMetodosPago, obtenerPago, resumenPagosPedido,
  registrarPago, registrarCuentaPorCobrar, anularPago,
  listarCuentasPorCobrar
} from './pagos.service';

// ── Schemas ───────────────────────────────────────────

const metadataSchema = Joi.object({
  tipoPedido:       Joi.string().valid('Mesa', 'Para Llevar', 'Domicilio').optional(),
  // Digital / Transferencia
  referencia:       Joi.string().max(100).allow('', null).optional(),
  confirmado:       Joi.boolean().optional(),
  // Datáfono
  codigoAprobacion: Joi.string().max(50).allow('', null).optional(),
  franquicia:       Joi.string().max(50).allow('', null).optional(),
  terminal:         Joi.string().max(50).allow('', null).optional(),
  // Crédito / Fiado / Cortesía / Empleado
  nombreCliente:    Joi.string().max(150).allow('', null).optional(),
  cedula:           Joi.string().max(20).allow('', null).optional(),
  celular:          Joi.string().max(20).allow('', null).optional(),
  autorizadoPor:    Joi.string().max(100).allow('', null).optional(),
  motivo:           Joi.string().max(300).allow('', null).optional(),
  estadoCredito:    Joi.string().valid('PENDIENTE', 'ABONADA', 'PAGADO').optional(),
}).optional();

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
  referenciaExterna: Joi.string().max(100).allow('', null).optional(),
  metadataPago:      metadataSchema,
});

const fiadoSchema = Joi.object({
  pedidoID: Joi.string().uuid().required().messages({
    'any.required': 'El pedidoID es requerido',
  }),
  metodoID: Joi.string().uuid().required().messages({
    'any.required': 'El método de cuenta por cobrar es requerido',
  }),
  cedula: Joi.string().min(4).max(20).required().messages({
    'any.required':  'La cédula del cliente es requerida',
    'string.min':    'La cédula debe tener al menos 4 dígitos',
  }),
  celular: Joi.string().min(7).max(20).required().messages({
    'any.required':  'El celular del cliente es requerido',
    'string.min':    'El celular debe tener al menos 7 dígitos',
  }),
  nombreCliente: Joi.string().max(150).allow('', null).optional(),
  autorizadoPor: Joi.string().max(100).allow('', null).optional(),
  motivo:        Joi.string().max(300).allow('', null).optional(),
  tipoPedido:    Joi.string().valid('Mesa', 'Para Llevar', 'Domicilio').optional(),
});

const anularSchema = Joi.object({
  motivo: Joi.string().min(5).max(255).required().messages({
    'any.required': 'El motivo de anulación es requerido',
    'string.min':   'El motivo debe tener al menos 5 caracteres',
  }),
});

// ── Controllers ───────────────────────────────────────

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

export async function postRegistrarFiado(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const { error, value } = fiadoSchema.validate(req.body);
    if (error) { respond.badRequest(res, error.details[0].message); return; }

    const result = await registrarCuentaPorCobrar(req.usuario!.usuarioID, value);

    respond.created(
      res,
      result,
      `Cuenta por cobrar registrada por $${result.pago.montoEsperado.toLocaleString()}`
    );
  } catch (err) { next(err); }
}

export async function getCuentasPorCobrar(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await listarCuentasPorCobrar({
      estado: req.query.estado as 'PENDIENTE' | 'ABONADA' | 'PAGADO' | undefined,
      cedula: req.query.cedula as string | undefined,
    });
    respond.ok(res, data);
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