// src/modules/articulos/articulos.service.ts
// ── Ahora lee de la tabla 'articulo' del sistema existente ──
// No crea ni modifica artículos — solo consulta

import { query, sql } from '../../config/database';
import { AppError } from '../../middlewares/error.middleware';

// ── Interfaces ───────────────────────────────────────

export interface Categoria {
  categoriaID: number;  // idCategoria es INT
  nombre: string;
  imagenURL: string | null;  // ← nuevo
}

export interface Articulo {
  articuloID: number;       // Id INT del sistema existente
  categoriaID: number;
  categoriaNombre: string;
  nombre: string;
  codigoBarras: string | null;
  esVendible: boolean;
  estado: number;           // 1=Activo, 0=Inactivo
  precioVenta: number;
  precioCosto: number | null;
  porcentajeIVA: number;
}

// ── CATEGORÍAS ───────────────────────────────────────
// Lee de la tabla de categorías del sistema existente

export async function listarCategorias(): Promise<Categoria[]> {
  return query<Categoria>(`
    SELECT
      idCategoria AS categoriaID,
      Nombre      AS nombre
    FROM categorias
    WHERE Nombre NOT IN ('INSUMOS COCINA', 'PRODUCTOS INVENTARIO')
    ORDER BY Orden, Nombre
  `);
}

// ── ARTÍCULOS ─────────────────────────────────────────
// Lee de la tabla articulo del sistema existente
// Solo muestra artículos activos (Estado = 1) y vendibles

export async function listarArticulos(
  soloActivos = true,
  categoriaID?: number
): Promise<Articulo[]> {
  return query<Articulo>(`
    SELECT
      a.Id            AS articuloID,
      a.IdCategoria   AS categoriaID,
      c.Nombre  AS categoriaNombre,
      a.Nombre        AS nombre,
      a.CodBar        AS codigoBarras,
      1               AS esVendible,
      a.Estado        AS estado,
      a.Venta         AS precioVenta,
      a.Costo         AS precioCosto,
      ISNULL(t.Num, 0) AS porcentajeIVA,
      img.ImagenURL   AS imagenURL    -- ← nueva columna para la URL de la imagen
    FROM articulo a
    INNER JOIN categorias c ON a.IdCategoria = c.idCategoria  -- ← LEFT a INNER
    LEFT JOIN tarifas t ON a.Idiva = t.Id
    LEFT JOIN modu_rest_ArticulosImagenes img ON a.Id = img.IdArticulo  -- ← nuevo
    WHERE
      (@soloActivos = 0 OR a.Estado = 1)
      AND a.Venta > 0
      AND (@categoriaID IS NULL OR a.IdCategoria = @categoriaID)
      AND c.Nombre NOT IN ('INSUMOS COCINA', 'PRODUCTOS INVENTARIO')
    ORDER BY c.orden, a.Nombre  -- ← ordenar por orden
  `, (req) => {
    req.input('soloActivos', sql.Bit, soloActivos ? 1 : 0);
    req.input('categoriaID', sql.Int, categoriaID ?? null);
  });
}

export async function obtenerArticulo(articuloID: number): Promise<Articulo> {
  const rows = await query<Articulo>(`
    SELECT
      a.Id            AS articuloID,
      a.IdCategoria   AS categoriaID,
      c.Nombre  AS categoriaNombre,
      a.Nombre        AS nombre,
      a.CodBar        AS codigoBarras,
      1               AS esVendible,
      a.Estado        AS estado,
      a.Venta         AS precioVenta,
      a.Costo         AS precioCosto,
      ISNULL(t.Num, 0) AS porcentajeIVA
    FROM articulo a
    LEFT JOIN categorias c ON a.IdCategoria = c.idCategoria
    LEFT JOIN tarifas t ON a.Idiva = t.Id
    WHERE a.Id = @articuloID
  `, (req) => {
    req.input('articuloID', sql.Int, articuloID);
  });

  if (rows.length === 0) throw new AppError('Artículo no encontrado', 404);
  return rows[0];
}