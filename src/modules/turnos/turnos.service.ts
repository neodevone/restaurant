// src/modules/turnos/turnos.service.ts

import { query, sql } from '../../config/database';
import { AppError } from '../../middlewares/error.middleware';
import { registrarEvento } from '../../shared/eventos.service';

// ═══════════════════════════════════════════════════════
//  TURNOS DE CAJA
//
//  Un turno va desde que se abre la caja con un monto inicial
//  hasta que se cuenta el efectivo al cerrar. Solo puede haber
//  UNO abierto a la vez: hay una sola caja física, y dos turnos
//  simultáneos harían imposible cuadrar el cajón.
//
//  Arqueo:
//    Efectivo esperado = MontoInicial
//                      + ventas en efectivo (menos vueltos)
//                      + propinas en efectivo
//                      + ingresos extra
//                      − retiros − gastos − préstamos
//                      + devoluciones de préstamo
//    Diferencia = contado − esperado   (negativo = falta plata)
// ═══════════════════════════════════════════════════════

const ZONA = 'SA Pacific Standard Time';
const FECHA_LOCAL = (col: string) =>
  `CAST(${col} AT TIME ZONE 'UTC' AT TIME ZONE '${ZONA}' AS DATE)`;

// Movimientos que suman efectivo al cajón
const TIPOS_INGRESO = ['Ingreso', 'DevolucionPrestamo'];
// Movimientos que restan efectivo del cajón
const TIPOS_EGRESO  = ['Retiro', 'Gasto', 'Prestamo', 'Propinas'];

export const TIPOS_MOVIMIENTO = [...TIPOS_INGRESO, ...TIPOS_EGRESO];

// ── Interfaces ───────────────────────────────────────

export interface Turno {
  turnoID:              string;
  usuarioApertura:      string;
  abiertoPor:           string;
  usuarioCierre:        string | null;
  cerradoPor:           string | null;
  fechaApertura:        string;
  fechaCierre:          string | null;
  montoInicial:         number;
  montoFinal:           number | null;
  efectivoEsperado:     number | null;
  diferencia:           number | null;
  totalVentas:          number | null;
  totalEfectivo:        number | null;
  totalTarjeta:         number | null;
  totalDigital:         number | null;
  totalPropinas:        number | null;
  totalCartera:         number | null;
  totalIngresos:        number | null;
  totalEgresos:         number | null;
  totalPedidos:         number | null;
  estado:               string;
  observacionesApertura: string | null;
  observaciones:        string | null;
  minutosAbierto:       number;
}

export interface MovimientoCaja {
  movimientoID:    string;
  turnoID:         string;
  usuarioID:       string;
  registradoPor:   string;
  tipo:            string;
  monto:           number;
  concepto:        string;
  beneficiario:    string | null;
  soporte:         string | null;
  fechaMovimiento: string;
  anulado:         boolean;
  motivoAnulacion: string | null;
  esIngreso:       boolean;
}

/** Arqueo en vivo: lo que el turno lleva acumulado en este momento. */
export interface ArqueoTurno {
  turnoID:          string;
  montoInicial:     number;

  // Ventas del turno
  totalVentas:      number;
  totalPedidos:     number;
  ventasEfectivo:   number;
  ventasTarjeta:    number;
  ventasDigital:    number;
  propinas:         number;
  carteraGenerada:  number;

  // Movimientos de caja
  ingresos:         number;
  egresos:          number;
  retiros:          number;
  gastos:           number;
  prestamos:        number;

  // Resultado
  efectivoEsperado: number;
  totalRecaudado:   number;
}

// ── Helpers ───────────────────────────────────────────

const CAMPOS_TURNO = `
  t.TurnoID               AS turnoID,
  t.UsuarioApertura       AS usuarioApertura,
  ISNULL(ua.Nombre + ' ' + ua.Apellido, '—') AS abiertoPor,
  t.UsuarioCierre         AS usuarioCierre,
  uc.Nombre + ' ' + uc.Apellido AS cerradoPor,
  t.FechaApertura         AS fechaApertura,
  t.FechaCierre           AS fechaCierre,
  t.MontoInicial          AS montoInicial,
  t.MontoFinal            AS montoFinal,
  t.EfectivoEsperado      AS efectivoEsperado,
  t.Diferencia            AS diferencia,
  t.TotalVentas           AS totalVentas,
  t.TotalEfectivo         AS totalEfectivo,
  t.TotalTarjeta          AS totalTarjeta,
  t.TotalDigital          AS totalDigital,
  t.TotalPropinas         AS totalPropinas,
  t.TotalCartera          AS totalCartera,
  t.TotalIngresos         AS totalIngresos,
  t.TotalEgresos          AS totalEgresos,
  t.TotalPedidos          AS totalPedidos,
  t.Estado                AS estado,
  t.ObservacionesApertura AS observacionesApertura,
  t.Observaciones         AS observaciones,
  DATEDIFF(MINUTE, t.FechaApertura,
    ISNULL(t.FechaCierre, SYSUTCDATETIME())) AS minutosAbierto
`;

const JOIN_TURNO = `
  FROM modu_rest_TurnosCaja t
  LEFT JOIN modu_rest_Usuarios ua ON t.UsuarioApertura = ua.UsuarioID
  LEFT JOIN modu_rest_Usuarios uc ON t.UsuarioCierre   = uc.UsuarioID
`;

function redondear(n: number, dec = 2): number {
  const f = Math.pow(10, dec);
  return Math.round((n + Number.EPSILON) * f) / f;
}

// ── Turno abierto ────────────────────────────────────
// No depende del usuario: la caja es una sola.

export async function obtenerTurnoAbierto(): Promise<Turno | null> {
  const rows = await query<Turno>(`
    SELECT TOP 1 ${CAMPOS_TURNO}
    ${JOIN_TURNO}
    WHERE t.Estado = 'Abierto'
    ORDER BY t.FechaApertura DESC
  `);
  return rows[0] ?? null;
}

/**
 * Devuelve el TurnoID abierto o lanza error.
 * Lo usa el módulo de pagos: no se cobra sin caja abierta.
 */
export async function exigirTurnoAbierto(): Promise<string> {
  const turno = await obtenerTurnoAbierto();
  if (!turno) {
    throw new AppError(
      'No hay un turno de caja abierto. Abre la caja antes de registrar cobros.',
      409);
  }
  return turno.turnoID;
}

export async function obtenerTurnoPorID(turnoID: string): Promise<Turno> {
  const rows = await query<Turno>(`
    SELECT ${CAMPOS_TURNO}
    ${JOIN_TURNO}
    WHERE t.TurnoID = @turnoID
  `, (req) => {
    req.input('turnoID', sql.UniqueIdentifier, turnoID);
  });

  if (rows.length === 0) throw new AppError('Turno no encontrado', 404);
  return rows[0];
}

export async function listarTurnos(filtros: {
  desde?: string;
  hasta?: string;
  estado?: string;
}): Promise<Turno[]> {
  return query<Turno>(`
    SELECT ${CAMPOS_TURNO}
    ${JOIN_TURNO}
    WHERE (@estado IS NULL OR t.Estado = @estado)
      AND (@desde  IS NULL OR ${FECHA_LOCAL('t.FechaApertura')} >= @desde)
      AND (@hasta  IS NULL OR ${FECHA_LOCAL('t.FechaApertura')} <= @hasta)
    ORDER BY t.FechaApertura DESC
  `, (req) => {
    req.input('estado', sql.NVarChar, filtros.estado ?? null);
    req.input('desde',  sql.Date,     filtros.desde  ?? null);
    req.input('hasta',  sql.Date,     filtros.hasta  ?? null);
  });
}

// ── Abrir turno ──────────────────────────────────────

export async function abrirTurno(data: {
  usuarioID:     string;
  montoInicial:  number;
  observaciones?: string;
}): Promise<Turno> {

  const abierto = await obtenerTurnoAbierto();
  if (abierto) {
    throw new AppError(
      `Ya hay un turno abierto desde ${abierto.fechaApertura}, ` +
      `a cargo de ${abierto.abiertoPor}. Ciérralo antes de abrir otro.`,
      409);
  }

  const rows = await query<{ TurnoID: string }>(`
    INSERT INTO modu_rest_TurnosCaja (
      UsuarioApertura, MontoInicial, Estado, ObservacionesApertura
    )
    OUTPUT INSERTED.TurnoID
    VALUES (@usuarioID, @montoInicial, 'Abierto', @observaciones)
  `, (req) => {
    req.input('usuarioID',     sql.UniqueIdentifier, data.usuarioID);
    req.input('montoInicial',  sql.Decimal(18, 2),   data.montoInicial);
    req.input('observaciones', sql.NVarChar,         data.observaciones ?? null);
  });

  const turno = await obtenerTurnoPorID(rows[0].TurnoID);

  await registrarEvento({
    tipo:        'TURNO_ABIERTO',
    entidadTipo: 'Turno',
    entidadID:   turno.turnoID,
    usuarioID:   data.usuarioID,
    payload: {
      turnoID:      turno.turnoID,
      montoInicial: turno.montoInicial,
      abiertoPor:   turno.abiertoPor,
    },
  });

  return turno;
}

// ── Movimientos de caja ──────────────────────────────

export async function registrarMovimiento(data: {
  turnoID:      string;
  usuarioID:    string;
  tipo:         string;
  monto:        number;
  concepto:     string;
  beneficiario?: string;
  soporte?:     string;
}): Promise<MovimientoCaja> {

  if (!TIPOS_MOVIMIENTO.includes(data.tipo))
    throw new AppError(`Tipo de movimiento no válido: ${data.tipo}`, 400);

  if (data.monto <= 0)
    throw new AppError('El monto del movimiento debe ser mayor a cero', 400);

  const turno = await obtenerTurnoPorID(data.turnoID);
  if (turno.estado !== 'Abierto')
    throw new AppError('No se pueden registrar movimientos en un turno cerrado', 409);

  // Un egreso no puede dejar la caja en negativo: si el sistema dice
  // que hay $50.000 en el cajón, no se pueden sacar $80.000.
  if (TIPOS_EGRESO.includes(data.tipo)) {
    const arqueo = await arqueoTurno(data.turnoID);
    if (data.monto > arqueo.efectivoEsperado) {
      throw new AppError(
        `No hay suficiente efectivo en caja. Disponible: ` +
        `$${arqueo.efectivoEsperado.toLocaleString()}.`,
        409);
    }
  }

  const rows = await query<{ MovimientoID: string }>(`
    INSERT INTO modu_rest_MovimientosCaja (
      TurnoID, UsuarioID, Tipo, Monto, Concepto, Beneficiario, Soporte
    )
    OUTPUT INSERTED.MovimientoID
    VALUES (@turnoID, @usuarioID, @tipo, @monto, @concepto, @beneficiario, @soporte)
  `, (req) => {
    req.input('turnoID',      sql.UniqueIdentifier, data.turnoID);
    req.input('usuarioID',    sql.UniqueIdentifier, data.usuarioID);
    req.input('tipo',         sql.NVarChar,         data.tipo);
    req.input('monto',        sql.Decimal(18, 2),   data.monto);
    req.input('concepto',     sql.NVarChar,         data.concepto);
    req.input('beneficiario', sql.NVarChar,         data.beneficiario ?? null);
    req.input('soporte',      sql.NVarChar,         data.soporte ?? null);
  });

  const movs = await listarMovimientos(data.turnoID);
  const creado = movs.find(m => m.movimientoID === rows[0].MovimientoID)!;

  await registrarEvento({
    tipo:        'MOVIMIENTO_CAJA',
    entidadTipo: 'Turno',
    entidadID:   data.turnoID,
    usuarioID:   data.usuarioID,
    payload: {
      movimientoID: creado.movimientoID,
      tipo:         data.tipo,
      monto:        data.monto,
      concepto:     data.concepto,
      esIngreso:    creado.esIngreso,
    },
  });

  return creado;
}

export async function listarMovimientos(
  turnoID: string,
  incluirAnulados = false
): Promise<MovimientoCaja[]> {
  return query<MovimientoCaja>(`
    SELECT
      mc.MovimientoID    AS movimientoID,
      mc.TurnoID         AS turnoID,
      mc.UsuarioID       AS usuarioID,
      ISNULL(u.Nombre + ' ' + u.Apellido, '—') AS registradoPor,
      mc.Tipo            AS tipo,
      mc.Monto           AS monto,
      mc.Concepto        AS concepto,
      mc.Beneficiario    AS beneficiario,
      mc.Soporte         AS soporte,
      mc.FechaMovimiento AS fechaMovimiento,
      mc.Anulado         AS anulado,
      mc.MotivoAnulacion AS motivoAnulacion,
      CASE WHEN mc.Tipo IN ('Ingreso', 'DevolucionPrestamo')
           THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END AS esIngreso
    FROM modu_rest_MovimientosCaja mc
    LEFT JOIN modu_rest_Usuarios u ON mc.UsuarioID = u.UsuarioID
    WHERE mc.TurnoID = @turnoID
      AND (@incluir = 1 OR mc.Anulado = 0)
    ORDER BY mc.FechaMovimiento DESC
  `, (req) => {
    req.input('turnoID', sql.UniqueIdentifier, turnoID);
    req.input('incluir', sql.Bit, incluirAnulados ? 1 : 0);
  });
}

export async function anularMovimiento(
  movimientoID: string,
  usuarioID:    string,
  motivo:       string
): Promise<void> {
  const rows = await query<{ turnoID: string; estado: string; anulado: boolean }>(`
    SELECT mc.TurnoID AS turnoID, t.Estado AS estado, mc.Anulado AS anulado
    FROM modu_rest_MovimientosCaja mc
    JOIN modu_rest_TurnosCaja t ON mc.TurnoID = t.TurnoID
    WHERE mc.MovimientoID = @movimientoID
  `, (req) => {
    req.input('movimientoID', sql.UniqueIdentifier, movimientoID);
  });

  if (rows.length === 0) throw new AppError('Movimiento no encontrado', 404);
  if (rows[0].anulado)   throw new AppError('Este movimiento ya fue anulado', 409);
  if (rows[0].estado !== 'Abierto')
    throw new AppError('No se puede anular un movimiento de un turno cerrado', 409);

  await query(`
    UPDATE modu_rest_MovimientosCaja SET
      Anulado         = 1,
      MotivoAnulacion = @motivo
    WHERE MovimientoID = @movimientoID
  `, (req) => {
    req.input('movimientoID', sql.UniqueIdentifier, movimientoID);
    req.input('motivo',       sql.NVarChar,         motivo);
  });
}

// ── Arqueo en vivo ───────────────────────────────────

export async function arqueoTurno(turnoID: string): Promise<ArqueoTurno> {
  const turno = await obtenerTurnoPorID(turnoID);

  const [ventas, movs] = await Promise.all([
    query<{
      totalVentas: number; totalPedidos: number;
      efectivo: number; tarjeta: number; digital: number;
      propinas: number; propinasEfectivo: number; cartera: number;
    }>(`
      SELECT
        ISNULL(SUM(CASE WHEN mp.Tipo <> 'Credito'
              THEN pa.MontoPagado - pa.Vuelto ELSE 0 END), 0) AS totalVentas,
        COUNT(DISTINCT pa.PedidoID)                           AS totalPedidos,
        ISNULL(SUM(CASE WHEN mp.Tipo = 'Efectivo'
              THEN pa.MontoPagado - pa.Vuelto ELSE 0 END), 0) AS efectivo,
        ISNULL(SUM(CASE WHEN mp.Tipo = 'Tarjeta'
              THEN pa.MontoPagado - pa.Vuelto ELSE 0 END), 0) AS tarjeta,
        ISNULL(SUM(CASE WHEN mp.Tipo = 'Digital'
              THEN pa.MontoPagado - pa.Vuelto ELSE 0 END), 0) AS digital,
        ISNULL(SUM(pa.Propina), 0)                            AS propinas,
        ISNULL(SUM(CASE WHEN mp.Tipo = 'Efectivo'
              THEN pa.Propina ELSE 0 END), 0)                 AS propinasEfectivo,
        ISNULL(SUM(CASE WHEN mp.Tipo = 'Credito'
              THEN pa.MontoEsperado ELSE 0 END), 0)           AS cartera
      FROM modu_rest_Pagos pa
      JOIN modu_rest_MetodosPago mp ON pa.MetodoID = mp.MetodoID
      WHERE pa.TurnoID = @turnoID AND pa.Anulado = 0
    `, (req) => {
      req.input('turnoID', sql.UniqueIdentifier, turnoID);
    }),

    query<{
      ingresos: number; retiros: number; gastos: number;
      prestamos: number; devoluciones: number; propinasEntregadas: number;
    }>(`
      SELECT
        ISNULL(SUM(CASE WHEN Tipo = 'Ingreso'            THEN Monto ELSE 0 END), 0) AS ingresos,
        ISNULL(SUM(CASE WHEN Tipo = 'Retiro'             THEN Monto ELSE 0 END), 0) AS retiros,
        ISNULL(SUM(CASE WHEN Tipo = 'Gasto'              THEN Monto ELSE 0 END), 0) AS gastos,
        ISNULL(SUM(CASE WHEN Tipo = 'Prestamo'           THEN Monto ELSE 0 END), 0) AS prestamos,
        ISNULL(SUM(CASE WHEN Tipo = 'DevolucionPrestamo' THEN Monto ELSE 0 END), 0) AS devoluciones,
        ISNULL(SUM(CASE WHEN Tipo = 'Propinas'           THEN Monto ELSE 0 END), 0) AS propinasEntregadas
      FROM modu_rest_MovimientosCaja
      WHERE TurnoID = @turnoID AND Anulado = 0
    `, (req) => {
      req.input('turnoID', sql.UniqueIdentifier, turnoID);
    }),
  ]);

  const v = ventas[0];
  const m = movs[0];

  const ingresos = m.ingresos + m.devoluciones;
  const egresos  = m.retiros + m.gastos + m.prestamos + m.propinasEntregadas;

  // Solo el efectivo toca el cajón. Tarjeta y digital no.
  // Las propinas cobradas en efectivo sí están físicamente en la caja
  // hasta que se entregan como movimiento de tipo 'Propinas'.
  const efectivoEsperado =
    turno.montoInicial + v.efectivo + v.propinasEfectivo + ingresos - egresos;

  return {
    turnoID,
    montoInicial:     redondear(turno.montoInicial),
    totalVentas:      redondear(v.totalVentas),
    totalPedidos:     v.totalPedidos,
    ventasEfectivo:   redondear(v.efectivo),
    ventasTarjeta:    redondear(v.tarjeta),
    ventasDigital:    redondear(v.digital),
    propinas:         redondear(v.propinas),
    carteraGenerada:  redondear(v.cartera),
    ingresos:         redondear(ingresos),
    egresos:          redondear(egresos),
    retiros:          redondear(m.retiros),
    gastos:           redondear(m.gastos),
    prestamos:        redondear(m.prestamos),
    efectivoEsperado: redondear(efectivoEsperado),
    totalRecaudado:   redondear(v.totalVentas),
  };
}

// ── Cerrar turno ─────────────────────────────────────

export async function cerrarTurno(
  turnoID:   string,
  usuarioID: string,
  data: { montoFinal: number; observaciones?: string }
): Promise<{ turno: Turno; arqueo: ArqueoTurno; pedidosAbiertos: number }> {

  const turno = await obtenerTurnoPorID(turnoID);
  if (turno.estado !== 'Abierto')
    throw new AppError('Este turno ya fue cerrado', 409);

  const arqueo = await arqueoTurno(turnoID);
  const diferencia = data.montoFinal - arqueo.efectivoEsperado;

  // Pedidos que quedan sin cobrar. No impide cerrar — un pedido
  // puede seguir abierto de un día para otro — pero se informa.
  const abiertos = await query<{ total: number }>(`
    SELECT COUNT(*) AS total
    FROM modu_rest_Pedidos
    WHERE EstadoPedido IN ('Abierto', 'Por Pagar')
  `);

  await query(`
    UPDATE modu_rest_TurnosCaja SET
      Estado           = 'Cerrado',
      FechaCierre      = SYSUTCDATETIME(),
      UsuarioCierre    = @usuarioID,
      MontoFinal       = @montoFinal,
      EfectivoEsperado = @esperado,
      Diferencia       = @diferencia,
      TotalVentas      = @totalVentas,
      TotalEfectivo    = @efectivo,
      TotalTarjeta     = @tarjeta,
      TotalDigital     = @digital,
      TotalPropinas    = @propinas,
      TotalCartera     = @cartera,
      TotalIngresos    = @ingresos,
      TotalEgresos     = @egresos,
      TotalPedidos     = @pedidos,
      Observaciones    = @observaciones
    WHERE TurnoID = @turnoID
  `, (req) => {
    req.input('turnoID',       sql.UniqueIdentifier, turnoID);
    req.input('usuarioID',     sql.UniqueIdentifier, usuarioID);
    req.input('montoFinal',    sql.Decimal(18, 2),   data.montoFinal);
    req.input('esperado',      sql.Decimal(18, 2),   arqueo.efectivoEsperado);
    req.input('diferencia',    sql.Decimal(18, 2),   diferencia);
    req.input('totalVentas',   sql.Decimal(18, 2),   arqueo.totalVentas);
    req.input('efectivo',      sql.Decimal(18, 2),   arqueo.ventasEfectivo);
    req.input('tarjeta',       sql.Decimal(18, 2),   arqueo.ventasTarjeta);
    req.input('digital',       sql.Decimal(18, 2),   arqueo.ventasDigital);
    req.input('propinas',      sql.Decimal(18, 2),   arqueo.propinas);
    req.input('cartera',       sql.Decimal(18, 2),   arqueo.carteraGenerada);
    req.input('ingresos',      sql.Decimal(18, 2),   arqueo.ingresos);
    req.input('egresos',       sql.Decimal(18, 2),   arqueo.egresos);
    req.input('pedidos',       sql.Int,              arqueo.totalPedidos);
    req.input('observaciones', sql.NVarChar,         data.observaciones ?? null);
  });

  const cerrado = await obtenerTurnoPorID(turnoID);

  await registrarEvento({
    tipo:        'TURNO_CERRADO',
    entidadTipo: 'Turno',
    entidadID:   turnoID,
    usuarioID,
    payload: {
      turnoID,
      abiertoPor:       turno.abiertoPor,
      cerradoPor:       cerrado.cerradoPor,
      montoInicial:     arqueo.montoInicial,
      efectivoEsperado: arqueo.efectivoEsperado,
      montoFinal:       data.montoFinal,
      diferencia,
      totalVentas:      arqueo.totalVentas,
      cuadra:           Math.abs(diferencia) < 1,
    },
  });

  return {
    turno: cerrado,
    arqueo,
    pedidosAbiertos: abiertos[0].total,
  };
}

// ── Resumen de cierre ────────────────────────────────
// Lo que se imprime o se manda al dueño.

export async function resumenTurno(turnoID: string) {
  const [turno, arqueo, movimientos] = await Promise.all([
    obtenerTurnoPorID(turnoID),
    arqueoTurno(turnoID),
    listarMovimientos(turnoID),
  ]);

  const metodos = await query(`
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
    WHERE pa.TurnoID = @turnoID AND pa.Anulado = 0
    GROUP BY mp.Nombre, mp.Tipo
    ORDER BY recaudoNeto DESC
  `, (req) => {
    req.input('turnoID', sql.UniqueIdentifier, turnoID);
  });

  const productos = await query(`
    SELECT TOP 10
      cd.NombreArticulo    AS articulo,
      SUM(cd.Cantidad)     AS cantidad,
      SUM(cd.Subtotal)     AS facturado
    FROM modu_rest_ComandaDetalle cd
    WHERE cd.EstadoItem <> 'Cancelado'
      AND cd.PedidoID IN (
        SELECT DISTINCT PedidoID FROM modu_rest_Pagos
        WHERE TurnoID = @turnoID AND Anulado = 0
      )
    GROUP BY cd.NombreArticulo
    ORDER BY cantidad DESC
  `, (req) => {
    req.input('turnoID', sql.UniqueIdentifier, turnoID);
  });

  return { turno, arqueo, movimientos, metodos, productos };
}