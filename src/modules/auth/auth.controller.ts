// src/modules/auth/auth.controller.ts

import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { respond } from '../../shared/response.helper';
import { loginConCredenciales, loginConPIN } from './auth.service';

// Esquemas de validación
const loginSchema = Joi.object({
  usuario:  Joi.string().min(3).max(50).required().messages({
    'string.empty': 'El usuario es requerido',
    'any.required': 'El usuario es requerido',
  }),
  password: Joi.string().min(4).required().messages({
    'string.empty': 'La contraseña es requerida',
    'any.required': 'La contraseña es requerida',
  }),
});

const pinSchema = Joi.object({
  pin: Joi.string().length(4).pattern(/^\d+$/).required().messages({
    'string.length':  'El PIN debe tener exactamente 4 dígitos',
    'string.pattern.base': 'El PIN solo puede contener números',
    'any.required':   'El PIN es requerido',
  }),
});

export async function login(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      respond.badRequest(res, error.details[0].message);
      return;
    }

    const result = await loginConCredenciales(value.usuario, value.password);
    respond.ok(res, result, 'Login exitoso');

  } catch (err) {
    next(err);
  }
}

export async function loginPIN(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { error, value } = pinSchema.validate(req.body);
    if (error) {
      respond.badRequest(res, error.details[0].message);
      return;
    }

    const result = await loginConPIN(value.pin);
    respond.ok(res, result, 'Login por PIN exitoso');

  } catch (err) {
    next(err);
  }
}

// Retorna los datos del usuario autenticado actual
export async function me(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    respond.ok(res, req.usuario, 'Usuario autenticado');
  } catch (err) {
    next(err);
  }
}