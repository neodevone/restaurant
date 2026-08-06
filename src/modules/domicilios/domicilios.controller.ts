// src/modules/domicilios/domicilios.controller.ts

import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { respond } from '../../shared/response.helper';
import {
  crearDomicilio, listarDomicilios, historialCliente, resumenDomicilios
} from './domicilios.service';

const itemSchema = Joi.object({
  articuloID: Joi.number().integer().positive().required(),
  cantidad: Joi.number().positive().required(),
  notasEspeciales: Joi.string().max(255).allow('', null).optional(),
});

const crearSchema = Joi.object({
  clienteID: Joi.string().uuid().required().messages({
    'any.required': 'Selecciona o crea el cliente',
  }),
  domiciliarioID: Joi.string().uuid().required().messages({
    'any.required': 'Selecciona quién lo llevó',
  }),
  metodoID: Joi.string().uuid().required().messages({
    'any.required': 'Selecciona el método de pago',
  }),
  direccionEntrega: Joi.string().max(300).allow('', null).optional(),
  fechaPedido: Joi.string().isoDate().optional().messages({
    'string.isoDate': 'La fecha no tiene un formato válido',
  }),
  notasGenerales: Joi.string().max(500).allow('', null).optional(),
  items: Joi.array().items(itemSchema).min(1).required().messages({
    'array.min': 'Agrega al menos un artículo',
  }),
});

function getFiltroFecha(req: Request) {
  const hoy = new Date().toISOString().split('T')[0];
  return {
    desde: (req.query.desde as string) ?? hoy,
    hasta: (req.query.hasta as string) ?? hoy,
  };
}

// POST /domicilios
export async function postCrear(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const { error, value } = crearSchema.validate(req.body);
    if (error) { respond.badRequest(res, error.details[0].message); return; }

    const data = await crearDomicilio(req.usuario!.usuarioID, value);
    respond.created(res, data,
      `Domicilio #${data.numeroPedido} de ${data.clienteNombre} registrado`);
  } catch (err) { next(err); }
}

// GET /domicilios?desde=&hasta=&clienteID=
export async function getListar(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const filtro = getFiltroFecha(req);
    const data = await listarDomicilios({
      ...filtro,
      clienteID: req.query.clienteID as string | undefined,
    });
    respond.ok(res, data);
  } catch (err) { next(err); }
}

// GET /domicilios/cliente/:clienteID
export async function getHistorialCliente(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await historialCliente(req.params.clienteID as string);
    respond.ok(res, data);
  } catch (err) { next(err); }
}

// GET /domicilios/resumen?desde=&hasta=
export async function getResumen(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const filtro = getFiltroFecha(req);
    const data = await resumenDomicilios(filtro);
    respond.ok(res, data);
  } catch (err) { next(err); }
}