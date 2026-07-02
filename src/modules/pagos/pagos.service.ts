// src/modules/pagos/pagos.service.ts

import { query, sql } from '../../config/database';
import { AppError } from '../../middlewares/error.middleware';
import { registrarEvento } from '../../shared/eventos.service';
import { cambiarEstadoMesa } from '../mesas/mesas.service';

// ── Interfaces ───────────────────────────────────────

export interface Pago {
  pagoID: string;
  pedidoID: string;
  numeroPedido: number;
  mesaAlias: string | null;
  metodoID: string;
  metodoNombre: string;
  metodoTipo: string;
  cajeroID: string;
  cajero: string;
  montoPagado: number;
  montoEsperado: number;
  vuelto: number;
  propina: number;
  referenciaExterna: string | null;
  fechaTransaccion: string;
  anulado: boolean;
  motivoBaja: string | null;
}

export interface RegistrarPagoDTO {
  pedidoID: string;
  metodoID: string;
  montoPagado: number;
  propina?: number;
  referenciaExterna?: string;
}

export interface PagoResumen {
  totalPagado: number;
  totalEsperado: number;
  saldoPendiente: number;
  pagosRegistrados: Pago[];
  pagadoCompletamente: boolean;
}

// ── Métodos de pago ──────────────────────────────────

export async function listarMetodosPago() {
  return query(`
    SELECT
      MetodoID AS metodoID,
      Nombre   AS nombre,
      Tipo     AS tipo,
      Activo   AS activo
    FROM modu_rest_MetodosPago
    WHERE Activo = 1
    ORDER BY Nombre
  `);
}

// ── Obtener pago ─────────────────────────────────────

export async function obtenerPago(pagoID: string): Promise<Pago> {
  const rows = await query<Pago>(`
    SELECT
      p.PagoID             AS pagoID,
      p.PedidoID           AS pedidoID,
      pe.NumeroPedido      AS numeroPedido,
      m.Alias              AS mesaAlias,
      p.MetodoID           AS metodoID,
      mp.Nombre            AS metodoNombre,
      mp.Tipo              AS metodoTipo,
      p.CajeroID           AS cajeroID,
      u.Nombre + ' ' + u.Apellido AS cajero,
      p.MontoPagado        AS montoPagado,
      p.MontoEsperado      AS montoEsperado,
      p.Vuelto             AS vuelto,
      p.Propina            AS propina,
      p.ReferenciaExterna  AS referenciaExterna,
      p.FechaTransaccion   AS fechaTransaccion,
      p.Anulado            AS anulado,
      p.MotivoBaja         AS motivoBaja
    FROM modu_rest_Pagos p
    JOIN modu_rest_Pedidos     pe ON p.PedidoID  = pe.PedidoID
    JOIN modu_rest_MetodosPago mp ON p.MetodoID  = mp.MetodoID
    JOIN modu_rest_Usuarios    u  ON p.CajeroID  = u.UsuarioID
    LEFT JOIN modu_rest_Mesas  m  ON pe.MesaID   = m.MesaID
    WHERE p.PagoID = @pagoID
  `, (req) => {
    req.input('pagoID', sql.UniqueIdentifier, pagoID);
  });

  if (rows.length === 0) throw new AppError('Pago no encontrado', 404);
  return rows[0];
}

// ── Resumen de pagos de un pedido ────────────────────

export async function resumenPagosPedido(
  pedidoID: string
): Promise<PagoResumen> {
  const pedidoRows = await query<{
    totalCuenta: number;
    estadoPedido: string;
  }>(`
    SELECT TotalCuenta AS totalCuenta, EstadoPedido AS estadoPedido
    FROM modu_rest_Pedidos WHERE PedidoID = @pedidoID
  `, (req) => {
    req.input('pedidoID', sql.UniqueIdentifier, pedidoID);
  });

  if (pedidoRows.length === 0) throw new AppError('Pedido no encontrado', 404);

  const totalEsperado = pedidoRows[0].totalCuenta;

  const pagos = await query<Pago>(`
    SELECT
      p.PagoID             AS pagoID,
      p.PedidoID           AS pedidoID,
      pe.NumeroPedido      AS numeroPedido,
      m.Alias              AS mesaAlias,
      p.MetodoID           AS metodoID,
      mp.Nombre            AS metodoNombre,
      mp.Tipo              AS metodoTipo,
      p.CajeroID           AS cajeroID,
      u.Nombre + ' ' + u.Apellido AS cajero,
      p.MontoPagado        AS montoPagado,
      p.MontoEsperado      AS montoEsperado,
      p.Vuelto             AS vuelto,
      p.Propina            AS propina,
      p.ReferenciaExterna  AS referenciaExterna,
      p.FechaTransaccion   AS fechaTransaccion,
      p.Anulado            AS anulado,
      p.MotivoBaja         AS motivoBaja
    FROM modu_rest_Pagos p
    JOIN modu_rest_Pedidos     pe ON p.PedidoID = pe.PedidoID
    JOIN modu_rest_MetodosPago mp ON p.MetodoID = mp.MetodoID
    JOIN modu_rest_Usuarios    u  ON p.CajeroID = u.UsuarioID
    LEFT JOIN modu_rest_Mesas  m  ON pe.MesaID  = m.MesaID
    WHERE p.PedidoID = @pedidoID AND p.Anulado = 0
    ORDER BY p.FechaTransaccion
  `, (req) => {
    req.input('pedidoID', sql.UniqueIdentifier, pedidoID);
  });

  const totalPagado    = pagos.reduce((sum, p) => sum + p.montoPagado, 0);
  const saldoPendiente = Math.max(0, totalEsperado - totalPagado);

  return {
    totalPagado,
    totalEsperado,
    saldoPendiente,
    pagosRegistrados: pagos,
    pagadoCompletamente: saldoPendiente === 0,
  };
}

// ── Registrar pago ───────────────────────────────────

export async function registrarPago(
  cajeroID: string,
  data: RegistrarPagoDTO
): Promise<{ pago: Pago; resumen: PagoResumen }> {

  // 1. Verificar pedido
  const pedidoRows = await query<{
    pedidoID: string;
    mesaID: string | null;
    totalCuenta: number;
    estadoPedido: string;
    mesaAlias: string | null;
    numeroPedido: number;
  }>(`
    SELECT
      p.PedidoID      AS pedidoID,
      p.MesaID        AS mesaID,
      p.TotalCuenta   AS totalCuenta,
      p.EstadoPedido  AS estadoPedido,
      p.NumeroPedido  AS numeroPedido,
      m.Alias         AS mesaAlias
    FROM modu_rest_Pedidos p
    LEFT JOIN modu_rest_Mesas m ON p.MesaID = m.MesaID
    WHERE p.PedidoID = @pedidoID
  `, (req) => {
    req.input('pedidoID', sql.UniqueIdentifier, data.pedidoID);
  });

  if (pedidoRows.length === 0) throw new AppError('Pedido no encontrado', 404);

  const pedido = pedidoRows[0];

  if (!['Abierto', 'Por Pagar'].includes(pedido.estadoPedido)) {
    throw new AppError('Este pedido no está disponible para pago', 409);
  }

  // 2. Calcular saldo pendiente
  const pagosActuales = await query<{ totalPagado: number }>(`
    SELECT ISNULL(SUM(MontoPagado), 0) AS totalPagado
    FROM modu_rest_Pagos
    WHERE PedidoID = @pedidoID AND Anulado = 0
  `, (req) => {
    req.input('pedidoID', sql.UniqueIdentifier, data.pedidoID);
  });

  const totalPagadoAntes = pagosActuales[0].totalPagado;
  const saldoPendiente   = pedido.totalCuenta - totalPagadoAntes;

  if (saldoPendiente <= 0) {
    throw new AppError('Este pedido ya está completamente pagado', 409);
  }

  // 3. Calcular vuelto
  const montoEsperado = Math.min(data.montoPagado, saldoPendiente);
  const vuelto        = Math.max(0, data.montoPagado - saldoPendiente);

  // 4. Insertar pago — sin TurnoID
  const pagoRows = await query<{ PagoID: string }>(`
    INSERT INTO modu_rest_Pagos (
      PedidoID, MetodoID, CajeroID,
      MontoPagado, MontoEsperado, Vuelto, Propina,
      ReferenciaExterna
    )
    OUTPUT INSERTED.PagoID
    VALUES (
      @pedidoID, @metodoID, @cajeroID,
      @montoPagado, @montoEsperado, @vuelto, @propina,
      @referenciaExterna
    )
  `, (req) => {
    req.input('pedidoID',          sql.UniqueIdentifier, data.pedidoID);
    req.input('metodoID',          sql.UniqueIdentifier, data.metodoID);
    req.input('cajeroID',          sql.UniqueIdentifier, cajeroID);
    req.input('montoPagado',       sql.Decimal(18, 2),   data.montoPagado);
    req.input('montoEsperado',     sql.Decimal(18, 2),   montoEsperado);
    req.input('vuelto',            sql.Decimal(18, 2),   vuelto);
    req.input('propina',           sql.Decimal(18, 2),   data.propina ?? 0);
    req.input('referenciaExterna', sql.NVarChar,         data.referenciaExterna ?? null);
  });

  const pagoID = pagoRows[0].PagoID;

  // 5. Verificar si quedó completamente pagado
  const totalPagadoDespues  = totalPagadoAntes + data.montoPagado;
  const pagadoCompletamente = totalPagadoDespues >= pedido.totalCuenta;

  if (pagadoCompletamente) {
    await query(`
      UPDATE modu_rest_Pedidos SET
        EstadoPedido = 'Pagado',
        FechaCierre  = SYSUTCDATETIME()
      WHERE PedidoID = @pedidoID
    `, (req) => {
      req.input('pedidoID', sql.UniqueIdentifier, data.pedidoID);
    });

    if (pedido.mesaID) {
      await cambiarEstadoMesa(pedido.mesaID, 'Libre');
    }
  }

  const pago    = await obtenerPago(pagoID);
  const resumen = await resumenPagosPedido(data.pedidoID);

  // 6. Emitir eventos
  await registrarEvento({
    tipo:        'PAGO_RECIBIDO',
    entidadTipo: 'Pago',
    entidadID:   pagoID,
    usuarioID:   cajeroID,
    payload: {
      pagoID,
      pedidoID:         data.pedidoID,
      numeroPedido:     pedido.numeroPedido,
      mesaAlias:        pedido.mesaAlias,
      montoPagado:      data.montoPagado,
      metodo:           pago.metodoNombre,
      vuelto,
      pagadoCompletamente,
      saldoPendiente:   resumen.saldoPendiente,
    },
  });

  if (pagadoCompletamente) {
    await registrarEvento({
      tipo:        'MESA_CERRADA',
      entidadTipo: 'Pedido',
      entidadID:   data.pedidoID,
      usuarioID:   cajeroID,
      payload: {
        pedidoID:        data.pedidoID,
        numeroPedido:    pedido.numeroPedido,
        mesaAlias:       pedido.mesaAlias,
        totalCuenta:     pedido.totalCuenta,
        nuevoEstadoMesa: 'Libre',
      },
    });
  }

  return { pago, resumen };
}

// ── Anular pago ──────────────────────────────────────

export async function anularPago(
  pagoID: string,
  usuarioID: string,
  motivo: string
): Promise<void> {
  const pago = await obtenerPago(pagoID);

  if (pago.anulado) {
    throw new AppError('Este pago ya fue anulado anteriormente', 409);
  }

  await query(`
    UPDATE modu_rest_Pagos SET
      Anulado    = 1,
      MotivoBaja = @motivo
    WHERE PagoID = @pagoID
  `, (req) => {
    req.input('pagoID',  sql.UniqueIdentifier, pagoID);
    req.input('motivo',  sql.NVarChar,         motivo);
  });

  await query(`
    UPDATE modu_rest_Pedidos SET
      EstadoPedido = 'Por Pagar',
      FechaCierre  = NULL
    WHERE PedidoID = @pedidoID AND EstadoPedido = 'Pagado'
  `, (req) => {
    req.input('pedidoID', sql.UniqueIdentifier, pago.pedidoID);
  });
}

// ── Listar pagos por fecha ───────────────────────────

export async function listarPagosPorFecha(
  desde: string,
  hasta: string
): Promise<Pago[]> {
  return query<Pago>(`
    SELECT
      p.PagoID             AS pagoID,
      p.PedidoID           AS pedidoID,
      pe.NumeroPedido      AS numeroPedido,
      m.Alias              AS mesaAlias,
      p.MetodoID           AS metodoID,
      mp.Nombre            AS metodoNombre,
      mp.Tipo              AS metodoTipo,
      p.CajeroID           AS cajeroID,
      u.Nombre + ' ' + u.Apellido AS cajero,
      p.MontoPagado        AS montoPagado,
      p.MontoEsperado      AS montoEsperado,
      p.Vuelto             AS vuelto,
      p.Propina            AS propina,
      p.ReferenciaExterna  AS referenciaExterna,
      p.FechaTransaccion   AS fechaTransaccion,
      p.Anulado            AS anulado,
      p.MotivoBaja         AS motivoBaja
    FROM modu_rest_Pagos p
    JOIN modu_rest_Pedidos     pe ON p.PedidoID = pe.PedidoID
    JOIN modu_rest_MetodosPago mp ON p.MetodoID = mp.MetodoID
    JOIN modu_rest_Usuarios    u  ON p.CajeroID = u.UsuarioID
    LEFT JOIN modu_rest_Mesas  m  ON pe.MesaID  = m.MesaID
    WHERE
      p.Anulado = 0
      AND CAST(p.FechaTransaccion AS DATE) BETWEEN @desde AND @hasta
    ORDER BY p.FechaTransaccion DESC
  `, (req) => {
    req.input('desde', sql.Date, desde);
    req.input('hasta', sql.Date, hasta);
  });
}