// src/modules/pedidos/pedidos.controller.ts

import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { respond } from '../../shared/response.helper';
import {
  listarPedidos, obtenerPedido, obtenerDetallePedido,
  abrirPedido, agregarRonda, solicitarCuenta, cancelarPedido,
  cancelarItemPedido, itemsCanceladosPedido, cambiarCantidadItem
} from './pedidos.service';

// ── Schemas ──────────────────────────────────────────

const itemSchema = Joi.object({
  articuloID:      Joi.number().integer().positive().required(),
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

// Motivos cerrados: se agrupan bien en el informe de anulaciones
// y evitan que el campo quede vacío o con texto inútil.
const MOTIVOS = [
  'Cliente cambió de opinión',
  'Error al tomar el pedido',
  'Producto agotado',
  'Producto en mal estado',
  'Otro',
];

const cantidadSchema = Joi.object({
  cantidad: Joi.number().positive().required().messages({
    'any.required':    'La cantidad es requerida',
    'number.positive': 'La cantidad debe ser mayor a cero',
  }),
});

const cancelarItemSchema = Joi.object({
  motivo: Joi.string().max(200).required().messages({
    'any.required': 'El motivo de la anulación es requerido',
    'string.empty': 'El motivo de la anulación es requerido',
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

// POST /pedidos/:id/items/:detalleID/cancelar   { motivo }
export async function postCancelarItem(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const { error, value } = cancelarItemSchema.validate(req.body);
    if (error) { respond.badRequest(res, error.details[0].message); return; }

    const result = await cancelarItemPedido(
      req.params.id as string,
      req.params.detalleID as string,
      req.usuario!.usuarioID,
      value.motivo
    );

    respond.ok(
      res,
      result,
      `"${result.articulo}" retirado del pedido. ` +
      `Nuevo total: $${result.pedido.totalCuenta.toLocaleString()}`
    );
  } catch (err) { next(err); }
}

// PATCH /pedidos/:id/items/:detalleID   { cantidad }
export async function patchCantidadItem(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const { error, value } = cantidadSchema.validate(req.body);
    if (error) { respond.badRequest(res, error.details[0].message); return; }

    const result = await cambiarCantidadItem(
      req.params.id as string,
      req.params.detalleID as string,
      value.cantidad
    );

    respond.ok(
      res, result,
      `"${result.articulo}" quedó en ${value.cantidad}. ` +
      `Nuevo total: $${result.pedido.totalCuenta.toLocaleString()}`
    );
  } catch (err) { next(err); }
}

// GET /pedidos/:id/items-cancelados
export async function getItemsCancelados(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await itemsCanceladosPedido(req.params.id as string);
    respond.ok(res, data);
  } catch (err) { next(err); }
}

// GET /pedidos/motivos-anulacion
export async function getMotivosAnulacion(
  _req: Request, res: Response, next: NextFunction
) {
  try {
    respond.ok(res, MOTIVOS);
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