// src/modules/pedidos/pedidos.controller.ts

import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { respond } from '../../shared/response.helper';
import {
  listarPedidos, obtenerPedido, obtenerDetallePedido,
  abrirPedido, agregarRonda, solicitarCuenta, cancelarPedido
} from './pedidos.service';

// ── Schemas ──────────────────────────────────────────

const itemSchema = Joi.object({
  articuloID:      Joi.number().integer().positive().required(), // ← era string().uuid()
  cantidad:        Joi.number().positive().required(),
  notasEspeciales: Joi.string().max(255).allow(null, '').optional(),
});

const abrirPedidoSchema = Joi.object({
  mesaID:         Joi.string().uuid().optional(),
  tipoPedido:     Joi.string().valid('Mesa', 'Para Llevar', 'Domicilio').optional(),
  nombreCliente:  Joi.string().max(100).optional(),
  numeroPersonas: Joi.number().integer().min(1).optional(),
  notasGenerales: Joi.string().max(500).optional(),
  items: Joi.array().items(itemSchema).min(1).required().messages({
    'array.min': 'Debes agregar al menos un artículo al pedido',
    'any.required': 'Los ítems del pedido son requeridos',
  }),
});

const rondaSchema = Joi.object({
  items: Joi.array().items(itemSchema).min(1).required().messages({
    'array.min': 'Debes agregar al menos un artículo a la ronda',
  }),
});

// ── Controllers ──────────────────────────────────────

export async function getPedidos(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await listarPedidos({
      estado:  req.query.estado  as string,
      mesaID:  req.query.mesaID  as string,
      fecha:   req.query.fecha   as string,
    });
    respond.ok(res, data);
  } catch (err) { next(err); }
}

export async function getPedido(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await obtenerPedido(req.params.id as string);
    respond.ok(res, data);
  } catch (err) { next(err); }
}

export async function getDetallePedido(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await obtenerDetallePedido(req.params.id as string);
    respond.ok(res, data);
  } catch (err) { next(err); }
}

export async function postAbrirPedido(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const { error, value } = abrirPedidoSchema.validate(req.body);
    if (error) { respond.badRequest(res, error.details[0].message); return; }

    const pedido = await abrirPedido(req.usuario!.usuarioID, value);
    respond.created(res, pedido, `Pedido #${pedido.numeroPedido} tomado correctamente`);
  } catch (err) { next(err); }
}

export async function postAgregarRonda(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const { error, value } = rondaSchema.validate(req.body);
    if (error) { respond.badRequest(res, error.details[0].message); return; }

    const result = await agregarRonda(
      req.params.id as string,
      req.usuario!.usuarioID,
      value.items
    );
    respond.created(res, result, `Ronda #${result.numeroRonda} agregada correctamente`);
  } catch (err) { next(err); }
}

export async function postSolicitarCuenta(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const pedido = await solicitarCuenta(
      req.params.id as string,
      req.usuario!.usuarioID
    );
    respond.ok(res, pedido, 'Cuenta solicitada. Mesa en estado "Por Pagar".');
  } catch (err) { next(err); }
}

export async function postCancelarPedido(
  req: Request, res: Response, next: NextFunction
) {
  try {
    await cancelarPedido(
      req.params.id as string,
      req.usuario!.usuarioID
    );
    respond.ok(res, null, 'Pedido cancelado');
  } catch (err) { next(err); }
}