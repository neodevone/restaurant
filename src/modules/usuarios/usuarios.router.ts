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

const rolesGestion = requireRol('Administrador', 'Cajero');

// Roles disponibles
usuariosRouter.get('/roles', rolesGestion, roles);

// Gestión de usuarios — Admin y Cajero
usuariosRouter.get('/',                   rolesGestion, listar);
usuariosRouter.get('/:id',                rolesGestion, obtener);
usuariosRouter.post('/',                  rolesGestion, crear);
usuariosRouter.patch('/:id',              rolesGestion, actualizar);
usuariosRouter.patch('/:id/password',     rolesGestion, cambiarPass);
usuariosRouter.patch('/:id/toggle',       rolesGestion, toggleActivo);