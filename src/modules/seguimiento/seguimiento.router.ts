// src/modules/seguimiento/seguimiento.router.ts

import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { requireRol } from '../../middlewares/rol.middleware';
import {
  getPanel, getSeguimiento, getConfigurables,
  postSeguimiento, deleteSeguimiento
} from './seguimiento.controller';

export const seguimientoRouter = Router();

seguimientoRouter.use(authMiddleware);

// El panel lo consulta el escritorio cada pocos segundos
seguimientoRouter.get('/panel',
  requireRol('Administrador', 'Cajero'),
  getPanel
);

// Configuración: quién decide qué se vigila
seguimientoRouter.get('/configurables',
  requireRol('Administrador', 'Cajero'),
  getConfigurables
);

seguimientoRouter.get('/',
  requireRol('Administrador', 'Cajero'),
  getSeguimiento
);

seguimientoRouter.post('/',
  requireRol('Administrador', 'Cajero'),
  postSeguimiento
);

seguimientoRouter.delete('/:articuloID',
  requireRol('Administrador', 'Cajero'),
  deleteSeguimiento
);