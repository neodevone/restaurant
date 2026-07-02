// src/middlewares/auth.middleware.ts

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/environment';
import { respond } from '../shared/response.helper';

export interface JwtPayload {
  usuarioID: string;
  rol: string;        // ← era rolNombre
  nombre: string;
  apellido: string;   // ← agregar
  usuario: string;    // ← agregar
}

// Extendemos Request de Express para cargar el usuario autenticado
declare global {
  namespace Express {
    interface Request {
      usuario?: JwtPayload;
    }
  }
}

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    respond.unauthorized(res, 'Token no proporcionado');
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = jwt.verify(token, env.jwt.secret) as JwtPayload;
    req.usuario = payload; // Disponible en todos los controladores
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      respond.unauthorized(res, 'La sesión ha expirado');
      return;
    }
    respond.unauthorized(res, 'Token inválido');
  }
}