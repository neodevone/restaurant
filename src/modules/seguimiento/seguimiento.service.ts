// src/modules/seguimiento/seguimiento.service.ts
//
// Productos que hay que empezar a preparar antes de que el cliente
// los pida en firme, porque el horno tarda lo que tarda.
//
// La cifra que importa es cuántos están PENDIENTES de despachar:
// eso es lo que el horno todavía debe cubrir. Lo ya despachado se
// muestra al lado como referencia del día, no como acción.

import { query, sql } from '../../config/database';
import { AppError } from '../../middlewares/error.middleware';

const ZONA = 'SA Pacific Standard Time';
const FECHA_LOCAL = (col: string) =>
  `CAST(${col} AT TIME ZONE 'UTC' AT TIME ZONE '${ZONA}' AS DATE)`;

// ── Interfaces ───────────────────────────────────────

export interface ArticuloSeguimiento {
  articuloID: number;
  nombre: string;
  grupo: string | null;
  equivalencia: number;
  orden: number;
  activo: boolean;
}

export interface ConteoArticulo extends ArticuloSeguimiento {
  pendientes: number;
  despachadosHoy: number;
  minutosMasAntiguo: number | null;
}

export interface GrupoSeguimiento {
  grupo: string;
  equivalentePendiente: number;
  equivalenteDespachado: number;
  articulos: number;
}

export interface DetallePendiente {
  articuloID: number;
  articulo: string;
  pedidoID: string;
  numeroPedido: number;
  destino: string;
  mesero: string;
  meseroID: string | null;
  cantidad: number;
  minutosEsperando: number;
}

export interface PanelSeguimiento {
  hayConfiguracion: boolean;
  articulos: ConteoArticulo[];
  grupos: GrupoSeguimiento[];
  detalle: DetallePendiente[];
  totalPendiente: number;
}

function redondear(n: number, dec = 2): number {
  const f = Math.pow(10, dec);
  return Math.round((n + Number.EPSILON) * f) / f;
}

// ── Configuración ────────────────────────────────────

export async function listarSeguimiento(
  soloActivos = false
): Promise<ArticuloSeguimiento[]> {
  return query<ArticuloSeguimiento>(`
    SELECT
      s.IdArticulo   AS articuloID,
      a.Nombre       AS nombre,
      s.Grupo        AS grupo,
      s.Equivalencia AS equivalencia,
      s.Orden        AS orden,
      s.Activo       AS activo
    FROM modu_rest_ArticulosSeguimiento s
    JOIN articulo a ON s.IdArticulo = a.Id
    WHERE (@soloActivos = 0 OR s.Activo = 1)
    ORDER BY ISNULL(s.Grupo, ''), s.Orden, a.Nombre
  `, (req) => {
    req.input('soloActivos', sql.Bit, soloActivos ? 1 : 0);
  });
}

export async function guardarSeguimiento(data: {
  articuloID: number;
  grupo?: string | null;
  equivalencia: number;
  orden?: number;
  activo: boolean;
}): Promise<void> {

  if (data.equivalencia <= 0)
    throw new AppError('La equivalencia debe ser mayor a cero', 400);

  const existe = await query<{ total: number }>(`
    SELECT COUNT(*) AS total FROM articulo WHERE Id = @articuloID
  `, (req) => {
    req.input('articuloID', sql.Int, data.articuloID);
  });

  if (existe[0].total === 0)
    throw new AppError('El artículo no existe', 404);

  await query(`
    MERGE modu_rest_ArticulosSeguimiento AS destino
    USING (SELECT @articuloID AS IdArticulo) AS origen
    ON destino.IdArticulo = origen.IdArticulo
    WHEN MATCHED THEN
      UPDATE SET Grupo        = @grupo,
                 Equivalencia = @equivalencia,
                 Orden        = @orden,
                 Activo       = @activo
    WHEN NOT MATCHED THEN
      INSERT (IdArticulo, Grupo, Equivalencia, Orden, Activo)
      VALUES (@articuloID, @grupo, @equivalencia, @orden, @activo);
  `, (req) => {
    req.input('articuloID',   sql.Int,            data.articuloID);
    req.input('grupo',        sql.NVarChar,       data.grupo || null);
    req.input('equivalencia', sql.Decimal(6, 2),  data.equivalencia);
    req.input('orden',        sql.Int,            data.orden ?? 0);
    req.input('activo',       sql.Bit,            data.activo ? 1 : 0);
  });
}

export async function quitarSeguimiento(articuloID: number): Promise<void> {
  await query(`
    DELETE FROM modu_rest_ArticulosSeguimiento WHERE IdArticulo = @articuloID
  `, (req) => {
    req.input('articuloID', sql.Int, articuloID);
  });
}

// ── Panel ────────────────────────────────────────────

/**
 * Estado actual de los productos en seguimiento.
 *
 * Pendiente = está en un pedido abierto y su ronda no se ha
 * despachado. Es lo que el horno todavía debe cubrir.
 */
export async function panelSeguimiento(): Promise<PanelSeguimiento> {

  const configurados = await listarSeguimiento(true);

  if (configurados.length === 0) {
    return {
      hayConfiguracion: false,
      articulos: [],
      grupos: [],
      detalle: [],
      totalPendiente: 0,
    };
  }

  const [conteos, detalle] = await Promise.all([
    query<{
      articuloID: number;
      pendientes: number;
      despachadosHoy: number;
      minutosMasAntiguo: number | null;
    }>(`
      SELECT
        s.IdArticulo AS articuloID,

        -- Lo que el horno debe cubrir todavía
        ISNULL((
          SELECT SUM(cd.Cantidad)
          FROM modu_rest_ComandaDetalle cd
          JOIN modu_rest_Comandas c ON cd.ComandaID = c.ComandaID
          JOIN modu_rest_Pedidos  p ON cd.PedidoID  = p.PedidoID
          WHERE cd.IdArticulo = s.IdArticulo
            AND cd.EstadoItem <> 'Cancelado'
            AND c.Estado      <> 'Despachada'
            AND p.EstadoPedido IN ('Abierto', 'Por Pagar')
        ), 0) AS pendientes,

        -- Referencia del día: cuántos ya salieron
        ISNULL((
          SELECT SUM(cd.Cantidad)
          FROM modu_rest_ComandaDetalle cd
          JOIN modu_rest_Comandas c ON cd.ComandaID = c.ComandaID
          WHERE cd.IdArticulo = s.IdArticulo
            AND cd.EstadoItem <> 'Cancelado'
            AND c.Estado       = 'Despachada'
            AND ${FECHA_LOCAL('c.HoraEnviada')} =
                ${FECHA_LOCAL('SYSUTCDATETIME()')}
        ), 0) AS despachadosHoy,

        -- Cuánto lleva esperando el más viejo sin despachar
        (
          SELECT MAX(DATEDIFF(MINUTE, c.HoraEnviada, SYSUTCDATETIME()))
          FROM modu_rest_ComandaDetalle cd
          JOIN modu_rest_Comandas c ON cd.ComandaID = c.ComandaID
          JOIN modu_rest_Pedidos  p ON cd.PedidoID  = p.PedidoID
          WHERE cd.IdArticulo = s.IdArticulo
            AND cd.EstadoItem <> 'Cancelado'
            AND c.Estado      <> 'Despachada'
            AND p.EstadoPedido IN ('Abierto', 'Por Pagar')
        ) AS minutosMasAntiguo

      FROM modu_rest_ArticulosSeguimiento s
      WHERE s.Activo = 1
    `),

    // Qué mesa pidió qué, para saber a quién avisarle
    query<DetallePendiente>(`
      SELECT
        cd.IdArticulo      AS articuloID,
        cd.NombreArticulo  AS articulo,
        p.PedidoID         AS pedidoID,
        p.NumeroPedido     AS numeroPedido,
        ISNULL(m.Alias, ISNULL(p.NombreCliente, p.TipoPedido)) AS destino,
        ISNULL(u.Nombre + ' ' + u.Apellido, '—') AS mesero,
        p.MeseroID         AS meseroID,
        SUM(cd.Cantidad)   AS cantidad,
        MAX(DATEDIFF(MINUTE, c.HoraEnviada, SYSUTCDATETIME())) AS minutosEsperando
      FROM modu_rest_ComandaDetalle cd
      JOIN modu_rest_Comandas c ON cd.ComandaID = c.ComandaID
      JOIN modu_rest_Pedidos  p ON cd.PedidoID  = p.PedidoID
      JOIN modu_rest_ArticulosSeguimiento s ON cd.IdArticulo = s.IdArticulo
      LEFT JOIN modu_rest_Mesas    m ON p.MesaID   = m.MesaID
      LEFT JOIN modu_rest_Usuarios u ON p.MeseroID = u.UsuarioID
      WHERE s.Activo = 1
        AND cd.EstadoItem <> 'Cancelado'
        AND c.Estado      <> 'Despachada'
        AND p.EstadoPedido IN ('Abierto', 'Por Pagar')
      GROUP BY cd.IdArticulo, cd.NombreArticulo, p.PedidoID, p.NumeroPedido,
               m.Alias, p.NombreCliente, p.TipoPedido,
               u.Nombre, u.Apellido, p.MeseroID
      ORDER BY minutosEsperando DESC
    `),
  ]);

  const mapa = new Map(conteos.map(c => [c.articuloID, c]));

  const articulos: ConteoArticulo[] = configurados.map(a => {
    const c = mapa.get(a.articuloID);
    return {
      ...a,
      pendientes: redondear(c?.pendientes ?? 0),
      despachadosHoy: redondear(c?.despachadosHoy ?? 0),
      minutosMasAntiguo: c?.minutosMasAntiguo ?? null,
    };
  });

  // ── Totales por grupo ──
  // Un cuarto de pollo consume 0,25 del insumo. Sin esta suma, el
  // del horno tendría que hacer la cuenta mental cada vez.
  const porGrupo = new Map<string, GrupoSeguimiento>();

  for (const a of articulos) {
    const g = (a.grupo ?? '').trim();
    if (!g) continue;

    const acc = porGrupo.get(g) ?? {
      grupo: g,
      equivalentePendiente: 0,
      equivalenteDespachado: 0,
      articulos: 0,
    };

    acc.equivalentePendiente  += a.pendientes * a.equivalencia;
    acc.equivalenteDespachado += a.despachadosHoy * a.equivalencia;
    acc.articulos++;

    porGrupo.set(g, acc);
  }

  const grupos = [...porGrupo.values()].map(g => ({
    ...g,
    equivalentePendiente: redondear(g.equivalentePendiente),
    equivalenteDespachado: redondear(g.equivalenteDespachado),
  }));

  return {
    hayConfiguracion: true,
    articulos,
    grupos,
    detalle,
    totalPendiente: redondear(
      articulos.reduce((s, a) => s + a.pendientes, 0)),
  };
}

// ── Artículos disponibles para configurar ────────────
// La carta completa, marcando cuáles ya están en seguimiento.

export async function articulosConfigurables() {
  return query(`
    SELECT
      a.Id          AS articuloID,
      a.Nombre      AS nombre,
      c.Nombre      AS categoria,
      a.Venta       AS precioVenta,
      CASE WHEN s.IdArticulo IS NULL
           THEN CAST(0 AS BIT) ELSE CAST(1 AS BIT) END AS enSeguimiento,
      ISNULL(s.Activo, CAST(0 AS BIT))    AS activo,
      ISNULL(s.Grupo, '')                 AS grupo,
      ISNULL(s.Equivalencia, 1.00)        AS equivalencia,
      ISNULL(s.Orden, 0)                  AS orden
    FROM articulo a
    INNER JOIN categorias c ON a.IdCategoria = c.idCategoria
    LEFT JOIN modu_rest_ArticulosSeguimiento s ON a.Id = s.IdArticulo
    WHERE a.Estado = 1
      AND a.Venta > 0
      AND c.Nombre NOT IN ('INSUMOS COCINA', 'PRODUCTOS INVENTARIO')
    ORDER BY c.Orden, a.Nombre
  `);
}