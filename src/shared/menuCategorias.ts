// src/shared/menuCategorias.ts
//
// Nombre, orden y visibilidad de las categorías EN EL MENÚ del restaurante.
//
// La tabla `categorias` pertenece al sistema contable (bdReinelGuzman) y
// allá se llaman "CATEGORIA 3", "CATEGORIA 4"… El restaurante las muestra
// como "POLLOS Y CARNES", "BANDEJAS Y PLATOS"… en su propio orden. Para no
// tocar los datos del contable, eso vive en modu_rest_CategoriasMenu:
//
//   IdCategoria → categorias.idCategoria (mismo Id)
//   Nombre      → nombre que ve el mesero/cajero (si es NULL, el del contable)
//   Orden       → posición en la carta
//   Visible     → 0 = no sale en la carta (insumos, inventario…)
//
// Una categoría que el contable cree después y que no esté en la tabla sale
// con su nombre contable al final de la carta, salvo las de inventario e
// insumos (se ocultan por nombre, como antes).
//
// Uso:  FROM articulo a
//       JOIN categorias c ON a.IdCategoria = c.idCategoria
//       ${joinMenu('c')}
//       WHERE ${categoriaVisible('c')}
//       ORDER BY ${ordenCategoria()}, a.Nombre

const OCULTAS_POR_NOMBRE = `('INSUMOS COCINA', 'PRODUCTOS INVENTARIO')`;

/** LEFT JOIN con la configuración del menú. */
export const joinMenu = (cat: string, menu = 'cm'): string =>
  `LEFT JOIN modu_rest_CategoriasMenu ${menu} ON ${menu}.IdCategoria = ${cat}.idCategoria`;

/** Nombre de la categoría para mostrar. */
export const nombreCategoria = (cat: string, menu = 'cm'): string =>
  `ISNULL(${menu}.Nombre, ${cat}.Nombre)`;

/** Posición en la carta (las no configuradas, al final). */
export const ordenCategoria = (menu = 'cm'): string =>
  `ISNULL(${menu}.Orden, 50)`;

/** Condición: la categoría sale en la carta. */
export const categoriaVisible = (cat: string, menu = 'cm'): string =>
  `(CASE WHEN ${menu}.IdCategoria IS NOT NULL THEN ${menu}.Visible
         WHEN ${cat}.Nombre IN ${OCULTAS_POR_NOMBRE} THEN 0
         ELSE 1 END) = 1`;
