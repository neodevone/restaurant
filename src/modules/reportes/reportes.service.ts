// src/modules/reportes/reportes.service.ts

import { query, sql } from '../../config/database';
import { AppError } from '../../middlewares/error.middleware';

// ═══════════════════════════════════════════════════════
//  REGLAS DEL MÓDULO
//
//  1. HORA LOCAL: la base guarda todo en UTC (SYSUTCDATETIME).
//     Agrupar por fecha UTC manda la cena al día siguiente, porque
//     las 7 pm de Colombia son las 00:00 UTC. Toda agrupación por
//     fecha u hora pasa por FECHA_LOCAL / HORA_LOCAL.
//
//  2. TRES CIFRAS DISTINTAS, nunca un "total" ambiguo:
//     · VENTAS    = SUM(TotalCuenta) de pedidos cerrados (Pagado + Fiado)
//     · RECAUDO   = SUM(MontoPagado - Vuelto)  ← plata real
//     · CARTERA   = SUM(MontoEsperado) de las filas de tipo Credito
//     Se cumple: Ventas = (Recaudo - Recuperación) + Cartera generada
//
//  3. Un fiado ES una venta. Filtrar por EstadoPedido='Pagado'
//     deja las ventas incompletas.
// ═══════════════════════════════════════════════════════

// Zona horaria del negocio. Bogotá = 'SA Pacific Standard Time' (UTC-5, sin DST).
const ZONA = 'SA Pacific Standard Time';

const FECHA_LOCAL = (col: string) =>
  `CAST(${col} AT TIME ZONE 'UTC' AT TIME ZONE '${ZONA}' AS DATE)`;

const HORA_LOCAL = (col: string) =>
  `DATEPART(HOUR, ${col} AT TIME ZONE 'UTC' AT TIME ZONE '${ZONA}')`;

// Estados de pedido que representan una venta consumada
const ESTADOS_VENTA = `('Pagado', 'Fiado')`;

// ── Interfaces ───────────────────────────────────────

export interface FiltroFecha {
  desde: string;  // YYYY-MM-DD
  hasta: string;  // YYYY-MM-DD
}

export interface ResumenPeriodo {
  desde: string;
  hasta: string;
  ventas: number;
  pedidos: number;
  ticketPromedio: number;
  personas: number;
  descuentos: number;
  propinas: number;
  recaudo: number;
  recuperacionCartera: number;
  carteraGenerada: number;
  recaudoDeVentas: number;
  descuadre: number;
  efectivo: number;
  tarjeta: number;
  digital: number;
  // Comparación contra el período inmediatamente anterior
  ventasAnterior: number;
  pedidosAnterior: number;
  ticketAnterior: number;
  variacionVentas: number | null;   // % , null si no hay base
  variacionPedidos: number | null;
  variacionTicket: number | null;
}

export interface VentaDia {
  periodo: string;
  ventas: number;
  pedidos: number;
  ticketPromedio: number;
  carteraGenerada: number;
  recaudo: number;
  efectivo: number;
  tarjeta: number;
  digital: number;
  propinas: number;
  descuentos: number;
}

export interface VentaHora {
  hora: number;
  etiqueta: string;
  ventas: number;
  pedidos: number;
}

export interface MetodoResumen {
  metodo: string;
  tipo: string;
  transacciones: number;
  recibido: number;
  vueltos: number;
  recaudoNeto: number;
  propinas: number;
  porcentaje: number;
}

export interface ReporteMesero {
  meseroID: string;
  mesero: string;
  totalPedidos: number;
  totalFacturado: number;
  ticketPromedio: number;
  totalPersonasAtendidas: number;
  duracionPromedio: number;
}

export interface ReporteProducto {
  articuloID: number;
  articulo: string;
  categoria: string;
  cantidadVendida: number;
  totalFacturado: number;
  precioPromedio: number;
  participacion: number;
}

export interface PedidoBusqueda {
  pedidoID: string;
  numeroPedido: number;
  mesa: string | null;
  mesero: string;
  tipoPedido: string;
  nombreCliente: string | null;
  fechaApertura: string;
  fechaCierre: string | null;
  totalCuenta: number;
  totalDescuento: number;
  estadoPedido: string;
  metodos: string | null;
  duracionMinutos: number;
}

// ── Helpers ───────────────────────────────────────────

function periodoAnterior(filtro: FiltroFecha): FiltroFecha {
  const d = new Date(filtro.desde + 'T00:00:00Z');
  const h = new Date(filtro.hasta + 'T00:00:00Z');
  const dias = Math.round((h.getTime() - d.getTime()) / 86400000) + 1;

  const hastaAnt = new Date(d.getTime() - 86400000);
  const desdeAnt = new Date(hastaAnt.getTime() - (dias - 1) * 86400000);

  return {
    desde: desdeAnt.toISOString().split('T')[0],
    hasta: hastaAnt.toISOString().split('T')[0],
  };
}

function variacion(actual: number, anterior: number): number | null {
  if (anterior === 0) return null;
  return ((actual - anterior) / anterior) * 100;
}

function redondear(n: number, dec = 2): number {
  const f = Math.pow(10, dec);
  return Math.round((n + Number.EPSILON) * f) / f;
}

// Bloque de ventas de un rango (base: pedidos cerrados)
async function bloqueVentas(filtro: FiltroFecha) {
  const rows = await query<{
    ventas: number; pedidos: number; personas: number; descuentos: number;
  }>(`
    SELECT
      ISNULL(SUM(p.TotalCuenta), 0)    AS ventas,
      COUNT(p.PedidoID)                AS pedidos,
      ISNULL(SUM(p.NumeroPersonas), 0) AS personas,
      ISNULL(SUM(p.TotalDescuento), 0) AS descuentos
    FROM modu_rest_Pedidos p
    WHERE p.EstadoPedido IN ${ESTADOS_VENTA}
      AND p.FechaCierre IS NOT NULL
      AND ${FECHA_LOCAL('p.FechaCierre')} BETWEEN @desde AND @hasta
  `, (req) => {
    req.input('desde', sql.Date, filtro.desde);
    req.input('hasta', sql.Date, filtro.hasta);
  });
  return rows[0];
}

// ── Resumen de un período (portada de informes) ───────

export async function resumenPeriodo(
  filtro: FiltroFecha
): Promise<ResumenPeriodo> {

  const anterior = periodoAnterior(filtro);

  const [ventasAct, ventasAnt, cobros, cartera, recup] = await Promise.all([
    bloqueVentas(filtro),
    bloqueVentas(anterior),

    // Recaudo real y desglose por grupo de método
    query<{
      recaudo: number; propinas: number;
      efectivo: number; tarjeta: number; digital: number;
    }>(`
      SELECT
        ISNULL(SUM(pa.MontoPagado - pa.Vuelto), 0) AS recaudo,
        ISNULL(SUM(pa.Propina), 0)                 AS propinas,
        ISNULL(SUM(CASE WHEN mp.Tipo = 'Efectivo'
              THEN pa.MontoPagado - pa.Vuelto ELSE 0 END), 0) AS efectivo,
        ISNULL(SUM(CASE WHEN mp.Tipo = 'Tarjeta'
              THEN pa.MontoPagado - pa.Vuelto ELSE 0 END), 0) AS tarjeta,
        ISNULL(SUM(CASE WHEN mp.Tipo = 'Digital'
              THEN pa.MontoPagado - pa.Vuelto ELSE 0 END), 0) AS digital
      FROM modu_rest_Pagos pa
      JOIN modu_rest_MetodosPago mp ON pa.MetodoID = mp.MetodoID
      WHERE pa.Anulado = 0
        AND mp.Tipo <> 'Credito'
        AND ${FECHA_LOCAL('pa.FechaTransaccion')} BETWEEN @desde AND @hasta
    `, (req) => {
      req.input('desde', sql.Date, filtro.desde);
      req.input('hasta', sql.Date, filtro.hasta);
    }),

    // Cartera generada en el período
    query<{ cartera: number }>(`
      SELECT ISNULL(SUM(pa.MontoEsperado), 0) AS cartera
      FROM modu_rest_Pagos pa
      JOIN modu_rest_MetodosPago mp ON pa.MetodoID = mp.MetodoID
      WHERE pa.Anulado = 0
        AND mp.Tipo = 'Credito'
        AND ${FECHA_LOCAL('pa.FechaTransaccion')} BETWEEN @desde AND @hasta
    `, (req) => {
      req.input('desde', sql.Date, filtro.desde);
      req.input('hasta', sql.Date, filtro.hasta);
    }),

    // Recuperación de cartera: dinero de hoy sobre deudas anteriores
    query<{ recuperacion: number }>(`
      SELECT ISNULL(SUM(pa.MontoPagado - pa.Vuelto), 0) AS recuperacion
      FROM modu_rest_Pagos pa
      JOIN modu_rest_MetodosPago mp ON pa.MetodoID = mp.MetodoID
      WHERE pa.Anulado = 0
        AND mp.Tipo <> 'Credito'
        AND ${FECHA_LOCAL('pa.FechaTransaccion')} BETWEEN @desde AND @hasta
        AND EXISTS (
          SELECT 1
          FROM modu_rest_Pagos f
          JOIN modu_rest_MetodosPago fm ON f.MetodoID = fm.MetodoID
          WHERE f.PedidoID = pa.PedidoID
            AND fm.Tipo    = 'Credito'
            AND f.Anulado  = 0
            AND f.FechaTransaccion < pa.FechaTransaccion
        )
    `, (req) => {
      req.input('desde', sql.Date, filtro.desde);
      req.input('hasta', sql.Date, filtro.hasta);
    }),
  ]);

  const c = cobros[0];
  const carteraGenerada = cartera[0].cartera;
  const recuperacionCartera = recup[0].recuperacion;
  const recaudoDeVentas = c.recaudo - recuperacionCartera;

  const ticket = ventasAct.pedidos > 0 ? ventasAct.ventas / ventasAct.pedidos : 0;
  const ticketAnt = ventasAnt.pedidos > 0 ? ventasAnt.ventas / ventasAnt.pedidos : 0;

  return {
    desde: filtro.desde,
    hasta: filtro.hasta,
    ventas: redondear(ventasAct.ventas),
    pedidos: ventasAct.pedidos,
    ticketPromedio: redondear(ticket),
    personas: ventasAct.personas,
    descuentos: redondear(ventasAct.descuentos),
    propinas: redondear(c.propinas),
    recaudo: redondear(c.recaudo),
    recuperacionCartera: redondear(recuperacionCartera),
    carteraGenerada: redondear(carteraGenerada),
    recaudoDeVentas: redondear(recaudoDeVentas),
    // Debe ser 0. Si no lo es, hay un pedido cerrado sin pagos
    // o una anulación mal hecha.
    descuadre: redondear(ventasAct.ventas - (recaudoDeVentas + carteraGenerada)),
    efectivo: redondear(c.efectivo),
    tarjeta: redondear(c.tarjeta),
    digital: redondear(c.digital),
    ventasAnterior: redondear(ventasAnt.ventas),
    pedidosAnterior: ventasAnt.pedidos,
    ticketAnterior: redondear(ticketAnt),
    variacionVentas: variacion(ventasAct.ventas, ventasAnt.ventas),
    variacionPedidos: variacion(ventasAct.pedidos, ventasAnt.pedidos),
    variacionTicket: variacion(ticket, ticketAnt),
  };
}

// ── Ventas por día ───────────────────────────────────
// Incluye los días sin ventas para que las gráficas no mientan.

export async function ventasPorDia(
  filtro: FiltroFecha
): Promise<VentaDia[]> {
  return query<VentaDia>(`
    WITH Dias AS (
      SELECT CAST(@desde AS DATE) AS Fecha
      UNION ALL
      SELECT DATEADD(DAY, 1, Fecha) FROM Dias WHERE Fecha < CAST(@hasta AS DATE)
    )
    SELECT
      CONVERT(NVARCHAR(10), d.Fecha, 23)                       AS periodo,
      ISNULL(v.ventas, 0)                                      AS ventas,
      ISNULL(v.pedidos, 0)                                     AS pedidos,
      CASE WHEN ISNULL(v.pedidos, 0) > 0
           THEN v.ventas / v.pedidos ELSE 0 END                AS ticketPromedio,
      ISNULL(cr.cartera, 0)                                    AS carteraGenerada,
      ISNULL(pg.recaudo, 0)                                    AS recaudo,
      ISNULL(pg.efectivo, 0)                                   AS efectivo,
      ISNULL(pg.tarjeta, 0)                                    AS tarjeta,
      ISNULL(pg.digital, 0)                                    AS digital,
      ISNULL(pg.propinas, 0)                                   AS propinas,
      ISNULL(v.descuentos, 0)                                  AS descuentos
    FROM Dias d
    OUTER APPLY (
      SELECT
        SUM(p.TotalCuenta)    AS ventas,
        COUNT(p.PedidoID)     AS pedidos,
        SUM(p.TotalDescuento) AS descuentos
      FROM modu_rest_Pedidos p
      WHERE p.EstadoPedido IN ${ESTADOS_VENTA}
        AND p.FechaCierre IS NOT NULL
        AND ${FECHA_LOCAL('p.FechaCierre')} = d.Fecha
    ) v
    OUTER APPLY (
      SELECT
        SUM(pa.MontoPagado - pa.Vuelto) AS recaudo,
        SUM(pa.Propina)                 AS propinas,
        SUM(CASE WHEN mp.Tipo = 'Efectivo'
             THEN pa.MontoPagado - pa.Vuelto ELSE 0 END) AS efectivo,
        SUM(CASE WHEN mp.Tipo = 'Tarjeta'
             THEN pa.MontoPagado - pa.Vuelto ELSE 0 END) AS tarjeta,
        SUM(CASE WHEN mp.Tipo = 'Digital'
             THEN pa.MontoPagado - pa.Vuelto ELSE 0 END) AS digital
      FROM modu_rest_Pagos pa
      JOIN modu_rest_MetodosPago mp ON pa.MetodoID = mp.MetodoID
      WHERE pa.Anulado = 0
        AND mp.Tipo <> 'Credito'
        AND ${FECHA_LOCAL('pa.FechaTransaccion')} = d.Fecha
    ) pg
    OUTER APPLY (
      SELECT SUM(pa.MontoEsperado) AS cartera
      FROM modu_rest_Pagos pa
      JOIN modu_rest_MetodosPago mp ON pa.MetodoID = mp.MetodoID
      WHERE pa.Anulado = 0
        AND mp.Tipo = 'Credito'
        AND ${FECHA_LOCAL('pa.FechaTransaccion')} = d.Fecha
    ) cr
    ORDER BY d.Fecha ASC
    OPTION (MAXRECURSION 0)
  `, (req) => {
    req.input('desde', sql.Date, filtro.desde);
    req.input('hasta', sql.Date, filtro.hasta);
  });
}

// ── Ventas por hora (picos de servicio) ──────────────
// Usa FechaApertura: interesa cuándo llega la gente, no cuándo paga.

export async function ventasPorHora(
  filtro: FiltroFecha
): Promise<VentaHora[]> {
  const rows = await query<{ hora: number; ventas: number; pedidos: number }>(`
    SELECT
      ${HORA_LOCAL('p.FechaApertura')} AS hora,
      ISNULL(SUM(p.TotalCuenta), 0)    AS ventas,
      COUNT(p.PedidoID)                AS pedidos
    FROM modu_rest_Pedidos p
    WHERE p.EstadoPedido IN ${ESTADOS_VENTA}
      AND ${FECHA_LOCAL('p.FechaApertura')} BETWEEN @desde AND @hasta
    GROUP BY ${HORA_LOCAL('p.FechaApertura')}
  `, (req) => {
    req.input('desde', sql.Date, filtro.desde);
    req.input('hasta', sql.Date, filtro.hasta);
  });

  // Rellenar las 24 horas para que la curva sea continua
  const mapa = new Map(rows.map(r => [r.hora, r]));
  const salida: VentaHora[] = [];
  for (let h = 0; h < 24; h++) {
    const r = mapa.get(h);
    salida.push({
      hora: h,
      etiqueta: `${String(h).padStart(2, '0')}:00`,
      ventas: redondear(r?.ventas ?? 0),
      pedidos: r?.pedidos ?? 0,
    });
  }
  return salida;
}

// ── Métodos de pago ──────────────────────────────────

export async function reporteMetodosPago(
  filtro: FiltroFecha
): Promise<MetodoResumen[]> {
  const rows = await query<Omit<MetodoResumen, 'porcentaje'>>(`
    SELECT
      mp.Nombre                                  AS metodo,
      mp.Tipo                                    AS tipo,
      COUNT(pa.PagoID)                           AS transacciones,
      ISNULL(SUM(pa.MontoPagado), 0)             AS recibido,
      ISNULL(SUM(pa.Vuelto), 0)                  AS vueltos,
      ISNULL(SUM(pa.MontoPagado - pa.Vuelto), 0) AS recaudoNeto,
      ISNULL(SUM(pa.Propina), 0)                 AS propinas
    FROM modu_rest_Pagos pa
    JOIN modu_rest_MetodosPago mp ON pa.MetodoID = mp.MetodoID
    WHERE pa.Anulado = 0
      AND ${FECHA_LOCAL('pa.FechaTransaccion')} BETWEEN @desde AND @hasta
    GROUP BY mp.Nombre, mp.Tipo
    HAVING COUNT(pa.PagoID) > 0
    ORDER BY recaudoNeto DESC
  `, (req) => {
    req.input('desde', sql.Date, filtro.desde);
    req.input('hasta', sql.Date, filtro.hasta);
  });

  const total = rows.reduce((s, r) => s + r.recaudoNeto, 0);
  return rows.map(r => ({
    ...r,
    porcentaje: total > 0 ? redondear((r.recaudoNeto / total) * 100, 1) : 0,
  }));
}

// ── Reporte por mesero ───────────────────────────────

export async function reporteMeseros(
  filtro: FiltroFecha
): Promise<ReporteMesero[]> {
  return query<ReporteMesero>(`
    SELECT
      u.UsuarioID                       AS meseroID,
      u.Nombre + ' ' + u.Apellido       AS mesero,
      COUNT(p.PedidoID)                 AS totalPedidos,
      ISNULL(SUM(p.TotalCuenta), 0)     AS totalFacturado,
      ISNULL(AVG(p.TotalCuenta), 0)     AS ticketPromedio,
      ISNULL(SUM(p.NumeroPersonas), 0)  AS totalPersonasAtendidas,
      ISNULL(AVG(DATEDIFF(MINUTE, p.FechaApertura,
        ISNULL(p.FechaCierre, SYSUTCDATETIME()))), 0) AS duracionPromedio
    FROM modu_rest_Usuarios u
    JOIN modu_rest_Roles r ON u.RolID = r.RolID
    LEFT JOIN modu_rest_Pedidos p
      ON  p.MeseroID = u.UsuarioID
      AND p.EstadoPedido IN ${ESTADOS_VENTA}
      AND p.FechaCierre IS NOT NULL
      AND ${FECHA_LOCAL('p.FechaCierre')} BETWEEN @desde AND @hasta
    WHERE r.Nombre = 'Mesero' AND u.Activo = 1
    GROUP BY u.UsuarioID, u.Nombre, u.Apellido
    ORDER BY totalFacturado DESC
  `, (req) => {
    req.input('desde', sql.Date, filtro.desde);
    req.input('hasta', sql.Date, filtro.hasta);
  });
}

// ── Detalle de pedidos de un mesero ─────────────────
// Devuelve pedidoID para poder abrir el detalle completo.

export async function detallePedidosMesero(
  meseroID: string,
  filtro: FiltroFecha
): Promise<PedidoBusqueda[]> {
  return query<PedidoBusqueda>(`
    SELECT
      p.PedidoID       AS pedidoID,
      p.NumeroPedido   AS numeroPedido,
      m.Alias          AS mesa,
      u.Nombre + ' ' + u.Apellido AS mesero,
      p.TipoPedido     AS tipoPedido,
      p.NombreCliente  AS nombreCliente,
      p.FechaApertura  AS fechaApertura,
      p.FechaCierre    AS fechaCierre,
      p.TotalCuenta    AS totalCuenta,
      p.TotalDescuento AS totalDescuento,
      p.EstadoPedido   AS estadoPedido,
      STUFF((
        SELECT DISTINCT ', ' + mp2.Nombre
        FROM modu_rest_Pagos pa2
        JOIN modu_rest_MetodosPago mp2 ON pa2.MetodoID = mp2.MetodoID
        WHERE pa2.PedidoID = p.PedidoID AND pa2.Anulado = 0
        FOR XML PATH('')), 1, 2, '')                AS metodos,
      DATEDIFF(MINUTE, p.FechaApertura,
        ISNULL(p.FechaCierre, SYSUTCDATETIME()))    AS duracionMinutos
    FROM modu_rest_Pedidos p
    LEFT JOIN modu_rest_Mesas    m ON p.MesaID   = m.MesaID
    LEFT JOIN modu_rest_Usuarios u ON p.MeseroID = u.UsuarioID
    WHERE
      p.MeseroID = @meseroID
      AND p.EstadoPedido IN ${ESTADOS_VENTA}
      AND p.FechaCierre IS NOT NULL
      AND ${FECHA_LOCAL('p.FechaCierre')} BETWEEN @desde AND @hasta
    ORDER BY p.FechaApertura DESC
  `, (req) => {
    req.input('meseroID', sql.UniqueIdentifier, meseroID);
    req.input('desde', sql.Date, filtro.desde);
    req.input('hasta', sql.Date, filtro.hasta);
  });
}

// ── Productos más vendidos ───────────────────────────

export async function reporteProductos(
  filtro: FiltroFecha
): Promise<ReporteProducto[]> {
  const rows = await query<Omit<ReporteProducto, 'participacion'>>(`
    SELECT
      cd.IdArticulo                AS articuloID,
      cd.NombreArticulo            AS articulo,
      ''                           AS categoria,
      SUM(cd.Cantidad)             AS cantidadVendida,
      SUM(cd.Subtotal)             AS totalFacturado,
      CASE WHEN SUM(cd.Cantidad) > 0
           THEN SUM(cd.Subtotal) / SUM(cd.Cantidad)
           ELSE 0 END              AS precioPromedio
    FROM modu_rest_ComandaDetalle cd
    JOIN modu_rest_Pedidos p ON cd.PedidoID = p.PedidoID
    WHERE
      p.EstadoPedido IN ${ESTADOS_VENTA}
      AND p.FechaCierre IS NOT NULL
      AND cd.EstadoItem <> 'Cancelado'
      AND ${FECHA_LOCAL('p.FechaCierre')} BETWEEN @desde AND @hasta
    GROUP BY cd.IdArticulo, cd.NombreArticulo
    ORDER BY cantidadVendida DESC
  `, (req) => {
    req.input('desde', sql.Date, filtro.desde);
    req.input('hasta', sql.Date, filtro.hasta);
  });

  const total = rows.reduce((s, r) => s + r.totalFacturado, 0);
  return rows.map(r => ({
    ...r,
    // Precio promedio ponderado, no AVG del histórico:
    // 2 unidades a 10.000 pesan distinto que 1 a 5.000.
    participacion: total > 0 ? redondear((r.totalFacturado / total) * 100, 1) : 0,
  }));
}

// ── Buscador de pedidos ──────────────────────────────
// Para atender reclamos: "¿qué se pidió en esa venta?"

export async function buscarPedidos(params: {
  desde: string;
  hasta: string;
  texto?: string;
  estado?: string;
  limite?: number;
}): Promise<PedidoBusqueda[]> {
  const limite = Math.min(params.limite ?? 300, 1000);

  return query<PedidoBusqueda>(`
    SELECT TOP (@limite)
      p.PedidoID       AS pedidoID,
      p.NumeroPedido   AS numeroPedido,
      m.Alias          AS mesa,
      ISNULL(u.Nombre + ' ' + u.Apellido, '—') AS mesero,
      p.TipoPedido     AS tipoPedido,
      p.NombreCliente  AS nombreCliente,
      p.FechaApertura  AS fechaApertura,
      p.FechaCierre    AS fechaCierre,
      p.TotalCuenta    AS totalCuenta,
      p.TotalDescuento AS totalDescuento,
      p.EstadoPedido   AS estadoPedido,
      STUFF((
        SELECT DISTINCT ', ' + mp2.Nombre
        FROM modu_rest_Pagos pa2
        JOIN modu_rest_MetodosPago mp2 ON pa2.MetodoID = mp2.MetodoID
        WHERE pa2.PedidoID = p.PedidoID AND pa2.Anulado = 0
        FOR XML PATH('')), 1, 2, '')             AS metodos,
      DATEDIFF(MINUTE, p.FechaApertura,
        ISNULL(p.FechaCierre, SYSUTCDATETIME())) AS duracionMinutos
    FROM modu_rest_Pedidos p
    LEFT JOIN modu_rest_Mesas    m ON p.MesaID   = m.MesaID
    LEFT JOIN modu_rest_Usuarios u ON p.MeseroID = u.UsuarioID
    WHERE
      ${FECHA_LOCAL('p.FechaApertura')} BETWEEN @desde AND @hasta
      AND (@estado IS NULL OR p.EstadoPedido = @estado)
      AND (
        @texto IS NULL
        OR CAST(p.NumeroPedido AS NVARCHAR(20)) LIKE '%' + @texto + '%'
        OR m.Alias          LIKE '%' + @texto + '%'
        OR p.NombreCliente  LIKE '%' + @texto + '%'
        OR u.Nombre         LIKE '%' + @texto + '%'
        OR u.Apellido       LIKE '%' + @texto + '%'
        OR EXISTS (
            SELECT 1 FROM modu_rest_ComandaDetalle cdx
            WHERE cdx.PedidoID = p.PedidoID
              AND cdx.NombreArticulo LIKE '%' + @texto + '%'
        )
      )
    ORDER BY p.FechaApertura DESC
  `, (req) => {
    req.input('limite', sql.Int, limite);
    req.input('desde', sql.Date, params.desde);
    req.input('hasta', sql.Date, params.hasta);
    req.input('texto', sql.NVarChar, params.texto?.trim() || null);
    req.input('estado', sql.NVarChar, params.estado || null);
  });
}

// ── Detalle completo de un pedido ────────────────────
// El componente que resuelve el reclamo: qué se pidió,
// quién atendió, cómo se pagó.

export async function detalleCompletoPedido(pedidoID: string) {
  const cabecera = await query(`
    SELECT
      p.PedidoID       AS pedidoID,
      p.NumeroPedido   AS numeroPedido,
      m.Alias          AS mesa,
      z.Nombre         AS zona,
      ISNULL(u.Nombre + ' ' + u.Apellido, '—') AS mesero,
      p.TipoPedido     AS tipoPedido,
      p.NombreCliente  AS nombreCliente,
      p.NumeroPersonas AS numeroPersonas,
      p.FechaApertura  AS fechaApertura,
      p.FechaCierre    AS fechaCierre,
      p.EstadoPedido   AS estadoPedido,
      p.Subtotal       AS subtotal,
      p.TotalImpuestos AS totalImpuestos,
      p.TotalDescuento AS totalDescuento,
      p.TotalCuenta    AS totalCuenta,
      p.NotasGenerales AS notasGenerales,
      DATEDIFF(MINUTE, p.FechaApertura,
        ISNULL(p.FechaCierre, SYSUTCDATETIME())) AS duracionMinutos
    FROM modu_rest_Pedidos p
    LEFT JOIN modu_rest_Mesas    m ON p.MesaID   = m.MesaID
    LEFT JOIN modu_rest_Zonas    z ON m.ZonaID   = z.ZonaID
    LEFT JOIN modu_rest_Usuarios u ON p.MeseroID = u.UsuarioID
    WHERE p.PedidoID = @pedidoID
  `, (req) => {
    req.input('pedidoID', sql.UniqueIdentifier, pedidoID);
  });

  if (cabecera.length === 0) throw new AppError('Pedido no encontrado', 404);

  const items = await query(`
    SELECT
      cd.DetalleID            AS detalleID,
      cd.IdArticulo           AS articuloID,
      cd.NombreArticulo       AS articulo,
      cd.Cantidad             AS cantidad,
      cd.PrecioVentaHistorico AS precioUnitario,
      cd.MontoDescuento       AS montoDescuento,
      cd.Subtotal             AS subtotal,
      cd.EstadoItem           AS estadoItem,
      cd.NotasEspeciales      AS notasEspeciales,
      cd.HoraPedido           AS horaPedido,
      c.NumeroRonda           AS numeroRonda
    FROM modu_rest_ComandaDetalle cd
    LEFT JOIN modu_rest_Comandas c ON cd.ComandaID = c.ComandaID
    WHERE cd.PedidoID = @pedidoID
    ORDER BY cd.HoraPedido, cd.NombreArticulo
  `, (req) => {
    req.input('pedidoID', sql.UniqueIdentifier, pedidoID);
  });

  const pagos = await query(`
    SELECT
      pa.PagoID            AS pagoID,
      mp.Nombre            AS metodoNombre,
      mp.Tipo              AS metodoTipo,
      ISNULL(u.Nombre + ' ' + u.Apellido, '—') AS cajero,
      pa.MontoPagado       AS montoPagado,
      pa.MontoEsperado     AS montoEsperado,
      pa.Vuelto            AS vuelto,
      pa.Propina           AS propina,
      pa.ReferenciaExterna AS referenciaExterna,
      pa.MetadataPago      AS metadataPago,
      pa.FechaTransaccion  AS fechaTransaccion,
      pa.Anulado           AS anulado,
      pa.MotivoBaja        AS motivoBaja
    FROM modu_rest_Pagos pa
    JOIN modu_rest_MetodosPago mp ON pa.MetodoID = mp.MetodoID
    LEFT JOIN modu_rest_Usuarios u ON pa.CajeroID = u.UsuarioID
    WHERE pa.PedidoID = @pedidoID
    ORDER BY pa.FechaTransaccion
  `, (req) => {
    req.input('pedidoID', sql.UniqueIdentifier, pedidoID);
  });

  return { pedido: cabecera[0], items, pagos };
}

// ── Resumen del día (dashboard) ──────────────────────

export async function resumenHoy() {
  // Fecha local del negocio, no UTC
  const rows = await query<{ hoy: string }>(`
    SELECT CONVERT(NVARCHAR(10),
      ${FECHA_LOCAL('SYSUTCDATETIME()')}, 23) AS hoy
  `);
  const hoy = rows[0].hoy;
  const filtro = { desde: hoy, hasta: hoy };

  const [resumen, meseros, productos, horas, metodos] = await Promise.all([
    resumenPeriodo(filtro),
    reporteMeseros(filtro),
    reporteProductos(filtro),
    ventasPorHora(filtro),
    reporteMetodosPago(filtro),
  ]);

  return {
    fecha: hoy,
    resumen,
    meseros: meseros.filter(m => m.totalPedidos > 0).slice(0, 5),
    productos: productos.slice(0, 10),
    horas,
    metodos,
  };
}

// ── Compatibilidad con el front actual ───────────────
// Mantiene la firma anterior para no romper nada mientras
// se migran las pantallas.

export interface ReporteVentas {
  periodo: string;
  totalVentas: number;
  totalPedidos: number;
  ticketPromedio: number;
  totalImpuestos: number;
  totalDescuentos: number;
  totalPropinas: number;
  ventaEfectivo: number;
  ventaTarjeta: number;
  ventaDigital: number;
}

export async function reporteVentasDiarias(
  filtro: FiltroFecha
): Promise<ReporteVentas[]> {
  const dias = await ventasPorDia(filtro);
  return dias.map(d => ({
    periodo: d.periodo,
    totalVentas: d.ventas,
    totalPedidos: d.pedidos,
    ticketPromedio: d.ticketPromedio,
    totalImpuestos: 0,
    totalDescuentos: d.descuentos,
    totalPropinas: d.propinas,
    ventaEfectivo: d.efectivo,
    ventaTarjeta: d.tarjeta,
    ventaDigital: d.digital,
  }));
}

export async function reporteVentasMensuales(anio: number) {
  return query(`
    SELECT
      FORMAT(${FECHA_LOCAL('p.FechaCierre')}, 'yyyy-MM') AS periodo,
      ISNULL(SUM(p.TotalCuenta), 0)     AS totalVentas,
      COUNT(p.PedidoID)                 AS totalPedidos,
      ISNULL(AVG(p.TotalCuenta), 0)     AS ticketPromedio,
      ISNULL(SUM(p.TotalDescuento), 0)  AS totalDescuentos
    FROM modu_rest_Pedidos p
    WHERE p.EstadoPedido IN ${ESTADOS_VENTA}
      AND p.FechaCierre IS NOT NULL
      AND YEAR(${FECHA_LOCAL('p.FechaCierre')}) = @anio
    GROUP BY FORMAT(${FECHA_LOCAL('p.FechaCierre')}, 'yyyy-MM')
    ORDER BY periodo ASC
  `, (req) => {
    req.input('anio', sql.Int, anio);
  });
}

export async function reporteVentasAnuales() {
  return query(`
    SELECT
      CAST(YEAR(${FECHA_LOCAL('p.FechaCierre')}) AS NVARCHAR(4)) AS periodo,
      ISNULL(SUM(p.TotalCuenta), 0)    AS totalVentas,
      COUNT(p.PedidoID)                AS totalPedidos,
      ISNULL(AVG(p.TotalCuenta), 0)    AS ticketPromedio,
      ISNULL(SUM(p.TotalDescuento), 0) AS totalDescuentos
    FROM modu_rest_Pedidos p
    WHERE p.EstadoPedido IN ${ESTADOS_VENTA}
      AND p.FechaCierre IS NOT NULL
    GROUP BY YEAR(${FECHA_LOCAL('p.FechaCierre')})
    ORDER BY periodo ASC
  `);
}