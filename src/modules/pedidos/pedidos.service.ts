// src/modules/pedidos/pedidos.service.ts
//
// AÑADIDO en esta versión:
//   · cancelarItemPedido()  — quita un artículo sin borrarlo
//   · obtenerDetallePedido() ahora excluye los cancelados
//   · recalcularTotales()   — reconstruye Subtotal/TotalCuenta del detalle
// El resto del archivo queda igual.

import { query, sql, getPool } from '../../config/database';
import { AppError } from '../../middlewares/error.middleware';
import { enDiaLocal, HOY_LOCAL } from '../../shared/fechas';
import { registrarEvento } from '../../shared/eventos.service';
import { cambiarEstadoMesa } from '../mesas/mesas.service';

// ── Interfaces ───────────────────────────────────────

export interface Pedido {
  pedidoID:       string;
  mesaID:         string | null;
  mesaAlias:      string | null;
  meseroID:       string;
  mesero:         string;
  numeroPedido:   number;
  tipoPedido:     string;
  nombreCliente:  string | null;
  numeroPersonas: number;
  fechaApertura:  string;
  fechaCierre:    string | null;
  estadoPedido:   string;
  subtotal:       number;
  totalImpuestos: number;
  totalDescuento: number;
  totalCuenta:    number;
  notasGenerales: string | null;
  facturado:      boolean;
}

export interface ItemPedido {
  articuloID:       number;
  cantidad:         number;
  notasEspeciales?: string;
}

export interface AbrirPedidoDTO {
  mesaID?:         string;
  tipoPedido?:     'Mesa' | 'Para Llevar' | 'Domicilio';
  nombreCliente?:  string;
  numeroPersonas?: number;
  notasGenerales?: string;
  items:           ItemPedido[];
}

// Estados en los que todavía se puede modificar el contenido del pedido
const ESTADOS_EDITABLES = ['Abierto', 'Por Pagar'];

// ── Helpers ───────────────────────────────────────────

// Lee precio de venta del sistema existente — ya incluye IVA
// Exportada: el módulo de domicilios arma sus líneas con el mismo
// motor de precios que usa abrirPedido, para no duplicar la lógica
// ni arriesgarse a que un domicilio cobre distinto que una mesa.
export async function obtenerPrecioArticulo(articuloID: number): Promise<{
  nombre:      string;
  precioVenta: number;
}> {
  const rows = await query<{
    nombre:      string;
    precioVenta: number;
  }>(`
    SELECT
      a.Nombre AS nombre,
      a.Venta  AS precioVenta
    FROM articulo a
    WHERE a.Id = @articuloID AND a.Estado = 1
  `, (req) => {
    req.input('articuloID', sql.Int, articuloID);
  });

  if (rows.length === 0)
    throw new AppError(`El artículo ${articuloID} no existe o está inactivo`, 400);

  return rows[0];
}

/**
 * Reconstruye Subtotal y TotalCuenta sumando el detalle vigente.
 * Se recalcula en vez de restar para que un error previo no se acumule.
 */
async function recalcularTotales(pedidoID: string): Promise<number> {
  const rows = await query<{ totalCuenta: number }>(`
    UPDATE p
    SET p.Subtotal    = ISNULL(t.suma, 0),
        p.TotalCuenta = ISNULL(t.suma, 0) - ISNULL(p.TotalDescuento, 0)
    OUTPUT INSERTED.TotalCuenta AS totalCuenta
    FROM modu_rest_Pedidos p
    OUTER APPLY (
      SELECT SUM(cd.Subtotal) AS suma
      FROM modu_rest_ComandaDetalle cd
      WHERE cd.PedidoID = p.PedidoID
        AND cd.EstadoItem <> 'Cancelado'
    ) t
    WHERE p.PedidoID = @pedidoID
  `, (req) => {
    req.input('pedidoID', sql.UniqueIdentifier, pedidoID);
  });

  return rows[0]?.totalCuenta ?? 0;
}

/**
 * Corre `fn` dentro de una transacción que tiene bloqueada (UPDLOCK +
 * HOLDLOCK) la fila del pedido, y verifica dentro del bloqueo que el
 * pedido siga siendo editable. Es el mismo bloqueo que toman
 * registrarPago, el fiado, agregarRonda y cancelarPedido: así todo lo
 * que cambia el total o el estado de un pedido se procesa de a uno.
 */
async function conBloqueoPedido<T>(
  pedidoID: string,
  fn: (tx: sql.Transaction, pedido: { estadoPedido: string; totalCuenta: number }) => Promise<T>
): Promise<T> {
  const pool = await getPool();
  const tx   = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
  try {
    const rows = await new sql.Request(tx)
      .input('pedidoID', sql.UniqueIdentifier, pedidoID)
      .query(`
        SELECT EstadoPedido AS estadoPedido, TotalCuenta AS totalCuenta
        FROM modu_rest_Pedidos WITH (UPDLOCK, HOLDLOCK)
        WHERE PedidoID = @pedidoID
      `);
    if (rows.recordset.length === 0) throw new AppError('Pedido no encontrado', 404);

    const pedido = rows.recordset[0] as { estadoPedido: string; totalCuenta: number };
    if (!ESTADOS_EDITABLES.includes(pedido.estadoPedido))
      throw new AppError(`No se puede modificar un pedido en estado ${pedido.estadoPedido}`, 409);

    const resultado = await fn(tx, pedido);
    await tx.commit();
    return resultado;
  } catch (err) {
    try { await tx.rollback(); } catch { /* ya abortada por SQL Server */ }
    throw err;
  }
}

/** Lo ya cobrado de un pedido (neto de vuelto), leído dentro de la transacción. */
async function pagadoEnTx(tx: sql.Transaction, pedidoID: string): Promise<number> {
  const r = await new sql.Request(tx)
    .input('pedidoID', sql.UniqueIdentifier, pedidoID)
    .query(`
      SELECT ISNULL(SUM(pa.MontoPagado - pa.Vuelto), 0) AS pagado
      FROM modu_rest_Pagos pa
      WHERE pa.PedidoID = @pedidoID AND pa.Anulado = 0
    `);
  return r.recordset[0].pagado;
}

/** Igual que recalcularTotales, pero dentro de la transacción. */
async function recalcularTotalesEnTx(tx: sql.Transaction, pedidoID: string): Promise<void> {
  await new sql.Request(tx)
    .input('pedidoID', sql.UniqueIdentifier, pedidoID)
    .query(`
      UPDATE p
      SET p.Subtotal    = ISNULL(t.suma, 0),
          p.TotalCuenta = ISNULL(t.suma, 0) - ISNULL(p.TotalDescuento, 0)
      FROM modu_rest_Pedidos p
      OUTER APPLY (
        SELECT SUM(cd.Subtotal) AS suma
        FROM modu_rest_ComandaDetalle cd
        WHERE cd.PedidoID = p.PedidoID
          AND cd.EstadoItem <> 'Cancelado'
      ) t
      WHERE p.PedidoID = @pedidoID
    `);
}

// ── Obtener pedido ────────────────────────────────────

export async function obtenerPedido(pedidoID: string): Promise<Pedido> {
  const rows = await query<Pedido>(`
    SELECT
      p.PedidoID        AS pedidoID,
      p.MesaID          AS mesaID,
      m.Alias           AS mesaAlias,
      p.MeseroID        AS meseroID,
      u.Nombre + ' ' + u.Apellido AS mesero,
      p.NumeroPedido    AS numeroPedido,
      p.TipoPedido      AS tipoPedido,
      p.NombreCliente   AS nombreCliente,
      p.NumeroPersonas  AS numeroPersonas,
      p.FechaApertura   AS fechaApertura,
      p.FechaCierre     AS fechaCierre,
      p.EstadoPedido    AS estadoPedido,
      p.Subtotal        AS subtotal,
      p.TotalImpuestos  AS totalImpuestos,
      p.TotalDescuento  AS totalDescuento,
      p.TotalCuenta     AS totalCuenta,
      p.NotasGenerales  AS notasGenerales,
      p.Facturado       AS facturado
    FROM modu_rest_Pedidos p
    LEFT JOIN modu_rest_Mesas    m ON p.MesaID   = m.MesaID
    LEFT JOIN modu_rest_Usuarios u ON p.MeseroID = u.UsuarioID
    WHERE p.PedidoID = @pedidoID
  `, (req) => {
    req.input('pedidoID', sql.UniqueIdentifier, pedidoID);
  });

  if (rows.length === 0) throw new AppError('Pedido no encontrado', 404);
  return rows[0];
}

// ── Detalle del pedido ────────────────────────────────
// Excluye los artículos cancelados: esta consulta alimenta la
// pantalla de cobro y la app, donde un ítem quitado no debe sumar.
// El histórico completo, con los cancelados, se ve en el módulo
// de informes (GET /reportes/pedidos/:id).

export async function obtenerDetallePedido(pedidoID: string) {
  return query(`
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
      cd.HoraPedido           AS horaPedido
    FROM modu_rest_ComandaDetalle cd
    WHERE cd.PedidoID = @pedidoID
      AND cd.EstadoItem <> 'Cancelado'
    ORDER BY cd.HoraPedido
  `, (req) => {
    req.input('pedidoID', sql.UniqueIdentifier, pedidoID);
  });
}

// ── Listar pedidos ────────────────────────────────────

export async function listarPedidos(filtros: {
  estado?: string;
  mesaID?: string;
  fecha?:  string;
}): Promise<Pedido[]> {
  return query<Pedido>(`
    SELECT
      p.PedidoID        AS pedidoID,
      p.MesaID          AS mesaID,
      m.Alias           AS mesaAlias,
      p.MeseroID        AS meseroID,
      u.Nombre + ' ' + u.Apellido AS mesero,
      p.NumeroPedido    AS numeroPedido,
      p.TipoPedido      AS tipoPedido,
      p.NombreCliente   AS nombreCliente,
      p.NumeroPersonas  AS numeroPersonas,
      p.FechaApertura   AS fechaApertura,
      p.FechaCierre     AS fechaCierre,
      p.EstadoPedido    AS estadoPedido,
      p.Subtotal        AS subtotal,
      p.TotalImpuestos  AS totalImpuestos,
      p.TotalDescuento  AS totalDescuento,
      p.TotalCuenta     AS totalCuenta,
      p.NotasGenerales  AS notasGenerales,
      p.Facturado       AS facturado
    FROM modu_rest_Pedidos p
    LEFT JOIN modu_rest_Mesas    m ON p.MesaID   = m.MesaID
    LEFT JOIN modu_rest_Usuarios u ON p.MeseroID = u.UsuarioID
    WHERE
      (@estado IS NULL OR p.EstadoPedido = @estado)
      AND (@mesaID IS NULL OR p.MesaID   = @mesaID)
      AND (@fecha  IS NULL OR ${enDiaLocal('p.FechaApertura', '@fecha')})
    ORDER BY p.FechaApertura DESC
  `, (req) => {
    req.input('estado', sql.NVarChar,         filtros.estado ?? null);
    req.input('mesaID', sql.UniqueIdentifier, filtros.mesaID ?? null);
    req.input('fecha',  sql.Date,             filtros.fecha  ?? null);
  });
}

// ── Abrir pedido ──────────────────────────────────────

export async function abrirPedido(
  meseroID: string,
  data: AbrirPedidoDTO
): Promise<Pedido> {

  // 1. Precios fuera de la transacción: son solo lecturas y así la
  //    transacción (y el bloqueo de la mesa) dura lo mínimo.
  //    TotalCuenta = Subtotal — el precio ya incluye IVA.
  const itemsConPrecio = await Promise.all(
    data.items.map(async (item) => {
      const art          = await obtenerPrecioArticulo(item.articuloID);
      const itemSubtotal = art.precioVenta * item.cantidad;
      return { ...item, ...art, itemSubtotal };
    })
  );
  const subtotal    = itemsConPrecio.reduce((acc, i) => acc + i.itemSubtotal, 0);
  const totalCuenta = subtotal;

  // 2-5. Verificar mesa + crear pedido, comanda e ítems en UNA transacción.
  //
  // Antes cada paso era una consulta suelta: si llegaban dos o tres POST
  // casi simultáneos (doble toque en "Enviar", reintento de la app con
  // mala señal), todos pasaban el "¿la mesa está libre?" antes de que
  // cualquiera insertara, y la mesa quedaba con varios pedidos activos.
  // En producción hay casos con 0-3 ms entre pedidos de la misma mesa.
  //
  // UPDLOCK + HOLDLOCK sobre la fila de la mesa serializa las aperturas
  // de una misma mesa: la segunda petición espera a que la primera haga
  // COMMIT y entonces ya ve el pedido y recibe 409. El índice único
  // filtrado UX_modu_rest_Pedidos_MesaActiva es la red de seguridad.
  const pool = await getPool();
  const tx   = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

  let pedidoID: string;
  let numeroPedido: number;

  try {
    if (data.mesaID) {
      const bloqueo = await new sql.Request(tx)
        .input('mesaID', sql.UniqueIdentifier, data.mesaID)
        .query(`
          SELECT MesaID FROM modu_rest_Mesas WITH (UPDLOCK, HOLDLOCK)
          WHERE MesaID = @mesaID
        `);
      if (bloqueo.recordset.length === 0)
        throw new AppError('Mesa no encontrada', 404);

      const ocupada = await new sql.Request(tx)
        .input('mesaID', sql.UniqueIdentifier, data.mesaID)
        .query(`
          SELECT COUNT(*) AS total
          FROM modu_rest_Pedidos WITH (UPDLOCK, HOLDLOCK)
          WHERE MesaID = @mesaID
            AND EstadoPedido IN ('Abierto', 'Por Pagar')
        `);
      if (ocupada.recordset[0].total > 0)
        throw new AppError('Esta mesa ya tiene un pedido activo', 409);
    }

    // El consecutivo también se calculaba sin bloqueo (de ahí que los
    // duplicados compartan NumeroPedido). Con UPDLOCK+HOLDLOCK sobre el
    // rango del día, dos pedidos simultáneos ya no reciben el mismo número.
    const numRows = await new sql.Request(tx).query(`
      SELECT ISNULL(MAX(NumeroPedido), 0) + 1 AS siguiente
      FROM modu_rest_Pedidos WITH (UPDLOCK, HOLDLOCK)
      WHERE ${enDiaLocal('FechaApertura', HOY_LOCAL)}
    `);
    numeroPedido = numRows.recordset[0].siguiente;

    const pedidoRows = await new sql.Request(tx)
      .input('mesaID',         sql.UniqueIdentifier, data.mesaID        ?? null)
      .input('meseroID',       sql.UniqueIdentifier, meseroID)
      .input('numeroPedido',   sql.Int,              numeroPedido)
      .input('tipoPedido',     sql.NVarChar,         data.tipoPedido    ?? 'Mesa')
      .input('nombreCliente',  sql.NVarChar,         data.nombreCliente ?? null)
      .input('numeroPersonas', sql.Int,              data.numeroPersonas ?? 1)
      .input('subtotal',       sql.Decimal(18, 2),   subtotal)
      .input('totalCuenta',    sql.Decimal(18, 2),   totalCuenta)
      .input('notasGenerales', sql.NVarChar,         data.notasGenerales ?? null)
      .query(`
        INSERT INTO modu_rest_Pedidos (
          MesaID, MeseroID, NumeroPedido, TipoPedido,
          NombreCliente, NumeroPersonas, EstadoPedido,
          Subtotal, TotalImpuestos, TotalDescuento, TotalCuenta,
          NotasGenerales, MesaAlias
        )
        OUTPUT INSERTED.PedidoID
        VALUES (
          @mesaID, @meseroID, @numeroPedido, @tipoPedido,
          @nombreCliente, @numeroPersonas, 'Abierto',
          @subtotal, 0, 0, @totalCuenta,
          @notasGenerales,
          (SELECT Alias FROM modu_rest_Mesas WHERE MesaID = @mesaID)
        )
      `);
    pedidoID = pedidoRows.recordset[0].PedidoID;

    const comandaRows = await new sql.Request(tx)
      .input('pedidoID', sql.UniqueIdentifier, pedidoID)
      .query(`
        INSERT INTO modu_rest_Comandas (PedidoID, NumeroRonda, Estado)
        OUTPUT INSERTED.ComandaID
        VALUES (@pedidoID, 1, 'Pendiente')
      `);
    const comandaID = comandaRows.recordset[0].ComandaID;

    // MontoIVA = 0 porque el precio ya lo incluye
    for (const item of itemsConPrecio) {
      await new sql.Request(tx)
        .input('comandaID',       sql.UniqueIdentifier, comandaID)
        .input('pedidoID',        sql.UniqueIdentifier, pedidoID)
        .input('articuloID',      sql.Int,              item.articuloID)
        .input('nombreArticulo',  sql.NVarChar,         item.nombre)
        .input('cantidad',        sql.Decimal(10, 2),   item.cantidad)
        .input('precioVenta',     sql.Decimal(18, 2),   item.precioVenta)
        .input('subtotal',        sql.Decimal(18, 2),   item.itemSubtotal)
        .input('notasEspeciales', sql.NVarChar,         item.notasEspeciales ?? null)
        .query(`
          INSERT INTO modu_rest_ComandaDetalle (
            ComandaID, PedidoID, IdArticulo, NombreArticulo,
            Cantidad, PrecioVentaHistorico,
            PorcentajeIVA, MontoIVA, MontoDescuento,
            Subtotal, EstadoItem, NotasEspeciales
          )
          VALUES (
            @comandaID, @pedidoID, @articuloID, @nombreArticulo,
            @cantidad, @precioVenta,
            0, 0, 0,
            @subtotal, 'Pendiente', @notasEspeciales
          )
        `);
    }

    await tx.commit();
  } catch (err) {
    try { await tx.rollback(); } catch { /* ya abortada por SQL Server */ }

    // 2601/2627: violación del índice único → otra petición ganó la carrera
    const num = (err as { number?: number })?.number
             ?? (err as { originalError?: { info?: { number?: number } } })?.originalError?.info?.number;
    if (num === 2601 || num === 2627)
      throw new AppError('Esta mesa ya tiene un pedido activo', 409);
    throw err;
  }

  // 6. Cambiar estado de la mesa
  if (data.mesaID) {
    await cambiarEstadoMesa(data.mesaID, 'Ocupada');
  }

  const pedido = await obtenerPedido(pedidoID);

  // 7. Emitir evento
  await registrarEvento({
    tipo:        'MESA_ABIERTA',
    entidadTipo: 'Pedido',
    entidadID:   pedidoID,
    usuarioID:   meseroID,
    payload: {
      pedidoID,
      numeroPedido,
      mesaID:          data.mesaID,
      mesaAlias:       pedido.mesaAlias,
      mesero:          pedido.mesero,
      totalItems:      data.items.length,
      nuevoEstadoMesa: 'Ocupada',
    },
  });

  return pedido;
}

// ── Agregar ronda ─────────────────────────────────────

// Ventana para considerar una ronda idéntica como envío repetido
// (doble toque en "Enviar" o reintento de la app con mala señal).
// Debe ser MAYOR que el timeout de los clientes (app 15 s, escritorio
// 30 s): si la respuesta se pierde, el reintento llega después del
// timeout. Con 10 s el reintento pasaba como ronda nueva (QA, caso D3).
export const VENTANA_RONDA_DUPLICADA_MS = 45_000;

// Ventana extendida: una ronda idéntica a la última se sigue rechazando
// hasta este tiempo SI la última todavía no está marcada como entregada
// (Estado 'Despachada', que pone el MESERO con "Ya entregué en la mesa" /
// "Entregar ronda"; no hay paso por cocina) ni cancelada.
// Cubre el reintento lento: la app espera 15 s de timeout (el escritorio
// 30 s) y luego el mesero lee el error, abre el carrito y reenvía; en QA
// r3 (D3) eso llegó a los 48-62 s y la ronda entró duplicada. Si la
// última ronda ya se entregó en la mesa, una idéntica es un pedido nuevo.
export const VENTANA_RONDA_NO_DESPACHADA_MS = 120_000;
const ESTADOS_COMANDA_CERRADA = ['Despachada', 'Cancelada'];

// Firma de una ronda: artículos + cantidades + notas, sin importar el orden.
function firmaRonda(items: { articuloID: number; cantidad: number; notasEspeciales?: string | null }[]): string {
  return items
    .map(i => `${i.articuloID}|${Number(i.cantidad)}|${(i.notasEspeciales ?? '').trim()}`)
    .sort()
    .join(';');
}

export async function agregarRonda(
  pedidoID: string,
  meseroID: string,
  items: ItemPedido[]
): Promise<{ pedido: Pedido; comandaID: string; numeroRonda: number }> {

  // Validación rápida (404 / estado) antes de abrir la transacción
  const pedido = await obtenerPedido(pedidoID);
  if (pedido.estadoPedido !== 'Abierto')
    throw new AppError('No se pueden agregar ítems a un pedido que no está abierto', 409);

  // Precios fuera de la transacción: solo lecturas. Sin IVA adicional.
  const itemsConPrecio = await Promise.all(
    items.map(async (item) => {
      const art          = await obtenerPrecioArticulo(item.articuloID);
      const itemSubtotal = art.precioVenta * item.cantidad;
      return { ...item, ...art, itemSubtotal };
    })
  );
  const subtotalNuevo = itemsConPrecio.reduce((acc, i) => acc + i.itemSubtotal, 0);

  // Antes cada paso era una consulta suelta: dos POST casi simultáneos
  // (doble toque, reintento) contaban las mismas rondas, insertaban dos
  // comandas con el mismo NumeroRonda y sumaban el total dos veces.
  // En producción hubo rondas repetidas hasta 4 veces con 0-5 ms de
  // diferencia, varias ya despachadas y cobradas.
  //
  // UPDLOCK + HOLDLOCK sobre la fila del pedido serializa las rondas de
  // un mismo pedido. Dentro del bloqueo se rechaza una ronda idéntica a
  // la última si llegó hace menos de VENTANA_RONDA_DUPLICADA_MS, o hace
  // menos de VENTANA_RONDA_NO_DESPACHADA_MS y la última sigue sin entregar.
  const pool = await getPool();
  const tx   = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

  let comandaID: string;
  let numeroRonda: number;

  try {
    const bloqueo = await new sql.Request(tx)
      .input('pedidoID', sql.UniqueIdentifier, pedidoID)
      .query(`
        SELECT EstadoPedido AS estadoPedido
        FROM modu_rest_Pedidos WITH (UPDLOCK, HOLDLOCK)
        WHERE PedidoID = @pedidoID
      `);
    if (bloqueo.recordset.length === 0)
      throw new AppError('Pedido no encontrado', 404);
    // Se vuelve a mirar ya con el bloqueo: pudo cobrarse o cancelarse
    // entre la validación de arriba y este punto.
    if (bloqueo.recordset[0].estadoPedido !== 'Abierto')
      throw new AppError('No se pueden agregar ítems a un pedido que no está abierto', 409);

    // Última ronda del pedido y hace cuánto llegó
    const ultima = await new sql.Request(tx)
      .input('pedidoID', sql.UniqueIdentifier, pedidoID)
      .query(`
        SELECT TOP 1
          c.ComandaID   AS comandaID,
          c.NumeroRonda AS numeroRonda,
          c.Estado      AS estado,
          DATEDIFF(MILLISECOND, c.HoraEnviada, SYSUTCDATETIME()) AS msDesde
        FROM modu_rest_Comandas c
        WHERE c.PedidoID = @pedidoID
        ORDER BY c.HoraEnviada DESC, c.NumeroRonda DESC
      `);

    const u = ultima.recordset[0];
    const posibleRepeticion = u && (
      u.msDesde < VENTANA_RONDA_DUPLICADA_MS ||
      (u.msDesde < VENTANA_RONDA_NO_DESPACHADA_MS && !ESTADOS_COMANDA_CERRADA.includes(u.estado))
    );
    if (posibleRepeticion) {
      const detUltima = await new sql.Request(tx)
        .input('comandaID', sql.UniqueIdentifier, u.comandaID)
        .query(`
          SELECT IdArticulo AS articuloID, Cantidad AS cantidad,
                 NotasEspeciales AS notasEspeciales
          FROM modu_rest_ComandaDetalle
          WHERE ComandaID = @comandaID
        `);
      if (firmaRonda(detUltima.recordset) === firmaRonda(items))
        throw new AppError(
          // El texto no debe invitar a reenviar: en el caso típico (la app
          // mostró "Error de conexión" pero el servidor sí la guardó) el
          // mesero esperaría y la reenviaría, y pasada la ventana entraría
          // duplicada (QA r2, hallazgo 1).
          `Esta ronda ya quedó registrada (ronda #${u.numeroRonda}, ` +
          `hace ${Math.max(1, Math.round(u.msDesde / 1000))} s). No hace falta reenviarla.`,
          409);
    }

    const max = await new sql.Request(tx)
      .input('pedidoID', sql.UniqueIdentifier, pedidoID)
      .query(`
        SELECT ISNULL(MAX(NumeroRonda), 0) + 1 AS siguiente
        FROM modu_rest_Comandas WHERE PedidoID = @pedidoID
      `);
    numeroRonda = max.recordset[0].siguiente;

    const comandaRows = await new sql.Request(tx)
      .input('pedidoID',    sql.UniqueIdentifier, pedidoID)
      .input('numeroRonda', sql.Int,              numeroRonda)
      .query(`
        INSERT INTO modu_rest_Comandas (PedidoID, NumeroRonda, Estado)
        OUTPUT INSERTED.ComandaID
        VALUES (@pedidoID, @numeroRonda, 'Pendiente')
      `);
    comandaID = comandaRows.recordset[0].ComandaID;

    for (const item of itemsConPrecio) {
      await new sql.Request(tx)
        .input('comandaID',       sql.UniqueIdentifier, comandaID)
        .input('pedidoID',        sql.UniqueIdentifier, pedidoID)
        .input('articuloID',      sql.Int,              item.articuloID)
        .input('nombreArticulo',  sql.NVarChar,         item.nombre)
        .input('cantidad',        sql.Decimal(10, 2),   item.cantidad)
        .input('precioVenta',     sql.Decimal(18, 2),   item.precioVenta)
        .input('subtotal',        sql.Decimal(18, 2),   item.itemSubtotal)
        .input('notasEspeciales', sql.NVarChar,         item.notasEspeciales ?? null)
        .query(`
          INSERT INTO modu_rest_ComandaDetalle (
            ComandaID, PedidoID, IdArticulo, NombreArticulo,
            Cantidad, PrecioVentaHistorico,
            PorcentajeIVA, MontoIVA, MontoDescuento,
            Subtotal, EstadoItem, NotasEspeciales
          )
          VALUES (
            @comandaID, @pedidoID, @articuloID, @nombreArticulo,
            @cantidad, @precioVenta,
            0, 0, 0,
            @subtotal, 'Pendiente', @notasEspeciales
          )
        `);
    }

    // Actualizar totales — solo sumar subtotal, sin IVA
    await new sql.Request(tx)
      .input('pedidoID',      sql.UniqueIdentifier, pedidoID)
      .input('subtotalNuevo', sql.Decimal(18, 2),   subtotalNuevo)
      .query(`
        UPDATE modu_rest_Pedidos SET
          Subtotal    = Subtotal    + @subtotalNuevo,
          TotalCuenta = TotalCuenta + @subtotalNuevo
        WHERE PedidoID = @pedidoID
      `);

    await tx.commit();
  } catch (err) {
    try { await tx.rollback(); } catch { /* ya abortada por SQL Server */ }
    throw err;
  }

  const pedidoActualizado = await obtenerPedido(pedidoID);
  return { pedido: pedidoActualizado, comandaID, numeroRonda };
}

// ── Cancelar un artículo del pedido ──────────────────
//
// No se borra la fila: se marca como Cancelada y queda con el
// usuario que la quitó, el motivo y la hora. Eso es lo que
// permite auditar después y lo que desincentiva el mal uso.
//
// Reglas:
//   · Solo en pedidos Abierto o Por Pagar. Uno cerrado no se toca.
//   · No se puede dejar el total por debajo de lo ya pagado.
//   · El total del pedido se recalcula de inmediato.

export interface CancelarItemDTO {
  motivo: string;
}

export async function cancelarItemPedido(
  pedidoID:  string,
  detalleID: string,
  usuarioID: string,
  motivo:    string
): Promise<{
  pedido: Pedido;
  articulo: string;
  montoRetirado: number;
  itemsRestantes: number;
}> {

  // Todo en UNA transacción con el bloqueo del pedido (el mismo de
  // registrarPago / fiado / rondas). Antes, un cobro simultáneo podía
  // leer el total viejo y marcar Pagado mientras el total cambiaba.
  const { item, itemsRestantes } = await conBloqueoPedido(pedidoID, async (tx, pedidoActual) => {

    // 2. El artículo debe existir, pertenecer al pedido y no estar cancelado
    const itemRows = await new sql.Request(tx)
      .input('detalleID', sql.UniqueIdentifier, detalleID)
      .input('pedidoID',  sql.UniqueIdentifier, pedidoID)
      .query(`
        SELECT
          cd.NombreArticulo AS articulo,
          cd.Subtotal       AS subtotal,
          cd.EstadoItem     AS estadoItem
        FROM modu_rest_ComandaDetalle cd
        WHERE cd.DetalleID = @detalleID AND cd.PedidoID = @pedidoID
      `);

    if (itemRows.recordset.length === 0)
      throw new AppError('El artículo no pertenece a este pedido', 404);

    const item = itemRows.recordset[0] as { articulo: string; subtotal: number; estadoItem: string };

    if (item.estadoItem === 'Cancelado')
      throw new AppError('Este artículo ya estaba cancelado', 409);

    // 3. No dejar el total por debajo de lo ya cobrado
    const yaPagado   = await pagadoEnTx(tx, pedidoID);
    const nuevoTotal = pedidoActual.totalCuenta - item.subtotal;

    if (nuevoTotal < yaPagado) {
      throw new AppError(
        `No se puede quitar este artículo: el pedido quedaría en ` +
        `$${nuevoTotal.toLocaleString()} y ya se han cobrado ` +
        `$${yaPagado.toLocaleString()}. Anula primero el pago.`,
        409);
    }

    // 4. Marcar como cancelado dejando el rastro
    await new sql.Request(tx)
      .input('detalleID', sql.UniqueIdentifier, detalleID)
      .input('usuarioID', sql.UniqueIdentifier, usuarioID)
      .input('motivo',    sql.NVarChar,         motivo)
      .query(`
        UPDATE modu_rest_ComandaDetalle SET
          EstadoItem        = 'Cancelado',
          MotivoCancelacion = @motivo,
          CanceladoPor      = @usuarioID,
          FechaCancelacion  = SYSUTCDATETIME()
        WHERE DetalleID = @detalleID
      `);

    // 5. Recalcular el total del pedido
    await recalcularTotalesEnTx(tx, pedidoID);

    // 6. Cuántos artículos quedan vigentes
    const restantes = await new sql.Request(tx)
      .input('pedidoID', sql.UniqueIdentifier, pedidoID)
      .query(`
        SELECT COUNT(*) AS total
        FROM modu_rest_ComandaDetalle
        WHERE PedidoID = @pedidoID AND EstadoItem <> 'Cancelado'
      `);

    return { item, itemsRestantes: restantes.recordset[0].total as number };
  });

  const pedido = await obtenerPedido(pedidoID);

  return {
    pedido,
    articulo:       item.articulo,
    montoRetirado:  item.subtotal,
    itemsRestantes,
  };
}

// ── Cambiar la cantidad de un artículo ───────────────
//
// Distinto de cancelar: aquí el artículo sigue en el pedido, solo
// cambia cuánto se lleva el cliente. Corregir "puse 3 y era 2" a los
// diez segundos no debería ensuciar el informe de anulaciones.
//
// Bajar a cero equivale a cancelar, y para eso está cancelarItemPedido.

export async function cambiarCantidadItem(
  pedidoID:  string,
  detalleID: string,
  cantidad:  number
): Promise<{ pedido: Pedido; articulo: string; nuevoSubtotal: number }> {

  if (cantidad <= 0)
    throw new AppError('La cantidad debe ser mayor a cero. Para quitar el artículo, cancélalo.', 400);

  // Todo en UNA transacción con el bloqueo del pedido. Antes, cambiar la
  // cantidad mientras se cobraba dejaba el pedido Pagado con un total
  // mayor a lo cobrado (QA r2: X3).
  const { articulo, nuevoSubtotal } = await conBloqueoPedido(pedidoID, async (tx, pedidoActual) => {

    // 2. El artículo debe existir y estar vigente
    const itemRows = await new sql.Request(tx)
      .input('detalleID', sql.UniqueIdentifier, detalleID)
      .input('pedidoID',  sql.UniqueIdentifier, pedidoID)
      .query(`
        SELECT
          cd.NombreArticulo       AS articulo,
          cd.Cantidad             AS cantidad,
          cd.PrecioVentaHistorico AS precio,
          cd.Subtotal             AS subtotal,
          cd.EstadoItem           AS estadoItem
        FROM modu_rest_ComandaDetalle cd
        WHERE cd.DetalleID = @detalleID AND cd.PedidoID = @pedidoID
      `);

    if (itemRows.recordset.length === 0)
      throw new AppError('El artículo no pertenece a este pedido', 404);

    const item = itemRows.recordset[0] as {
      articulo: string; cantidad: number; precio: number; subtotal: number; estadoItem: string;
    };

    if (item.estadoItem === 'Cancelado')
      throw new AppError('Este artículo está cancelado', 409);

    // 3. No dejar el total por debajo de lo ya cobrado
    const nuevoSubtotal = item.precio * cantidad;
    const nuevoTotal    = pedidoActual.totalCuenta - item.subtotal + nuevoSubtotal;
    const pagado        = await pagadoEnTx(tx, pedidoID);

    if (nuevoTotal < pagado) {
      throw new AppError(
        `No se puede reducir tanto: el pedido quedaría en ` +
        `$${nuevoTotal.toLocaleString()} y ya se cobraron ` +
        `$${pagado.toLocaleString()}.`,
        409);
    }

    // 4. Actualizar la línea
    await new sql.Request(tx)
      .input('detalleID', sql.UniqueIdentifier, detalleID)
      .input('cantidad',  sql.Decimal(10, 2),   cantidad)
      .input('subtotal',  sql.Decimal(18, 2),   nuevoSubtotal)
      .query(`
        UPDATE modu_rest_ComandaDetalle SET
          Cantidad = @cantidad,
          Subtotal = @subtotal
        WHERE DetalleID = @detalleID
      `);

    await recalcularTotalesEnTx(tx, pedidoID);

    return { articulo: item.articulo, nuevoSubtotal };
  });

  return {
    pedido: await obtenerPedido(pedidoID),
    articulo,
    nuevoSubtotal,
  };
}

// ── Artículos cancelados de un pedido ────────────────
// Para mostrarlos tachados donde haga falta.

export async function itemsCanceladosPedido(pedidoID: string) {
  return query(`
    SELECT
      cd.DetalleID        AS detalleID,
      cd.NombreArticulo   AS articulo,
      cd.Cantidad         AS cantidad,
      cd.Subtotal         AS subtotal,
      cd.MotivoCancelacion AS motivo,
      cd.FechaCancelacion AS fechaCancelacion,
      ISNULL(u.Nombre + ' ' + u.Apellido, '—') AS canceladoPor
    FROM modu_rest_ComandaDetalle cd
    LEFT JOIN modu_rest_Usuarios u ON cd.CanceladoPor = u.UsuarioID
    WHERE cd.PedidoID = @pedidoID AND cd.EstadoItem = 'Cancelado'
    ORDER BY cd.FechaCancelacion DESC
  `, (req) => {
    req.input('pedidoID', sql.UniqueIdentifier, pedidoID);
  });
}

// ── Solicitar cuenta ──────────────────────────────────

export async function solicitarCuenta(
  pedidoID: string,
  meseroID: string
): Promise<Pedido> {
  const pedido = await obtenerPedido(pedidoID);

  if (pedido.estadoPedido !== 'Abierto')
    throw new AppError('El pedido no está en estado Abierto', 409);

  await query(`
    UPDATE modu_rest_Pedidos
    SET EstadoPedido = 'Por Pagar'
    WHERE PedidoID = @pedidoID
  `, (req) => {
    req.input('pedidoID', sql.UniqueIdentifier, pedidoID);
  });

  if (pedido.mesaID) {
    await cambiarEstadoMesa(pedido.mesaID, 'Cuenta-Pedida');
  }

  return obtenerPedido(pedidoID);
}

// ── Cancelar pedido ───────────────────────────────────

export async function cancelarPedido(
  pedidoID: string,
  usuarioID: string
): Promise<void> {
  const pedido = await obtenerPedido(pedidoID);

  if (pedido.estadoPedido === 'Pagado')
    throw new AppError('No se puede cancelar un pedido ya pagado', 409);

  // Revisión de pagos y las dos actualizaciones en UNA transacción con el
  // mismo bloqueo del pedido que usan agregarRonda y registrarPago. Antes,
  // una ronda que entraba entre los dos UPDATE quedaba "Pendiente" en un
  // pedido Cancelado, y un cobro simultáneo podía colarse tras la revisión.
  const pool = await getPool();
  const tx   = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

  try {
    const bloqueo = await new sql.Request(tx)
      .input('pedidoID', sql.UniqueIdentifier, pedidoID)
      .query(`
        SELECT EstadoPedido AS estadoPedido
        FROM modu_rest_Pedidos WITH (UPDLOCK, HOLDLOCK)
        WHERE PedidoID = @pedidoID
      `);
    if (bloqueo.recordset.length === 0)
      throw new AppError('Pedido no encontrado', 404);
    // Se vuelve a mirar con el bloqueo: pudo cobrarse en el intertanto
    if (bloqueo.recordset[0].estadoPedido === 'Pagado')
      throw new AppError('No se puede cancelar un pedido ya pagado', 409);

    // Un pedido con pagos ya registrados (abono parcial, fiado) no se puede
    // cancelar de un tirón: ese dinero quedaría cobrado sobre un pedido que
    // ya no existe. Primero hay que anular esos pagos.
    const pagos = await new sql.Request(tx)
      .input('pedidoID', sql.UniqueIdentifier, pedidoID)
      .query(`
        SELECT ISNULL(SUM(pa.MontoPagado - pa.Vuelto), 0) AS pagado
        FROM modu_rest_Pagos pa
        WHERE pa.PedidoID = @pedidoID AND pa.Anulado = 0
      `);

    if (pagos.recordset[0].pagado > 0)
      throw new AppError(
        'Este pedido ya tiene pagos registrados. Anúlalos antes de cancelar el pedido.',
        409);

    await new sql.Request(tx)
      .input('pedidoID', sql.UniqueIdentifier, pedidoID)
      .query(`
        UPDATE modu_rest_Pedidos
        SET EstadoPedido = 'Cancelado', FechaCierre = SYSUTCDATETIME()
        WHERE PedidoID = @pedidoID
      `);

    await new sql.Request(tx)
      .input('pedidoID', sql.UniqueIdentifier, pedidoID)
      .query(`
        UPDATE modu_rest_Comandas
        SET Estado = 'Cancelada'
        WHERE PedidoID = @pedidoID AND Estado NOT IN ('Lista', 'Cancelada')
      `);

    await tx.commit();
  } catch (err) {
    try { await tx.rollback(); } catch { /* ya abortada por SQL Server */ }
    throw err;
  }

  if (pedido.mesaID) {
    await cambiarEstadoMesa(pedido.mesaID, 'Libre');
  }

  await registrarEvento({
    tipo:        'MESA_CERRADA',
    entidadTipo: 'Pedido',
    entidadID:   pedidoID,
    usuarioID:   usuarioID,
    payload: {
      pedidoID,
      motivo:          'Cancelado',
      mesaAlias:       pedido.mesaAlias,
      nuevoEstadoMesa: 'Libre',
    },
  });
}