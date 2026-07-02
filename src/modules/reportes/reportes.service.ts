// src/modules/reportes/reportes.service.ts

import { query, sql } from '../../config/database';

// ── Interfaces ───────────────────────────────────────

export interface FiltroFecha {
  desde: string;  // YYYY-MM-DD
  hasta: string;  // YYYY-MM-DD
}

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
  ventaDomicilio: number;
}

export interface ReporteMesero {
  meseroID: string;
  mesero: string;
  totalPedidos: number;
  totalFacturado: number;
  ticketPromedio: number;
  totalPersonasAtendidas: number;
}

export interface ReporteProducto {
  articuloID: number;
  articulo: string;
  cantidadVendida: number;
  totalFacturado: number;
  precioPromedio: number;
}

// ── Ventas diarias ───────────────────────────────────

export async function reporteVentasDiarias(
  filtro: FiltroFecha
): Promise<ReporteVentas[]> {
  return query<ReporteVentas>(`
    SELECT
      CONVERT(NVARCHAR(10), p.FechaApertura, 23)  AS periodo,
      ISNULL(SUM(p.TotalCuenta), 0)               AS totalVentas,
      COUNT(DISTINCT p.PedidoID)                  AS totalPedidos,
      ISNULL(AVG(p.TotalCuenta), 0)               AS ticketPromedio,
      ISNULL(SUM(p.TotalImpuestos), 0)            AS totalImpuestos,
      ISNULL(SUM(p.TotalDescuento), 0)            AS totalDescuentos,
      ISNULL(SUM(pg.totalPropinas), 0)            AS totalPropinas,
      ISNULL(SUM(pg.ventaEfectivo), 0)            AS ventaEfectivo,
      ISNULL(SUM(pg.ventaTarjeta), 0)             AS ventaTarjeta,
      ISNULL(SUM(pg.ventaDigital), 0)             AS ventaDigital,
      ISNULL(SUM(pg.ventaDomicilio), 0)           AS ventaDomicilio
    FROM modu_rest_Pedidos p
    OUTER APPLY (
      SELECT
        SUM(CASE WHEN mp.Tipo = 'Efectivo'  THEN pa.MontoPagado ELSE 0 END) AS ventaEfectivo,
        SUM(CASE WHEN mp.Tipo = 'Tarjeta'   THEN pa.MontoPagado ELSE 0 END) AS ventaTarjeta,
        SUM(CASE WHEN mp.Tipo = 'Digital'   THEN pa.MontoPagado ELSE 0 END) AS ventaDigital,
        SUM(CASE WHEN mp.Tipo = 'Domicilio' THEN pa.MontoPagado ELSE 0 END) AS ventaDomicilio,
        SUM(pa.Propina)                                                       AS totalPropinas
      FROM modu_rest_Pagos pa
      JOIN modu_rest_MetodosPago mp ON pa.MetodoID = mp.MetodoID
      WHERE pa.PedidoID = p.PedidoID AND pa.Anulado = 0
    ) pg
    WHERE
      p.EstadoPedido = 'Pagado'
      AND CAST(p.FechaApertura AS DATE) BETWEEN @desde AND @hasta
    GROUP BY CONVERT(NVARCHAR(10), p.FechaApertura, 23)
    ORDER BY periodo ASC
  `, (req) => {
    req.input('desde', sql.Date, filtro.desde);
    req.input('hasta', sql.Date, filtro.hasta);
  });
}

// ── Ventas mensuales ─────────────────────────────────

export async function reporteVentasMensuales(
  anio: number
): Promise<ReporteVentas[]> {
  return query<ReporteVentas>(`
    SELECT
      FORMAT(p.FechaApertura, 'yyyy-MM')          AS periodo,
      ISNULL(SUM(p.TotalCuenta), 0)               AS totalVentas,
      COUNT(DISTINCT p.PedidoID)                  AS totalPedidos,
      ISNULL(AVG(p.TotalCuenta), 0)               AS ticketPromedio,
      ISNULL(SUM(p.TotalImpuestos), 0)            AS totalImpuestos,
      ISNULL(SUM(p.TotalDescuento), 0)            AS totalDescuentos,
      ISNULL(SUM(pg.totalPropinas), 0)            AS totalPropinas,
      ISNULL(SUM(pg.ventaEfectivo), 0)            AS ventaEfectivo,
      ISNULL(SUM(pg.ventaTarjeta), 0)             AS ventaTarjeta,
      ISNULL(SUM(pg.ventaDigital), 0)             AS ventaDigital,
      ISNULL(SUM(pg.ventaDomicilio), 0)           AS ventaDomicilio
    FROM modu_rest_Pedidos p
    OUTER APPLY (
      SELECT
        SUM(CASE WHEN mp.Tipo = 'Efectivo'  THEN pa.MontoPagado ELSE 0 END) AS ventaEfectivo,
        SUM(CASE WHEN mp.Tipo = 'Tarjeta'   THEN pa.MontoPagado ELSE 0 END) AS ventaTarjeta,
        SUM(CASE WHEN mp.Tipo = 'Digital'   THEN pa.MontoPagado ELSE 0 END) AS ventaDigital,
        SUM(CASE WHEN mp.Tipo = 'Domicilio' THEN pa.MontoPagado ELSE 0 END) AS ventaDomicilio,
        SUM(pa.Propina)                                                       AS totalPropinas
      FROM modu_rest_Pagos pa
      JOIN modu_rest_MetodosPago mp ON pa.MetodoID = mp.MetodoID
      WHERE pa.PedidoID = p.PedidoID AND pa.Anulado = 0
    ) pg
    WHERE
      p.EstadoPedido = 'Pagado'
      AND YEAR(p.FechaApertura) = @anio
    GROUP BY FORMAT(p.FechaApertura, 'yyyy-MM')
    ORDER BY periodo ASC
  `, (req) => {
    req.input('anio', sql.Int, anio);
  });
}

// ── Ventas anuales ───────────────────────────────────

export async function reporteVentasAnuales(): Promise<ReporteVentas[]> {
  return query<ReporteVentas>(`
    SELECT
      CAST(YEAR(p.FechaApertura) AS NVARCHAR(4))  AS periodo,
      ISNULL(SUM(p.TotalCuenta), 0)               AS totalVentas,
      COUNT(DISTINCT p.PedidoID)                  AS totalPedidos,
      ISNULL(AVG(p.TotalCuenta), 0)               AS ticketPromedio,
      ISNULL(SUM(p.TotalImpuestos), 0)            AS totalImpuestos,
      ISNULL(SUM(p.TotalDescuento), 0)            AS totalDescuentos,
      ISNULL(SUM(pg.totalPropinas), 0)            AS totalPropinas,
      ISNULL(SUM(pg.ventaEfectivo), 0)            AS ventaEfectivo,
      ISNULL(SUM(pg.ventaTarjeta), 0)             AS ventaTarjeta,
      ISNULL(SUM(pg.ventaDigital), 0)             AS ventaDigital,
      ISNULL(SUM(pg.ventaDomicilio), 0)           AS ventaDomicilio
    FROM modu_rest_Pedidos p
    OUTER APPLY (
      SELECT
        SUM(CASE WHEN mp.Tipo = 'Efectivo'  THEN pa.MontoPagado ELSE 0 END) AS ventaEfectivo,
        SUM(CASE WHEN mp.Tipo = 'Tarjeta'   THEN pa.MontoPagado ELSE 0 END) AS ventaTarjeta,
        SUM(CASE WHEN mp.Tipo = 'Digital'   THEN pa.MontoPagado ELSE 0 END) AS ventaDigital,
        SUM(CASE WHEN mp.Tipo = 'Domicilio' THEN pa.MontoPagado ELSE 0 END) AS ventaDomicilio,
        SUM(pa.Propina)                                                       AS totalPropinas
      FROM modu_rest_Pagos pa
      JOIN modu_rest_MetodosPago mp ON pa.MetodoID = mp.MetodoID
      WHERE pa.PedidoID = p.PedidoID AND pa.Anulado = 0
    ) pg
    WHERE p.EstadoPedido = 'Pagado'
    GROUP BY YEAR(p.FechaApertura)
    ORDER BY periodo ASC
  `);
}

// ── Reporte por mesero ───────────────────────────────

export async function reporteMeseros(
  filtro: FiltroFecha
): Promise<ReporteMesero[]> {
  return query<ReporteMesero>(`
    SELECT
      u.UsuarioID                          AS meseroID,
      u.Nombre + ' ' + u.Apellido         AS mesero,
      COUNT(DISTINCT p.PedidoID)          AS totalPedidos,
      ISNULL(SUM(p.TotalCuenta), 0)       AS totalFacturado,
      ISNULL(AVG(p.TotalCuenta), 0)       AS ticketPromedio,
      ISNULL(SUM(p.NumeroPersonas), 0)    AS totalPersonasAtendidas
    FROM modu_rest_Usuarios u
    JOIN modu_rest_Roles r ON u.RolID = r.RolID
    LEFT JOIN modu_rest_Pedidos p
      ON  p.MeseroID = u.UsuarioID
      AND p.EstadoPedido = 'Pagado'
      AND CAST(p.FechaApertura AS DATE) BETWEEN @desde AND @hasta
    WHERE r.Nombre = 'Mesero' AND u.Activo = 1
    GROUP BY u.UsuarioID, u.Nombre, u.Apellido
    ORDER BY totalFacturado DESC
  `, (req) => {
    req.input('desde', sql.Date, filtro.desde);
    req.input('hasta', sql.Date, filtro.hasta);
  });
}

// ── Detalle de pedidos de un mesero ─────────────────

export async function detallePedidosMesero(
  meseroID: string,
  filtro: FiltroFecha
) {
  return query(`
    SELECT
      p.NumeroPedido                              AS numeroPedido,
      m.Alias                                     AS mesa,
      p.NumeroPersonas                            AS personas,
      p.FechaApertura                             AS fechaApertura,
      p.FechaCierre                               AS fechaCierre,
      p.TotalCuenta                               AS totalCuenta,
      p.TotalDescuento                            AS totalDescuento,
      p.EstadoPedido                              AS estado,
      DATEDIFF(MINUTE, p.FechaApertura,
        ISNULL(p.FechaCierre, SYSUTCDATETIME()))  AS duracionMinutos
    FROM modu_rest_Pedidos p
    LEFT JOIN modu_rest_Mesas m ON p.MesaID = m.MesaID
    WHERE
      p.MeseroID = @meseroID
      AND p.EstadoPedido = 'Pagado'
      AND CAST(p.FechaApertura AS DATE) BETWEEN @desde AND @hasta
    ORDER BY p.FechaApertura DESC
  `, (req) => {
    req.input('meseroID', sql.UniqueIdentifier, meseroID);
    req.input('desde',    sql.Date,             filtro.desde);
    req.input('hasta',    sql.Date,             filtro.hasta);
  });
}

// ── Productos más vendidos ───────────────────────────

export async function reporteProductos(
  filtro: FiltroFecha
): Promise<ReporteProducto[]> {
  return query<ReporteProducto>(`
    SELECT
      cd.IdArticulo                   AS articuloID,
      cd.NombreArticulo               AS articulo,
      SUM(cd.Cantidad)                AS cantidadVendida,
      SUM(cd.Subtotal)                AS totalFacturado,
      AVG(cd.PrecioVentaHistorico)    AS precioPromedio
    FROM modu_rest_ComandaDetalle cd
    JOIN modu_rest_Pedidos p ON cd.PedidoID = p.PedidoID
    WHERE
      p.EstadoPedido = 'Pagado'
      AND cd.EstadoItem != 'Cancelado'
      AND CAST(p.FechaApertura AS DATE) BETWEEN @desde AND @hasta
    GROUP BY cd.IdArticulo, cd.NombreArticulo
    ORDER BY cantidadVendida DESC
  `, (req) => {
    req.input('desde', sql.Date, filtro.desde);
    req.input('hasta', sql.Date, filtro.hasta);
  });
}

// ── Resumen del día ──────────────────────────────────

export async function resumenHoy() {
  const hoy = new Date().toISOString().split('T')[0];

  const [ventas, meseros, productos] = await Promise.all([
    reporteVentasDiarias({ desde: hoy, hasta: hoy }),
    reporteMeseros({ desde: hoy, hasta: hoy }),
    reporteProductos({ desde: hoy, hasta: hoy }),
  ]);

  return {
    ventas:    ventas[0] ?? null,
    meseros:   meseros.slice(0, 5),
    productos: productos.slice(0, 10),
  };
}