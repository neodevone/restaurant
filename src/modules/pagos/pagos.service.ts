// src/modules/pagos/pagos.service.ts

import { query, sql, getPool } from '../../config/database';
import { AppError } from '../../middlewares/error.middleware';
import { entreDiasLocales } from '../../shared/fechas';
import { registrarEvento } from '../../shared/eventos.service';
import { cambiarEstadoMesa } from '../mesas/mesas.service';
import { exigirTurnoAbierto } from '../turnos/turnos.service';
import { comandasPendientesPedido } from '../comandas/comandas.service';

// ── Interfaces ───────────────────────────────────────

export interface MetadataPago {
  // Tipo de pedido
  tipoPedido?: 'Mesa' | 'Para Llevar' | 'Domicilio';

  // Digital / Transferencia
  referencia?:   string;
  confirmado?:   boolean;

  // Datáfono
  codigoAprobacion?: string;
  franquicia?:       string;
  terminal?:         string;

  // Crédito / Fiado / Cortesía / Empleado
  nombreCliente?: string;
  cedula?:        string;
  celular?:       string;
  autorizadoPor?: string;
  motivo?:        string;

  // Ciclo de vida de la cuenta por cobrar
  estadoCredito?: 'PENDIENTE' | 'ABONADA' | 'PAGADO';
}

export interface Pago {
  pagoID:            string;
  pedidoID:          string;
  numeroPedido:      number;
  mesaAlias:         string | null;
  metodoID:          string;
  metodoNombre:      string;
  metodoTipo:        string;
  cajeroID:          string;
  cajero:            string;
  montoPagado:       number;
  montoEsperado:     number;
  vuelto:            number;
  propina:           number;
  referenciaExterna: string | null;
  metadataPago:      string | null;
  fechaTransaccion:  string;
  anulado:           boolean;
  motivoBaja:        string | null;
}

export interface RegistrarPagoDTO {
  pedidoID:          string;
  metodoID:          string;
  montoPagado:       number;
  propina?:          number;
  referenciaExterna?: string;
  metadataPago?:     MetadataPago;
}

export interface RegistrarFiadoDTO {
  pedidoID:       string;
  metodoID:       string;
  cedula:         string;
  celular:        string;
  nombreCliente?: string;
  autorizadoPor?: string;
  motivo?:        string;
  tipoPedido?:    'Mesa' | 'Para Llevar' | 'Domicilio';
}

export interface PagoResumen {
  totalPagado:        number;
  totalEsperado:      number;
  saldoPendiente:     number;
  pagosRegistrados:   Pago[];
  pagadoCompletamente: boolean;
}

// Estados de pedido en los que todavía se puede recibir dinero.
// 'Fiado' entra aquí para que los abonos a la deuda usen el mismo flujo.
const ESTADOS_COBRABLES = ['Abierto', 'Por Pagar', 'Fiado'];

// ── Métodos de pago ───────────────────────────────────

export async function listarMetodosPago() {
  return query(`
    SELECT
      MetodoID AS metodoID,
      Nombre   AS nombre,
      Tipo     AS tipo,
      Activo   AS activo
    FROM modu_rest_MetodosPago
    WHERE Activo = 1
    ORDER BY
      CASE Tipo
        WHEN 'Efectivo' THEN 1
        WHEN 'Digital'  THEN 2
        WHEN 'Tarjeta'  THEN 3
        WHEN 'Credito'  THEN 4
        ELSE 5
      END,
      Nombre
  `);
}

// ── Obtener pago ──────────────────────────────────────

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
      p.MetadataPago       AS metadataPago,
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

// ── Resumen de pagos de un pedido ─────────────────────

export async function resumenPagosPedido(
  pedidoID: string
): Promise<PagoResumen> {
  const pedidoRows = await query<{
    totalCuenta:  number;
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
      p.MetadataPago       AS metadataPago,
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
    pagosRegistrados:   pagos,
    pagadoCompletamente: saldoPendiente === 0,
  };
}

// ── Helpers de crédito ────────────────────────────────

// Marca la fila de fiado del pedido con el estado indicado.
// No se toca MontoPagado de esa fila: el dinero de la cobranza
// entra siempre como una fila nueva, con la fecha del día que pagan.
async function actualizarEstadoCredito(
  pedidoID: string,
  estado: 'ABONADA' | 'PAGADO'
): Promise<void> {
  await query(`
    UPDATE modu_rest_Pagos
    SET MetadataPago = JSON_MODIFY(MetadataPago, '$.estadoCredito', @estado)
    WHERE PedidoID = @pedidoID
      AND Anulado  = 0
      AND ISJSON(MetadataPago) = 1
      AND JSON_VALUE(MetadataPago, '$.estadoCredito') IS NOT NULL
      AND JSON_VALUE(MetadataPago, '$.estadoCredito') <> 'PAGADO'
  `, (req) => {
    req.input('pedidoID', sql.UniqueIdentifier, pedidoID);
    req.input('estado',   sql.NVarChar,         estado);
  });
}

async function saldoPendienteDe(
  pedidoID: string,
  totalCuenta: number
): Promise<number> {
  const rows = await query<{ totalPagado: number }>(`
    SELECT ISNULL(SUM(MontoPagado), 0) AS totalPagado
    FROM modu_rest_Pagos
    WHERE PedidoID = @pedidoID AND Anulado = 0
  `, (req) => {
    req.input('pedidoID', sql.UniqueIdentifier, pedidoID);
  });
  return totalCuenta - rows[0].totalPagado;
}

// ── Registrar pago ────────────────────────────────────

export async function registrarPago(
  cajeroID: string,
  data: RegistrarPagoDTO
): Promise<{ pago: Pago; resumen: PagoResumen }> {

  // Todo el cobro corre en UNA transacción con UPDLOCK + HOLDLOCK sobre
  // la fila del pedido. Antes cada paso era una consulta suelta y:
  //   · dos cobros simultáneos (doble clic) leían el mismo saldo y
  //     registraban el pago dos veces;
  //   · una ronda que entraba mientras se cobraba quedaba "Pendiente"
  //     en un pedido ya marcado Pagado (la cocina la prepara, nadie la cobra).
  // agregarRonda y cancelarPedido toman el mismo bloqueo, así que ahora
  // se procesan de a uno: el que llega segundo ve el estado real.
  const pool = await getPool();
  const tx   = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

  let pedido: {
    pedidoID: string; mesaID: string | null; totalCuenta: number;
    estadoPedido: string; mesaAlias: string | null;
    numeroPedido: number; tipoPedido: string;
  };
  let eraFiado: boolean;
  let pagoID: string;
  let vuelto: number;
  let pagadoCompletamente: boolean;

  try {
    // 1. Verificar pedido (con bloqueo)
    const pedidoRows = await new sql.Request(tx)
      .input('pedidoID', sql.UniqueIdentifier, data.pedidoID)
      .query(`
        SELECT
          p.PedidoID      AS pedidoID,
          p.MesaID        AS mesaID,
          p.TotalCuenta   AS totalCuenta,
          p.EstadoPedido  AS estadoPedido,
          p.NumeroPedido  AS numeroPedido,
          p.TipoPedido    AS tipoPedido,
          m.Alias         AS mesaAlias
        FROM modu_rest_Pedidos p WITH (UPDLOCK, HOLDLOCK)
        LEFT JOIN modu_rest_Mesas m ON p.MesaID = m.MesaID
        WHERE p.PedidoID = @pedidoID
      `);

    if (pedidoRows.recordset.length === 0) throw new AppError('Pedido no encontrado', 404);

    pedido = pedidoRows.recordset[0];

    if (!ESTADOS_COBRABLES.includes(pedido.estadoPedido))
      throw new AppError('Este pedido no está disponible para pago', 409);

    eraFiado = pedido.estadoPedido === 'Fiado';

    // No se cobra una mesa cuya comida todavía no se entregó. La regla
    // vive aquí y no solo en el botón del escritorio: un botón
    // deshabilitado se salta por cualquier otro camino.
    //
    // Solo aplica a pedidos CON mesa. Mostrador y domicilios se cobran
    // en el momento y sus comandas nacen despachadas.
    if (pedido.mesaID) {
      const pend = await new sql.Request(tx)
        .input('pedidoID', sql.UniqueIdentifier, data.pedidoID)
        .query(`
          SELECT COUNT(*) AS total
          FROM modu_rest_Comandas
          WHERE PedidoID = @pedidoID AND Estado <> 'Despachada'
        `);
      const pendientes = pend.recordset[0].total;
      if (pendientes > 0) {
        throw new AppError(
          `Este pedido todavía no se ha entregado en la mesa. ` +
          `Falta(n) ${pendientes} ronda(s) por entregar.`,
          409);
      }
    }

    // No se cobra sin caja abierta: el dinero tiene que caer en algún turno
    // o el arqueo del día no cuadra.
    const turnoID = await exigirTurnoAbierto();

    // 2. Calcular saldo pendiente (dentro del bloqueo: es el saldo real)
    const pagosActuales = await new sql.Request(tx)
      .input('pedidoID', sql.UniqueIdentifier, data.pedidoID)
      .query(`
        SELECT ISNULL(SUM(MontoPagado), 0) AS totalPagado
        FROM modu_rest_Pagos
        WHERE PedidoID = @pedidoID AND Anulado = 0
      `);

    const totalPagadoAntes = pagosActuales.recordset[0].totalPagado;
    const saldoPendiente   = pedido.totalCuenta - totalPagadoAntes;

    if (saldoPendiente <= 0)
      throw new AppError('Este pedido ya está completamente pagado', 409);

    // 3. Calcular vuelto
    const montoEsperado = Math.min(data.montoPagado, saldoPendiente);
    vuelto              = Math.max(0, data.montoPagado - saldoPendiente);

    // 4. Construir metadataPago — incluye tipoPedido del pedido
    const metadataPago: MetadataPago = {
      tipoPedido: pedido.tipoPedido as MetadataPago['tipoPedido'],
      ...data.metadataPago,
    };

    // 4b. El cajero tiene la última palabra sobre el canal de venta:
    //     él sabe si el cliente se lo llevó. Se sincroniza el pedido para
    //     que los informes por canal tengan una sola fuente de verdad.
    const canal = metadataPago.tipoPedido;
    if (canal && canal !== pedido.tipoPedido) {
      await new sql.Request(tx)
        .input('pedidoID', sql.UniqueIdentifier, data.pedidoID)
        .input('canal',    sql.NVarChar,         canal)
        .query(`
          UPDATE modu_rest_Pedidos SET TipoPedido = @canal
          WHERE PedidoID = @pedidoID
        `);
      pedido.tipoPedido = canal;
    }

    // 5. Insertar pago
    const pagoRows = await new sql.Request(tx)
      .input('pedidoID',          sql.UniqueIdentifier, data.pedidoID)
      .input('metodoID',          sql.UniqueIdentifier, data.metodoID)
      .input('cajeroID',          sql.UniqueIdentifier, cajeroID)
      .input('turnoID',           sql.UniqueIdentifier, turnoID)
      .input('montoPagado',       sql.Decimal(18, 2),   data.montoPagado)
      .input('montoEsperado',     sql.Decimal(18, 2),   montoEsperado)
      .input('vuelto',            sql.Decimal(18, 2),   vuelto)
      .input('propina',           sql.Decimal(18, 2),   data.propina ?? 0)
      .input('referenciaExterna', sql.NVarChar,         data.referenciaExterna ?? null)
      .input('metadataPago',      sql.NVarChar,         JSON.stringify(metadataPago))
      .query(`
        INSERT INTO modu_rest_Pagos (
          PedidoID, MetodoID, CajeroID, TurnoID,
          MontoPagado, MontoEsperado, Vuelto, Propina,
          ReferenciaExterna, MetadataPago
        )
        OUTPUT INSERTED.PagoID
        VALUES (
          @pedidoID, @metodoID, @cajeroID, @turnoID,
          @montoPagado, @montoEsperado, @vuelto, @propina,
          @referenciaExterna, @metadataPago
        )
      `);

    pagoID = pagoRows.recordset[0].PagoID;

    // 6. Verificar si quedó completamente pagado
    const totalPagadoDespues = totalPagadoAntes + data.montoPagado;
    pagadoCompletamente      = totalPagadoDespues >= pedido.totalCuenta;

    if (pagadoCompletamente) {
      await new sql.Request(tx)
        .input('pedidoID', sql.UniqueIdentifier, data.pedidoID)
        .query(`
          UPDATE modu_rest_Pedidos SET
            EstadoPedido = 'Pagado',
            FechaCierre  = SYSUTCDATETIME()
          WHERE PedidoID = @pedidoID
        `);
    }

    // 6b. Si el pedido venía de una cuenta por cobrar, mover el estado
    //     del crédito. La fila del fiado nunca cambia su MontoPagado.
    if (eraFiado) {
      await new sql.Request(tx)
        .input('pedidoID', sql.UniqueIdentifier, data.pedidoID)
        .input('estado',   sql.NVarChar,         pagadoCompletamente ? 'PAGADO' : 'ABONADA')
        .query(`
          UPDATE modu_rest_Pagos
          SET MetadataPago = JSON_MODIFY(MetadataPago, '$.estadoCredito', @estado)
          WHERE PedidoID = @pedidoID
            AND Anulado  = 0
            AND ISJSON(MetadataPago) = 1
            AND JSON_VALUE(MetadataPago, '$.estadoCredito') IS NOT NULL
            AND JSON_VALUE(MetadataPago, '$.estadoCredito') <> 'PAGADO'
        `);
    }

    await tx.commit();
  } catch (err) {
    try { await tx.rollback(); } catch { /* ya abortada por SQL Server */ }
    throw err;
  }

  // Solo se libera la mesa si el pedido se cierra ahora. Si venía de un
  // fiado, la mesa ya se liberó ese día y hoy puede estar ocupada por otro.
  // Va después del COMMIT: emite el evento de socket.
  if (pagadoCompletamente && pedido.mesaID && !eraFiado) {
    await cambiarEstadoMesa(pedido.mesaID, 'Libre');
  }

  const pago    = await obtenerPago(pagoID);
  const resumen = await resumenPagosPedido(data.pedidoID);

  // 7. Eventos
  await registrarEvento({
    tipo:        'PAGO_RECIBIDO',
    entidadTipo: 'Pago',
    entidadID:   pagoID,
    usuarioID:   cajeroID,
    payload: {
      pagoID,
      pedidoID:           data.pedidoID,
      numeroPedido:       pedido.numeroPedido,
      mesaAlias:          pedido.mesaAlias,
      tipoPedido:         pedido.tipoPedido,
      montoPagado:        data.montoPagado,
      metodo:             pago.metodoNombre,
      vuelto,
      pagadoCompletamente,
      saldoPendiente:     resumen.saldoPendiente,
      recuperacionCartera: eraFiado,
    },
  });

  if (pagadoCompletamente && !eraFiado) {
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

// ── Registrar cuenta por cobrar (fiado) ───────────────
// El saldo que queda del pedido se convierte en deuda.
// MontoPagado = 0 para no alterar el recaudo del día.
// MontoEsperado = valor de la deuda.

export async function registrarCuentaPorCobrar(
  cajeroID: string,
  data: RegistrarFiadoDTO
): Promise<{ pago: Pago; resumen: PagoResumen }> {

  // Verificar que el método sea de tipo Crédito (solo lectura de un
  // catálogo: va antes de abrir la transacción).
  const metodoRows = await query<{ tipo: string; nombre: string }>(`
    SELECT Tipo AS tipo, Nombre AS nombre
    FROM modu_rest_MetodosPago
    WHERE MetodoID = @metodoID AND Activo = 1
  `, (req) => {
    req.input('metodoID', sql.UniqueIdentifier, data.metodoID);
  });

  if (metodoRows.length === 0)
    throw new AppError('Método de pago no encontrado o inactivo', 400);

  if (metodoRows[0].tipo !== 'Credito')
    throw new AppError('El método seleccionado no es una cuenta por cobrar', 400);

  // Todo el fiado corre en UNA transacción con UPDLOCK + HOLDLOCK sobre
  // el pedido — el mismo bloqueo de registrarPago, agregarRonda y
  // cancelarPedido. Antes, dos "fiar" simultáneos creaban dos deudas del
  // mismo pedido, y una ronda que entraba a la vez quedaba pendiente en
  // un pedido ya Fiado con la deuda calculada sin ella (QA r2: X1, X2).
  const pool = await getPool();
  const tx   = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

  let pedido: {
    pedidoID: string; mesaID: string | null; totalCuenta: number;
    estadoPedido: string; mesaAlias: string | null;
    numeroPedido: number; tipoPedido: string;
  };
  let pagoID: string;
  let deuda: number;

  try {
    // 1. Verificar pedido (con bloqueo)
    const pedidoRows = await new sql.Request(tx)
      .input('pedidoID', sql.UniqueIdentifier, data.pedidoID)
      .query(`
        SELECT
          p.PedidoID      AS pedidoID,
          p.MesaID        AS mesaID,
          p.TotalCuenta   AS totalCuenta,
          p.EstadoPedido  AS estadoPedido,
          p.NumeroPedido  AS numeroPedido,
          p.TipoPedido    AS tipoPedido,
          m.Alias         AS mesaAlias
        FROM modu_rest_Pedidos p WITH (UPDLOCK, HOLDLOCK)
        LEFT JOIN modu_rest_Mesas m ON p.MesaID = m.MesaID
        WHERE p.PedidoID = @pedidoID
      `);

    if (pedidoRows.recordset.length === 0) throw new AppError('Pedido no encontrado', 404);

    pedido = pedidoRows.recordset[0];

    if (!['Abierto', 'Por Pagar'].includes(pedido.estadoPedido))
      throw new AppError('Este pedido no está disponible para fiar', 409);

    // No se cobra una mesa cuya comida todavía no se entregó. La regla
    // vive aquí y no solo en el botón del escritorio: un botón
    // deshabilitado se salta por cualquier otro camino.
    //
    // Solo aplica a pedidos CON mesa. Mostrador y domicilios se cobran
    // en el momento y sus comandas nacen despachadas.
    if (pedido.mesaID) {
      const pend = await new sql.Request(tx)
        .input('pedidoID', sql.UniqueIdentifier, data.pedidoID)
        .query(`
          SELECT COUNT(*) AS total
          FROM modu_rest_Comandas
          WHERE PedidoID = @pedidoID AND Estado <> 'Despachada'
        `);
      const pendientes = pend.recordset[0].total;
      if (pendientes > 0) {
        throw new AppError(
          `Este pedido todavía no se ha entregado en la mesa. ` +
          `Falta(n) ${pendientes} ronda(s) por entregar.`,
          409);
      }
    }

    // El fiado no mueve efectivo, pero pertenece al turno: es una venta
    // del período y tiene que aparecer en el cierre.
    const turnoID = await exigirTurnoAbierto();

    // 3. El saldo que queda es la deuda (dentro del bloqueo: es el real)
    const pagado = await new sql.Request(tx)
      .input('pedidoID', sql.UniqueIdentifier, data.pedidoID)
      .query(`
        SELECT ISNULL(SUM(MontoPagado), 0) AS totalPagado
        FROM modu_rest_Pagos
        WHERE PedidoID = @pedidoID AND Anulado = 0
      `);
    deuda = pedido.totalCuenta - pagado.recordset[0].totalPagado;

    if (deuda <= 0)
      throw new AppError('Este pedido ya está completamente pagado', 409);

    // 3b. Sincronizar el canal de venta elegido por el cajero
    if (data.tipoPedido && data.tipoPedido !== pedido.tipoPedido) {
      await new sql.Request(tx)
        .input('pedidoID', sql.UniqueIdentifier, data.pedidoID)
        .input('canal',    sql.NVarChar,         data.tipoPedido)
        .query(`
          UPDATE modu_rest_Pedidos SET TipoPedido = @canal
          WHERE PedidoID = @pedidoID
        `);
      pedido.tipoPedido = data.tipoPedido;
    }

    // 4. Metadata del crédito
    const metadataPago: MetadataPago = {
      tipoPedido:    pedido.tipoPedido as MetadataPago['tipoPedido'],
      cedula:        data.cedula,
      celular:       data.celular,
      nombreCliente: data.nombreCliente ?? undefined,
      autorizadoPor: data.autorizadoPor ?? undefined,
      motivo:        data.motivo ?? undefined,
      estadoCredito: 'PENDIENTE',
    };

    // 5. Insertar la fila del fiado
    const pagoRows = await new sql.Request(tx)
      .input('pedidoID',          sql.UniqueIdentifier, data.pedidoID)
      .input('metodoID',          sql.UniqueIdentifier, data.metodoID)
      .input('cajeroID',          sql.UniqueIdentifier, cajeroID)
      .input('turnoID',           sql.UniqueIdentifier, turnoID)
      .input('deuda',             sql.Decimal(18, 2),   deuda)
      .input('referenciaExterna', sql.NVarChar,         data.cedula)
      .input('metadataPago',      sql.NVarChar,         JSON.stringify(metadataPago))
      .query(`
        INSERT INTO modu_rest_Pagos (
          PedidoID, MetodoID, CajeroID, TurnoID,
          MontoPagado, MontoEsperado, Vuelto, Propina,
          ReferenciaExterna, MetadataPago
        )
        OUTPUT INSERTED.PagoID
        VALUES (
          @pedidoID, @metodoID, @cajeroID, @turnoID,
          0, @deuda, 0, 0,
          @referenciaExterna, @metadataPago
        )
      `);

    pagoID = pagoRows.recordset[0].PagoID;

    // 6. Cerrar el pedido de forma explícita.
    //    No se deduce de la suma de pagos porque MontoPagado es 0.
    await new sql.Request(tx)
      .input('pedidoID', sql.UniqueIdentifier, data.pedidoID)
      .query(`
        UPDATE modu_rest_Pedidos SET
          EstadoPedido = 'Fiado',
          FechaCierre  = SYSUTCDATETIME()
        WHERE PedidoID = @pedidoID
      `);

    await tx.commit();
  } catch (err) {
    try { await tx.rollback(); } catch { /* ya abortada por SQL Server */ }
    throw err;
  }

  // Liberar la mesa después del COMMIT: emite el evento de socket.
  if (pedido.mesaID) {
    await cambiarEstadoMesa(pedido.mesaID, 'Libre');
  }

  const pago    = await obtenerPago(pagoID);
  const resumen = await resumenPagosPedido(data.pedidoID);

  // 7. Eventos
  await registrarEvento({
    tipo:        'PAGO_RECIBIDO',
    entidadTipo: 'Pago',
    entidadID:   pagoID,
    usuarioID:   cajeroID,
    payload: {
      pagoID,
      pedidoID:      data.pedidoID,
      numeroPedido:  pedido.numeroPedido,
      mesaAlias:     pedido.mesaAlias,
      tipoPedido:    pedido.tipoPedido,
      montoPagado:   0,
      metodo:        pago.metodoNombre,
      esFiado:       true,
      deuda,
      cliente:       data.nombreCliente ?? data.cedula,
      cedula:        data.cedula,
      celular:       data.celular,
      autorizadoPor: data.autorizadoPor ?? null,
    },
  });

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
      motivo:          'Cuenta por cobrar',
      deuda,
      nuevoEstadoMesa: 'Libre',
    },
  });

  return { pago, resumen };
}

// ── Anular pago ───────────────────────────────────────

export async function anularPago(
  pagoID:    string,
  usuarioID: string,
  motivo:    string
): Promise<void> {
  const pago = await obtenerPago(pagoID);

  if (pago.anulado)
    throw new AppError('Este pago ya fue anulado anteriormente', 409);

  // Anular el pago y reabrir el pedido van juntos: si el pedido no se
  // puede reabrir (su mesa ya tiene otro pedido activo y el índice
  // UX_modu_rest_Pedidos_MesaActiva lo impide), el pago NO debe quedar
  // anulado a medias.
  const pool = await getPool();
  const tx   = new sql.Transaction(pool);
  await tx.begin();
  try {
    // Mismo orden de bloqueo que registrarPago / agregarRonda /
    // cancelarPedido: primero la fila del pedido, después lo demás.
    // Si se tocara Pagos antes que Pedidos, un cobro y una anulación
    // simultáneos del mismo pedido podrían bloquearse mutuamente.
    await new sql.Request(tx)
      .input('pedidoID', sql.UniqueIdentifier, pago.pedidoID)
      .query(`
        SELECT PedidoID FROM modu_rest_Pedidos WITH (UPDLOCK, HOLDLOCK)
        WHERE PedidoID = @pedidoID
      `);

    // Se vuelve a mirar con el bloqueo: otra anulación pudo ganar
    const yaAnulado = await new sql.Request(tx)
      .input('pagoID', sql.UniqueIdentifier, pagoID)
      .query(`SELECT Anulado FROM modu_rest_Pagos WHERE PagoID = @pagoID`);
    if (yaAnulado.recordset[0]?.Anulado)
      throw new AppError('Este pago ya fue anulado anteriormente', 409);

    await new sql.Request(tx)
      .input('pagoID',  sql.UniqueIdentifier, pagoID)
      .input('motivo',  sql.NVarChar,         motivo)
      .query(`
        UPDATE modu_rest_Pagos SET
          Anulado    = 1,
          MotivoBaja = @motivo
        WHERE PagoID = @pagoID
      `);

    // Un pedido cerrado (pagado o fiado) vuelve a quedar cobrable
    await new sql.Request(tx)
      .input('pedidoID', sql.UniqueIdentifier, pago.pedidoID)
      .query(`
        UPDATE modu_rest_Pedidos SET
          EstadoPedido = 'Por Pagar',
          FechaCierre  = NULL
        WHERE PedidoID = @pedidoID AND EstadoPedido IN ('Pagado', 'Fiado')
      `);

    await tx.commit();
  } catch (err) {
    try { await tx.rollback(); } catch { /* ya abortada */ }
    const num = (err as { number?: number })?.number
             ?? (err as { originalError?: { info?: { number?: number } } })?.originalError?.info?.number;
    if (num === 2601 || num === 2627)
      throw new AppError(
        'No se puede anular: la mesa de este pedido ya tiene otro pedido activo. ' +
        'Cierra o cobra ese pedido primero.', 409);
    throw err;
  }
}

// ── Listar cuentas por cobrar ─────────────────────────
// Base para el formulario de cartera. El saldo de la deuda es
// MontoEsperado de la fila fiado menos lo abonado después.

export async function listarCuentasPorCobrar(filtros: {
  estado?: 'PENDIENTE' | 'ABONADA' | 'PAGADO';
  cedula?: string;
}) {
  return query(`
    SELECT
      f.PagoID          AS pagoID,
      f.PedidoID        AS pedidoID,
      pe.NumeroPedido   AS numeroPedido,
      pe.TotalCuenta    AS totalCuenta,
      f.MontoEsperado   AS deudaOriginal,
      f.FechaTransaccion AS fechaCredito,
      JSON_VALUE(f.MetadataPago, '$.cedula')        AS cedula,
      JSON_VALUE(f.MetadataPago, '$.celular')       AS celular,
      JSON_VALUE(f.MetadataPago, '$.nombreCliente') AS nombreCliente,
      JSON_VALUE(f.MetadataPago, '$.autorizadoPor') AS autorizadoPor,
      JSON_VALUE(f.MetadataPago, '$.estadoCredito') AS estadoCredito,
      ISNULL((
        SELECT SUM(ab.MontoPagado - ab.Vuelto)
        FROM modu_rest_Pagos ab
        WHERE ab.PedidoID = f.PedidoID
          AND ab.Anulado  = 0
          AND ab.FechaTransaccion > f.FechaTransaccion
      ), 0)             AS abonado,
      f.MontoEsperado - ISNULL((
        SELECT SUM(ab.MontoPagado - ab.Vuelto)
        FROM modu_rest_Pagos ab
        WHERE ab.PedidoID = f.PedidoID
          AND ab.Anulado  = 0
          AND ab.FechaTransaccion > f.FechaTransaccion
      ), 0)             AS saldoDeuda,
      u.Nombre + ' ' + u.Apellido AS cajero
    FROM modu_rest_Pagos f
    JOIN modu_rest_Pedidos     pe ON f.PedidoID = pe.PedidoID
    JOIN modu_rest_MetodosPago mp ON f.MetodoID = mp.MetodoID
    JOIN modu_rest_Usuarios    u  ON f.CajeroID = u.UsuarioID
    WHERE
      mp.Tipo    = 'Credito'
      AND f.Anulado = 0
      AND ISJSON(f.MetadataPago) = 1
      AND (@estado IS NULL OR JSON_VALUE(f.MetadataPago, '$.estadoCredito') = @estado)
      AND (@cedula IS NULL OR JSON_VALUE(f.MetadataPago, '$.cedula')        = @cedula)
    ORDER BY f.FechaTransaccion DESC
  `, (req) => {
    req.input('estado', sql.NVarChar, filtros.estado ?? null);
    req.input('cedula', sql.NVarChar, filtros.cedula ?? null);
  });
}

// ── Listar pagos por fecha ────────────────────────────

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
      p.MetadataPago       AS metadataPago,
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
      AND ${entreDiasLocales('p.FechaTransaccion', '@desde', '@hasta')}
    ORDER BY p.FechaTransaccion DESC
  `, (req) => {
    req.input('desde', sql.Date, desde);
    req.input('hasta', sql.Date, hasta);
  });
}