// src/middlewares/error.middleware.ts

import { Request, Response, NextFunction } from 'express';
import { respond } from '../shared/response.helper';

export class AppError extends Error {
  public statusCode: number;
  public isOperational: boolean;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true; // Error esperado (validación, not found, etc.)
    Error.captureStackTrace(this, this.constructor);
  }
}

// Middleware global — debe tener 4 parámetros obligatoriamente para que Express lo reconozca
export function errorMiddleware(
  err: AppError | Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  console.error(`[ERROR] ${req.method} ${req.path}`, err.message);

  // Error operacional conocido (lanzado intencionalmente con AppError)
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
    });
    return;
  }

  // Error de SQL Server — no exponemos detalles al cliente
  if (err.message?.includes('MSSQL')) {
    respond.serverError(res, 'Error en base de datos');
    return;
  }

  // Error genérico no esperado
  respond.serverError(res, 'Error interno del servidor');
}