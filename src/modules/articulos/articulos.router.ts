// src/modules/articulos/articulos.router.ts
// ── Solo endpoints de lectura — artículos vienen del sistema existente ──

import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { requireRol } from '../../middlewares/rol.middleware';
import { 
    getCategorias, 
    getArticulos, 
    getArticulo, 
    postImagen, 
    deleteImagen } 
from './articulos.controller';
import { uploadImagen } from '../../config/upload';

export const articulosRouter = Router();

articulosRouter.use(authMiddleware);

const rolesLectura = requireRol('Administrador', 'Mesero', 'Cajero');
const rolesAdmin   = requireRol('Administrador', 'Cajero');

// GET /articulos/categorias
articulosRouter.get('/categorias', rolesLectura, getCategorias);

// GET /articulos?soloActivos=true&categoriaID=2
articulosRouter.get('/', rolesLectura, getArticulos);

// GET /articulos/:id
articulosRouter.get('/:id', rolesLectura, getArticulo);

// POST /articulos/:id/imagen  ← subir imagen
articulosRouter.post(
  '/:id/imagen',
  rolesAdmin,
  uploadImagen.single('imagen'),
  postImagen
);
 
// DELETE /articulos/:id/imagen  ← eliminar imagen
articulosRouter.delete('/:id/imagen', rolesAdmin, deleteImagen);