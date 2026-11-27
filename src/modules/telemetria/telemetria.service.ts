// src/modules/telemetria/telemetria.service.ts

import { query, sql } from '../../config/database';
import { joinMenu, nombreCategoria } from '../../shared/menuCategorias';
import {
  OFFSET_HORAS_NEGOCIO, HOY_LOCAL, fechaLocal, enDiaLocal, entreDiasLocales,
} from '../../shared/fechas';
// Misma definición de "venta" que los informes (un fiado ES una venta),
// para que el dashboard de la app y los informes muestren las mismas cifras.
import { ESTADOS_VENTA } from '../reportes/reportes.service';

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
  articuloID: number;
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

// ── Fechas ───────────────────────────────────────────
// Las fechas se guardan en UTC; el "día" es el de Colombia (ver
// shared/fechas.ts). @fecha llega como 'YYYY-MM-DD' local, o NULL = hoy.
const DIA = `ISNULL(@fecha, ${HOY_LOCAL})`;

// Segundos que tardó una comanda en cocina (envío → lista/despacho).
const SEGUNDOS_COCINA =
  'DATEDIFF(SECOND, c.HoraEnviada, COALESCE(c.HoraLista, c.HoraDespachada))';

// ── Métricas del día en tiempo real ─────────────────

export async function obtenerMetricasHoy(): Promise<MetricasHoy> {
  // Pedidos, comandas y pagos se agregan por separado: unirlos antes de
  // sumar repetía el TotalCuenta del pedido una vez por cada ronda.
  const rows = await query<MetricasHoy>(`
    SELECT
      ped.pedidosHoy, ped.ventasHoy, ped.ticketPromedio, ped.mesasActivas,
      com.comandasPendientes,
      com.promedioSegundosCocina,
      com.promedioSegundosCocina / 60.0 AS promedioMinutosCocina,
      pag.totalPropinas
    FROM (
      SELECT
        COUNT(v.TotalCuenta)                                         AS pedidosHoy,
        ISNULL(SUM(v.TotalCuenta), 0)                                AS ventasHoy,
        ISNULL(AVG(v.TotalCuenta), 0)                                AS ticketPromedio,
        ISNULL(SUM(CASE WHEN p.EstadoPedido IN ('Abierto','Por Pagar')
                         AND p.MesaID IS NOT NULL THEN 1 ELSE 0 END), 0) AS mesasActivas
      FROM modu_rest_Pedidos p
      CROSS APPLY (
        SELECT CASE WHEN p.EstadoPedido IN ${ESTADOS_VENTA}
                    THEN p.TotalCuenta END AS TotalCuenta
      ) v
      WHERE ${enDiaLocal('p.FechaApertura', HOY_LOCAL)}
    ) ped
    CROSS JOIN (
      SELECT
        ISNULL(SUM(CASE WHEN c.Estado NOT IN ('Despachada','Cancelada','Lista')
                        THEN 1 ELSE 0 END), 0)                       AS comandasPendientes,
        ISNULL(AVG(CAST(${SEGUNDOS_COCINA} AS FLOAT)), 0)            AS promedioSegundosCocina
      FROM modu_rest_Comandas c
      WHERE ${enDiaLocal('c.HoraEnviada', HOY_LOCAL)}
    ) com
    CROSS JOIN (
      SELECT ISNULL(SUM(Propina), 0) AS totalPropinas
      FROM modu_rest_Pagos
      WHERE ${enDiaLocal('FechaTransaccion', HOY_LOCAL)}
        AND Anulado = 0
    ) pag
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
      DATEPART(HOUR, DATEADD(HOUR, ${OFFSET_HORAS_NEGOCIO}, FechaApertura)) AS hora,
      COUNT(*)                        AS totalPedidos,
      ISNULL(SUM(TotalCuenta), 0)     AS totalVentas
    FROM modu_rest_Pedidos
    WHERE
      ${enDiaLocal('FechaApertura', DIA)}
      AND EstadoPedido IN ${ESTADOS_VENTA}
    GROUP BY DATEPART(HOUR, DATEADD(HOUR, ${OFFSET_HORAS_NEGOCIO}, FechaApertura))
    ORDER BY hora
  `, (req) => {
    req.input('fecha', sql.Date, fecha ?? null);
  });
}

// ── Rendimiento por mesero ───────────────────────────

export async function rendimientoPorMesero(
  fecha?: string
): Promise<ResumenPorMesero[]> {
  // El tiempo de cocina se promedia aparte (OUTER APPLY) para no repetir
  // el total del pedido por cada comanda despachada.
  return query<ResumenPorMesero>(`
    SELECT
      u.UsuarioID                         AS meseroID,
      u.Nombre + ' ' + u.Apellido         AS mesero,
      COUNT(*)                            AS totalPedidos,
      ISNULL(SUM(p.TotalCuenta), 0)       AS totalVentas,
      ISNULL(AVG(p.TotalCuenta), 0)       AS ticketPromedio,
      ISNULL(AVG(coc.minutos), 0)         AS promedioMinutosCocina
    FROM modu_rest_Usuarios u
    JOIN modu_rest_Pedidos p ON p.MeseroID = u.UsuarioID
    OUTER APPLY (
      SELECT AVG(CAST(${SEGUNDOS_COCINA} AS FLOAT)) / 60.0 AS minutos
      FROM modu_rest_Comandas c
      WHERE c.PedidoID = p.PedidoID AND c.Estado = 'Despachada'
    ) coc
    WHERE
      ${enDiaLocal('p.FechaApertura', DIA)}
      AND p.EstadoPedido IN ${ESTADOS_VENTA}
    GROUP BY u.UsuarioID, u.Nombre, u.Apellido
    ORDER BY totalVentas DESC
  `, (req) => {
    req.input('fecha', sql.Date, fecha ?? null);
  });
}

// ── Top artículos más vendidos ───────────────────────
// El catálogo vive en las tablas del contable (articulo / categorias).

export async function topArticulos(
  fecha?: string,
  top = 10
): Promise<ResumenPorArticulo[]> {
  return query<ResumenPorArticulo>(`
    SELECT TOP (@top)
      a.Id                        AS articuloID,
      a.Nombre                    AS articulo,
      ${nombreCategoria('cat')}   AS categoria,
      SUM(cd.Cantidad)            AS cantidadVendida,
      ISNULL(SUM(cd.Subtotal), 0) AS totalVendido
    FROM modu_rest_ComandaDetalle cd
    JOIN articulo           a   ON cd.IdArticulo = a.Id
    LEFT JOIN categorias    cat ON a.IdCategoria = cat.idCategoria
    ${joinMenu('cat')}
    JOIN modu_rest_Pedidos  p   ON cd.PedidoID   = p.PedidoID
    WHERE
      ${enDiaLocal('p.FechaApertura', DIA)}
      AND p.EstadoPedido IN ${ESTADOS_VENTA}
      AND cd.EstadoItem <> 'Cancelado'
    GROUP BY a.Id, a.Nombre, ${nombreCategoria('cat')}
    ORDER BY cantidadVendida DESC
  `, (req) => {
    req.input('fecha', sql.Date,    fecha ?? null);
    req.input('top',   sql.Int,     top);
  });
}

// ── Ventas por método de pago ────────────────────────
// Monto neto recibido: lo pagado menos el vuelto devuelto.

export async function ventasPorMetodo(
  fecha?: string
): Promise<ResumenPorMetodo[]> {
  return query<ResumenPorMetodo>(`
    SELECT
      mp.Nombre               AS metodo,
      mp.Tipo                 AS tipo,
      COUNT(*)                AS totalTransacciones,
      ISNULL(SUM(p.MontoPagado - p.Vuelto), 0) AS totalMonto
    FROM modu_rest_Pagos p
    JOIN modu_rest_MetodosPago mp ON p.MetodoID = mp.MetodoID
    WHERE
      ${enDiaLocal('p.FechaTransaccion', DIA)}
      AND p.Anulado = 0
    GROUP BY mp.Nombre, mp.Tipo
    ORDER BY totalMonto DESC
  `, (req) => {
    req.input('fecha', sql.Date, fecha ?? null);
  });
}

// ── Estado actual de las mesas ───────────────────────
// Ocupada / Cuenta-Pedida salen del pedido activo (igual que el mapa
// de mesas); Libre, Reservada y Sucia, de la columna Estado.

export async function estadoMesas(): Promise<EstadoMesasResumen> {
  const rows = await query<{
    estado: string;
    total: number;
  }>(`
    SELECT x.estado, COUNT(*) AS total
    FROM (
      SELECT
        CASE
          WHEN p.EstadoPedido = 'Por Pagar' THEN 'Cuenta-Pedida'
          WHEN p.EstadoPedido = 'Abierto'   THEN 'Ocupada'
          WHEN m.Estado IN ('Ocupada', 'Cuenta-Pedida') THEN 'Libre'
          ELSE m.Estado
        END AS estado
      FROM modu_rest_Mesas m
      JOIN modu_rest_Zonas z ON z.ZonaID = m.ZonaID AND z.Activa = 1
      LEFT JOIN modu_rest_Pedidos p
        ON p.MesaID = m.MesaID AND p.EstadoPedido IN ('Abierto', 'Por Pagar')
      WHERE m.Activa = 1
    ) x
    GROUP BY x.estado
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
// Comandas que llevan mucho tiempo sin despacharse (las de pedidos
// cancelados ya quedan en estado 'Cancelada').

export async function alertasKDS(): Promise<AlertaKDS[]> {
  return query<AlertaKDS>(`
    SELECT
      c.ComandaID     AS comandaID,
      c.PedidoID      AS pedidoID,
      p.NumeroPedido  AS numeroPedido,
      ISNULL(m.Alias, p.MesaAlias) AS mesaAlias,
      c.NumeroRonda   AS numeroRonda,
      DATEDIFF(MINUTE, c.HoraEnviada, SYSUTCDATETIME()) AS minutosDesdeEnvio,
      CASE
        WHEN DATEDIFF(MINUTE, c.HoraEnviada, SYSUTCDATETIME()) >= 20 THEN 'ROJO'
        WHEN DATEDIFF(MINUTE, c.HoraEnviada, SYSUTCDATETIME()) >= 10 THEN 'AMARILLO'
        ELSE 'VERDE'
      END AS semaforo,
      c.Estado        AS estado
    FROM modu_rest_Comandas c
    JOIN modu_rest_Pedidos p ON c.PedidoID = p.PedidoID
    LEFT JOIN modu_rest_Mesas m ON p.MesaID = m.MesaID
    WHERE c.Estado NOT IN ('Despachada', 'Cancelada', 'Lista')
      AND DATEDIFF(MINUTE, c.HoraEnviada, SYSUTCDATETIME()) >= 10
    ORDER BY minutosDesdeEnvio DESC
  `);
}

// ── Comparativo semanal ──────────────────────────────
// Ventas de los últimos 7 días (locales) para ver tendencia

export async function comparativoSemanal() {
  return query(`
    SELECT
      d.fecha,
      DATENAME(WEEKDAY, d.fecha)      AS diaSemana,
      COUNT(*)                        AS totalPedidos,
      ISNULL(SUM(d.TotalCuenta), 0)   AS totalVentas,
      ISNULL(AVG(d.TotalCuenta), 0)   AS ticketPromedio
    FROM (
      SELECT ${fechaLocal('FechaApertura')} AS fecha, TotalCuenta
      FROM modu_rest_Pedidos
      WHERE
        ${entreDiasLocales('FechaApertura', `DATEADD(DAY, -6, ${HOY_LOCAL})`, HOY_LOCAL)}
        AND EstadoPedido IN ${ESTADOS_VENTA}
    ) d
    GROUP BY d.fecha
    ORDER BY d.fecha DESC
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
