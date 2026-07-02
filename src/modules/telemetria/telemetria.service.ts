// src/modules/telemetria/telemetria.service.ts

import { query, sql } from '../../config/database';

// ── Interfaces ───────────────────────────────────────

export interface MetricasHoy {
  pedidosHoy: number;
  ventasHoy: number;
  ticketPromedio: number;
  mesasActivas: number;
  comandasPendientes: number;
  promedioSegundosCocina: number;
  promedioMinutosCocina: number;
  totalPropinas: number;
}

export interface ResumenVentasPorHora {
  hora: number;
  totalPedidos: number;
  totalVentas: number;
}

export interface ResumenPorMesero {
  meseroID: string;
  mesero: string;
  totalPedidos: number;
  totalVentas: number;
  ticketPromedio: number;
  promedioMinutosCocina: number;
}

export interface ResumenPorArticulo {
  articuloID: string;
  articulo: string;
  categoria: string;
  cantidadVendida: number;
  totalVendido: number;
}

export interface ResumenPorMetodo {
  metodo: string;
  tipo: string;
  totalTransacciones: number;
  totalMonto: number;
}

export interface EstadoMesasResumen {
  libres: number;
  ocupadas: number;
  reservadas: number;
  sucias: number;
  cuentaPedida: number;
  total: number;
}

export interface AlertaKDS {
  comandaID: string;
  pedidoID: string;
  numeroPedido: number;
  mesaAlias: string | null;
  numeroRonda: number;
  minutosDesdeEnvio: number;
  semaforo: string;
  estado: string;
}

// ── Métricas del día en tiempo real ─────────────────

export async function obtenerMetricasHoy(): Promise<MetricasHoy> {
  const rows = await query<MetricasHoy>(`
    SELECT
      COUNT(DISTINCT p.PedidoID)                                    AS pedidosHoy,
      ISNULL(SUM(p.TotalCuenta), 0)                                 AS ventasHoy,
      ISNULL(AVG(p.TotalCuenta), 0)                                 AS ticketPromedio,
      COUNT(DISTINCT CASE
        WHEN p.EstadoPedido IN ('Abierto','Por Pagar')
        THEN p.PedidoID END)                                        AS mesasActivas,
      COUNT(DISTINCT CASE
        WHEN c.Estado NOT IN ('Despachada','Cancelada')
        THEN c.ComandaID END)                                       AS comandasPendientes,
      ISNULL(AVG(CASE
        WHEN c.TiempoTotal IS NOT NULL
        THEN c.TiempoTotal END), 0)                                 AS promedioSegundosCocina,
      ISNULL(AVG(CASE
        WHEN c.TiempoTotal IS NOT NULL
        THEN c.TiempoTotal / 60.0 END), 0)                         AS promedioMinutosCocina,
      ISNULL((
        SELECT SUM(Propina) FROM Pagos
        WHERE CAST(FechaTransaccion AS DATE) = CAST(SYSUTCDATETIME() AS DATE)
          AND Anulado = 0
      ), 0)                                                         AS totalPropinas
    FROM Pedidos p
    LEFT JOIN Comandas c ON p.PedidoID = c.PedidoID
    WHERE CAST(p.FechaApertura AS DATE) = CAST(SYSUTCDATETIME() AS DATE)
  `);

  return rows[0];
}

// ── Ventas por hora del día ──────────────────────────
// Permite ver los picos de demanda — útil para staffing

export async function ventasPorHora(
  fecha?: string
): Promise<ResumenVentasPorHora[]> {
  return query<ResumenVentasPorHora>(`
    SELECT
      DATEPART(HOUR, FechaApertura)   AS hora,
      COUNT(*)                        AS totalPedidos,
      ISNULL(SUM(TotalCuenta), 0)     AS totalVentas
    FROM Pedidos
    WHERE
      CAST(FechaApertura AS DATE) = ISNULL(@fecha, CAST(SYSUTCDATETIME() AS DATE))
      AND EstadoPedido = 'Pagado'
    GROUP BY DATEPART(HOUR, FechaApertura)
    ORDER BY hora
  `, (req) => {
    req.input('fecha', sql.Date, fecha ?? null);
  });
}

// ── Rendimiento por mesero ───────────────────────────

export async function rendimientoPorMesero(
  fecha?: string
): Promise<ResumenPorMesero[]> {
  return query<ResumenPorMesero>(`
    SELECT
      u.UsuarioID                         AS meseroID,
      u.Nombre + ' ' + u.Apellido         AS mesero,
      COUNT(DISTINCT p.PedidoID)          AS totalPedidos,
      ISNULL(SUM(p.TotalCuenta), 0)       AS totalVentas,
      ISNULL(AVG(p.TotalCuenta), 0)       AS ticketPromedio,
      ISNULL(AVG(c.TiempoTotal / 60.0), 0) AS promedioMinutosCocina
    FROM Usuarios u
    JOIN Pedidos p   ON p.MeseroID  = u.UsuarioID
    LEFT JOIN Comandas c ON c.PedidoID = p.PedidoID
      AND c.Estado = 'Despachada'
    WHERE
      CAST(p.FechaApertura AS DATE) = ISNULL(@fecha, CAST(SYSUTCDATETIME() AS DATE))
      AND p.EstadoPedido = 'Pagado'
    GROUP BY u.UsuarioID, u.Nombre, u.Apellido
    ORDER BY totalVentas DESC
  `, (req) => {
    req.input('fecha', sql.Date, fecha ?? null);
  });
}

// ── Top artículos más vendidos ───────────────────────

export async function topArticulos(
  fecha?: string,
  top = 10
): Promise<ResumenPorArticulo[]> {
  return query<ResumenPorArticulo>(`
    SELECT TOP (@top)
      a.ArticuloID              AS articuloID,
      a.Nombre                  AS articulo,
      cat.Nombre                AS categoria,
      SUM(cd.Cantidad)          AS cantidadVendida,
      ISNULL(SUM(cd.Subtotal), 0) AS totalVendido
    FROM ComandaDetalle cd
    JOIN Articulos  a   ON cd.ArticuloID = a.ArticuloID
    JOIN Categorias cat ON a.CategoriaID = cat.CategoriaID
    JOIN Pedidos    p   ON cd.PedidoID   = p.PedidoID
    WHERE
      CAST(p.FechaApertura AS DATE) = ISNULL(@fecha, CAST(SYSUTCDATETIME() AS DATE))
      AND p.EstadoPedido = 'Pagado'
    GROUP BY a.ArticuloID, a.Nombre, cat.Nombre
    ORDER BY cantidadVendida DESC
  `, (req) => {
    req.input('fecha', sql.Date,    fecha ?? null);
    req.input('top',   sql.Int,     top);
  });
}

// ── Ventas por método de pago ────────────────────────

export async function ventasPorMetodo(
  fecha?: string
): Promise<ResumenPorMetodo[]> {
  return query<ResumenPorMetodo>(`
    SELECT
      mp.Nombre               AS metodo,
      mp.Tipo                 AS tipo,
      COUNT(*)                AS totalTransacciones,
      ISNULL(SUM(p.MontoPagado), 0) AS totalMonto
    FROM Pagos p
    JOIN MetodosPago mp ON p.MetodoID = mp.MetodoID
    WHERE
      CAST(p.FechaTransaccion AS DATE) = ISNULL(@fecha, CAST(SYSUTCDATETIME() AS DATE))
      AND p.Anulado = 0
    GROUP BY mp.Nombre, mp.Tipo
    ORDER BY totalMonto DESC
  `, (req) => {
    req.input('fecha', sql.Date, fecha ?? null);
  });
}

// ── Estado actual de las mesas ───────────────────────

export async function estadoMesas(): Promise<EstadoMesasResumen> {
  const rows = await query<{
    estado: string;
    total: number;
  }>(`
    SELECT Estado AS estado, COUNT(*) AS total
    FROM Mesas
    WHERE Activa = 1
    GROUP BY Estado
  `);

  const resumen: EstadoMesasResumen = {
    libres:       0,
    ocupadas:     0,
    reservadas:   0,
    sucias:       0,
    cuentaPedida: 0,
    total:        0,
  };

  rows.forEach(r => {
    resumen.total += r.total;
    switch (r.estado) {
      case 'Libre':          resumen.libres       += r.total; break;
      case 'Ocupada':        resumen.ocupadas     += r.total; break;
      case 'Reservada':      resumen.reservadas   += r.total; break;
      case 'Sucia':          resumen.sucias       += r.total; break;
      case 'Cuenta-Pedida':  resumen.cuentaPedida += r.total; break;
    }
  });

  return resumen;
}

// ── Alertas KDS activas ──────────────────────────────
// Comandas que llevan mucho tiempo sin despacharse

export async function alertasKDS(): Promise<AlertaKDS[]> {
  return query<AlertaKDS>(`
    SELECT
      c.ComandaID     AS comandaID,
      c.PedidoID      AS pedidoID,
      p.NumeroPedido  AS numeroPedido,
      m.Alias         AS mesaAlias,
      c.NumeroRonda   AS numeroRonda,
      DATEDIFF(MINUTE, c.HoraEnviada, SYSUTCDATETIME()) AS minutosDesdeEnvio,
      CASE
        WHEN DATEDIFF(MINUTE, c.HoraEnviada, SYSUTCDATETIME()) >= 20 THEN 'ROJO'
        WHEN DATEDIFF(MINUTE, c.HoraEnviada, SYSUTCDATETIME()) >= 10 THEN 'AMARILLO'
        ELSE 'VERDE'
      END AS semaforo,
      c.Estado        AS estado
    FROM Comandas c
    JOIN Pedidos p ON c.PedidoID = p.PedidoID
    LEFT JOIN Mesas m ON p.MesaID = m.MesaID
    WHERE c.Estado NOT IN ('Despachada', 'Cancelada')
      AND DATEDIFF(MINUTE, c.HoraEnviada, SYSUTCDATETIME()) >= 10
    ORDER BY minutosDesdeEnvio DESC
  `);
}

// ── Comparativo semanal ──────────────────────────────
// Ventas de los últimos 7 días para ver tendencia

export async function comparativoSemanal() {
  return query(`
    SELECT
      CAST(FechaApertura AS DATE)     AS fecha,
      DATENAME(WEEKDAY, FechaApertura) AS diaSemana,
      COUNT(*)                        AS totalPedidos,
      ISNULL(SUM(TotalCuenta), 0)     AS totalVentas,
      ISNULL(AVG(TotalCuenta), 0)     AS ticketPromedio
    FROM Pedidos
    WHERE
      FechaApertura >= DATEADD(DAY, -6, CAST(SYSUTCDATETIME() AS DATE))
      AND EstadoPedido = 'Pagado'
    GROUP BY CAST(FechaApertura AS DATE), DATENAME(WEEKDAY, FechaApertura)
    ORDER BY fecha DESC
  `);
}

// ── Dashboard completo ───────────────────────────────
// Un solo endpoint que devuelve todo lo que necesita
// la pantalla principal del dueño

export async function dashboardCompleto(fecha?: string) {
  const [
    metricas,
    porHora,
    porMesero,
    articulos,
    porMetodo,
    mesas,
    alertas,
    semanal,
  ] = await Promise.all([
    obtenerMetricasHoy(),
    ventasPorHora(fecha),
    rendimientoPorMesero(fecha),
    topArticulos(fecha),
    ventasPorMetodo(fecha),
    estadoMesas(),
    alertasKDS(),
    comparativoSemanal(),
  ]);

  return {
    metricas,
    porHora,
    porMesero,
    topArticulos: articulos,
    porMetodo,
    mesas,
    alertas,
    semanal,
    generadoEn: new Date().toISOString(),
  };
}