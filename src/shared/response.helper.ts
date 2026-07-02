// src/shared/response.helper.ts

import { Response } from 'express';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  errors?: string[];
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
  };
}

export const respond = {

  ok<T>(res: Response, data: T, message?: string, meta?: ApiResponse<T>['meta']) {
    return res.status(200).json({
      success: true,
      data,
      message,
      meta,
    } as ApiResponse<T>);
  },

  created<T>(res: Response, data: T, message = 'Registro creado exitosamente') {
    return res.status(201).json({
      success: true,
      data,
      message,
    } as ApiResponse<T>);
  },

  noContent(res: Response) {
    return res.status(204).send();
  },

  badRequest(res: Response, message: string, errors?: string[]) {
    return res.status(400).json({
      success: false,
      message,
      errors,
    } as ApiResponse<null>);
  },

  unauthorized(res: Response, message = 'No autorizado') {
    return res.status(401).json({
      success: false,
      message,
    } as ApiResponse<null>);
  },

  forbidden(res: Response, message = 'No tienes permisos para esta acción') {
    return res.status(403).json({
      success: false,
      message,
    } as ApiResponse<null>);
  },

  notFound(res: Response, message = 'Recurso no encontrado') {
    return res.status(404).json({
      success: false,
      message,
    } as ApiResponse<null>);
  },

  serverError(res: Response, message = 'Error interno del servidor') {
    return res.status(500).json({
      success: false,
      message,
    } as ApiResponse<null>);
  },
};