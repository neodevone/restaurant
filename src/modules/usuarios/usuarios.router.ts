// src/modules/usuarios/usuarios.router.ts

import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { requireAdmin, requireRol } from '../../middlewares/rol.middleware';
import {
  listar, obtener, crear, actualizar,
  cambiarPass, toggleActivo, roles
} from './usuarios.controller';

export const usuariosRouter = Router();

// Todos los endpoints requieren estar autenticado
usuariosRouter.use(authMiddleware);

// Roles disponibles — cualquier autenticado puede verlos (para formularios)
usuariosRouter.get('/roles', roles);

// Solo el administrador gestiona usuarios
usuariosRouter.get('/',           requireAdmin, listar);
usuariosRouter.get('/:id',        requireAdmin, obtener);
usuariosRouter.post('/',          requireAdmin, crear);
usuariosRouter.patch('/:id',      requireAdmin, actualizar);
usuariosRouter.patch('/:id/password', requireAdmin, cambiarPass);
usuariosRouter.patch('/:id/toggle',   requireAdmin, toggleActivo);