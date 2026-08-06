// src/modules/clientes/clientes.controller.ts

import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { respond } from '../../shared/response.helper';
import {
  buscarPorCelular, buscarClientes, crearCliente,
  actualizarCliente, listarClientesFrecuentes
} from './clientes.service';

const clienteSchema = Joi.object({
  celular: Joi.string().min(7).max(20).required().messages({
    'any.required': 'El celular es requerido',
    'string.min':   'El celular debe tener al menos 7 dígitos',
  }),
  nombre: Joi.string().min(2).max(150).required().messages({
    'any.required': 'El nombre es requerido',
  }),
  direccion: Joi.string().max(300).allow('', null).optional(),
  notas:     Joi.string().max(300).allow('', null).optional(),
});

const actualizarSchema = Joi.object({
  nombre:    Joi.string().min(2).max(150).optional(),
  direccion: Joi.string().max(300).allow('', null).optional(),
  notas:     Joi.string().max(300).allow('', null).optional(),
});

// GET /clientes/buscar-celular/:celular
export async function getBuscarPorCelular(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await buscarPorCelular(req.params.celular as string);
    respond.ok(res, data);
  } catch (err) { next(err); }
}

// GET /clientes?q=texto
export async function getBuscar(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const q = (req.query.q as string) ?? '';
    const data = q.length >= 2
      ? await buscarClientes(q)
      : await listarClientesFrecuentes(20);
    respond.ok(res, data);
  } catch (err) { next(err); }
}

// POST /clientes
export async function postCrear(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const { error, value } = clienteSchema.validate(req.body);
    if (error) { respond.badRequest(res, error.details[0].message); return; }

    const data = await crearCliente(value);
    respond.created(res, data, `Cliente ${data.nombre} registrado`);
  } catch (err) { next(err); }
}

// PATCH /clientes/:id
export async function patchActualizar(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const { error, value } = actualizarSchema.validate(req.body);
    if (error) { respond.badRequest(res, error.details[0].message); return; }

    const data = await actualizarCliente(req.params.id as string, value);
    respond.ok(res, data, 'Cliente actualizado');
  } catch (err) { next(err); }
}