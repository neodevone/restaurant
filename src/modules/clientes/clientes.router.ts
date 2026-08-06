// src/modules/clientes/clientes.router.ts

import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { requireRol } from '../../middlewares/rol.middleware';
import {
  getBuscarPorCelular, getBuscar, postCrear, patchActualizar
} from './clientes.controller';

export const clientesRouter = Router();

clientesRouter.use(authMiddleware);

const roles = requireRol('Administrador', 'Cajero');

// Va antes que cualquier ruta con :id para que no se la coma
clientesRouter.get('/buscar-celular/:celular', roles, getBuscarPorCelular);

// ?q=texto  — si no hay texto, devuelve los más recientes
clientesRouter.get('/', roles, getBuscar);

clientesRouter.post('/', roles, postCrear);
clientesRouter.patch('/:id', roles, patchActualizar);