// src/middlewares/rol.middleware.ts

import { Request, Response, NextFunction } from 'express';
import { respond } from '../shared/response.helper';

// Roles disponibles en el sistema
export type RolSistema = 'Administrador' | 'Cajero' | 'Mesero' | 'Cocina';

// Factory que devuelve un middleware configurado con los roles permitidos
export function requireRol(...rolesPermitidos: RolSistema[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.usuario) {
      respond.unauthorized(res);
      return;
    }

    const tieneAcceso = rolesPermitidos.includes(
    req.usuario.rol as RolSistema  // ← era rolNombre
  );

    if (!tieneAcceso) {
      respond.forbidden(
        res,
        `Se requiere uno de estos roles: ${rolesPermitidos.join(', ')}`
      );
      return;
    }

    next();
  };
}

// Shortcut — el administrador siempre tiene acceso a todo
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.usuario?.rolNombre !== 'Administrador') {
    respond.forbidden(res, 'Solo el administrador puede realizar esta acción');
    return;
  }
  next();
}