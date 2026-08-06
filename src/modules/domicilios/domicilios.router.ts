// src/modules/domicilios/domicilios.router.ts

import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { requireRol } from '../../middlewares/rol.middleware';
import {
  postCrear, getListar, getHistorialCliente, getResumen
} from './domicilios.controller';

export const domiciliosRouter = Router();

domiciliosRouter.use(authMiddleware);

const roles = requireRol('Administrador', 'Cajero');

// Van antes de cualquier ruta con :id
domiciliosRouter.get('/resumen', roles, getResumen);
domiciliosRouter.get('/cliente/:clienteID', roles, getHistorialCliente);

domiciliosRouter.get('/', roles, getListar);
domiciliosRouter.post('/', roles, postCrear);