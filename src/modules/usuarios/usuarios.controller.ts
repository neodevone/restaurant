// src/modules/usuarios/usuarios.controller.ts

import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { respond } from '../../shared/response.helper';
import {
  listarUsuarios, obtenerUsuario, crearUsuario,
  actualizarUsuario, cambiarPassword, toggleUsuario, listarRoles
} from './usuarios.service';

const crearSchema = Joi.object({
  rolID:    Joi.string().uuid().required().messages({
    'any.required': 'El rol es requerido',
    'string.guid':  'El rolID debe ser un UUID válido',
  }),
  nombre:   Joi.string().min(2).max(100).required().messages({
    'any.required': 'El nombre es requerido',
  }),
  apellido: Joi.string().min(2).max(100).required().messages({
    'any.required': 'El apellido es requerido',
  }),
  usuario:  Joi.string().min(3).max(50).required().messages({
    'any.required': 'El usuario es requerido',
  }),
  password: Joi.string().min(6).required().messages({
    'any.required': 'La contraseña es requerida',
    'string.min':   'La contraseña debe tener al menos 6 caracteres',
  }),
  pin: Joi.string().length(4).pattern(/^\d+$/).optional().messages({
    'string.length':       'El PIN debe tener 4 dígitos',
    'string.pattern.base': 'El PIN solo puede contener números',
  }),
});

const actualizarSchema = Joi.object({
  rolID:    Joi.string().uuid().optional(),
  nombre:   Joi.string().min(2).max(100).optional(),
  apellido: Joi.string().min(2).max(100).optional(),
  pin:      Joi.string().length(4).pattern(/^\d+$/).allow(null).optional(),
}).min(1).messages({
  'object.min': 'Debes enviar al menos un campo para actualizar',
});

const passwordSchema = Joi.object({
  passwordNuevo: Joi.string().min(6).required().messages({
    'any.required': 'La nueva contraseña es requerida',
    'string.min':   'Debe tener al menos 6 caracteres',
  }),
});

export async function listar(req: Request, res: Response, next: NextFunction) {
  try {
    const usuarios = await listarUsuarios();
    respond.ok(res, usuarios);
  } catch (err) { next(err); }
}

export async function obtener(req: Request, res: Response, next: NextFunction) {
  try {
    const usuario = await obtenerUsuario(req.params.id as string);
    respond.ok(res, usuario);
  } catch (err) { next(err); }
}

export async function crear(req: Request, res: Response, next: NextFunction) {
  try {
    const { error, value } = crearSchema.validate(req.body);
    if (error) { respond.badRequest(res, error.details[0].message); return; }

    const usuario = await crearUsuario(value);
    respond.created(res, usuario, 'Usuario creado exitosamente');
  } catch (err) { next(err); }
}

export async function actualizar(req: Request, res: Response, next: NextFunction) {
  try {
    const { error, value } = actualizarSchema.validate(req.body);
    if (error) { respond.badRequest(res, error.details[0].message); return; }

    const usuario = await actualizarUsuario(req.params.id as string, value);
    respond.ok(res, usuario, 'Usuario actualizado');
  } catch (err) { next(err); }
}

export async function cambiarPass(req: Request, res: Response, next: NextFunction) {
  try {
    const { error, value } = passwordSchema.validate(req.body);
    if (error) { respond.badRequest(res, error.details[0].message); return; }

    await cambiarPassword(req.params.id as string, value.passwordNuevo);
    respond.ok(res, null, 'Contraseña actualizada exitosamente');
  } catch (err) { next(err); }
}

export async function toggleActivo(req: Request, res: Response, next: NextFunction) {
  try {
    const { activo } = req.body;
    if (typeof activo !== 'boolean') {
      respond.badRequest(res, 'El campo activo debe ser true o false');
      return;
    }
    await toggleUsuario(req.params.id as string, activo);
    respond.ok(res, null, `Usuario ${activo ? 'activado' : 'desactivado'}`);
  } catch (err) { next(err); }
}

export async function roles(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await listarRoles();
    respond.ok(res, data);
  } catch (err) { next(err); }
}