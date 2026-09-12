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

// Ver la lista y crear meseros — Admin y Cajero. Pero editar, cambiar
// contraseña o desactivar una cuenta que ya existe es modificar a otra
// persona (o a sí mismo): eso se queda solo para el administrador.
usuariosRouter.get('/',                   rolesGestion, listar);
usuariosRouter.get('/:id',                rolesGestion, obtener);
usuariosRouter.post('/',                  rolesGestion, crear);
usuariosRouter.patch('/:id',              requireAdmin, actualizar);
usuariosRouter.patch('/:id/password',     requireAdmin, cambiarPass);
usuariosRouter.patch('/:id/toggle',       requireAdmin, toggleActivo);