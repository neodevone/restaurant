// src/modules/pedidos/pedidos.service.ts
//
// AÑADIDO en esta versión:
//   · cancelarItemPedido()  — quita un artículo sin borrarlo
//   · obtenerDetallePedido() ahora excluye los cancelados
//   · recalcularTotales()   — reconstruye Subtotal/TotalCuenta del detalle
// El resto del archivo queda igual.

import { query, sql } from '../../config/database';
import { AppError } from '../../middlewares/error.middleware';
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

async function siguienteNumeroPedido(): Promise<number> {
  const rows = await query<{ siguiente: number }>(`
    SELECT ISNULL(MAX(NumeroPedido), 0) + 1 AS siguiente
    FROM modu_rest_Pedidos
    WHERE CAST(FechaApertura AS DATE) = CAST(SYSUTCDATETIME() AS DATE)
  `);
  return rows[0].siguiente;
}

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
      AND (@fecha  IS NULL OR CAST(p.FechaApertura AS DATE) = @fecha)
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

  // 1. Verificar que la mesa esté libre
  if (data.mesaID) {
    const mesaOcupada = await query<{ total: number }>(`
      SELECT COUNT(*) AS total
      FROM modu_rest_Pedidos
      WHERE MesaID = @mesaID
        AND EstadoPedido IN ('Abierto', 'Por Pagar')
    `, (req) => {
      req.input('mesaID', sql.UniqueIdentifier, data.mesaID!);
    });

    if (mesaOcupada[0].total > 0)
      throw new AppError('Esta mesa ya tiene un pedido activo', 409);
  }

  // 2. Calcular totales — precio ya incluye IVA, NO calcular encima
  let subtotal = 0;

  const itemsConPrecio = await Promise.all(
    data.items.map(async (item) => {
      const art          = await obtenerPrecioArticulo(item.articuloID);
      const itemSubtotal = art.precioVenta * item.cantidad;
      subtotal          += itemSubtotal;
      return { ...item, ...art, itemSubtotal };
    })
  );

  // TotalCuenta = Subtotal (sin IVA adicional)
  const totalCuenta  = subtotal;
  const numeroPedido = await siguienteNumeroPedido();

  // 3. Crear el pedido
  const pedidoRows = await query<{ PedidoID: string }>(`
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
  `, (req) => {
    req.input('mesaID',         sql.UniqueIdentifier, data.mesaID        ?? null);
    req.input('meseroID',       sql.UniqueIdentifier, meseroID);
    req.input('numeroPedido',   sql.Int,              numeroPedido);
    req.input('tipoPedido',     sql.NVarChar,         data.tipoPedido    ?? 'Mesa');
    req.input('nombreCliente',  sql.NVarChar,         data.nombreCliente ?? null);
    req.input('numeroPersonas', sql.Int,              data.numeroPersonas ?? 1);
    req.input('subtotal',       sql.Decimal(18, 2),   subtotal);
    req.input('totalCuenta',    sql.Decimal(18, 2),   totalCuenta);
    req.input('notasGenerales', sql.NVarChar,         data.notasGenerales ?? null);
  });

  const pedidoID = pedidoRows[0].PedidoID;

  // 4. Crear comanda
  const comandaRows = await query<{ ComandaID: string }>(`
    INSERT INTO modu_rest_Comandas (PedidoID, NumeroRonda, Estado)
    OUTPUT INSERTED.ComandaID
    VALUES (@pedidoID, 1, 'Pendiente')
  `, (req) => {
    req.input('pedidoID', sql.UniqueIdentifier, pedidoID);
  });

  const comandaID = comandaRows[0].ComandaID;

  // 5. Insertar ítems — MontoIVA = 0 porque precio ya lo incluye
  for (const item of itemsConPrecio) {
    await query(`
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
    `, (req) => {
      req.input('comandaID',       sql.UniqueIdentifier, comandaID);
      req.input('pedidoID',        sql.UniqueIdentifier, pedidoID);
      req.input('articuloID',      sql.Int,              item.articuloID);
      req.input('nombreArticulo',  sql.NVarChar,         item.nombre);
      req.input('cantidad',        sql.Decimal(10, 2),   item.cantidad);
      req.input('precioVenta',     sql.Decimal(18, 2),   item.precioVenta);
      req.input('subtotal',        sql.Decimal(18, 2),   item.itemSubtotal);
      req.input('notasEspeciales', sql.NVarChar,         item.notasEspeciales ?? null);
    });
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

export async function agregarRonda(
  pedidoID: string,
  meseroID: string,
  items: ItemPedido[]
): Promise<{ pedido: Pedido; comandaID: string; numeroRonda: number }> {

  const pedido = await obtenerPedido(pedidoID);

  if (pedido.estadoPedido !== 'Abierto')
    throw new AppError('No se pueden agregar ítems a un pedido que no está abierto', 409);

  const rondasRows = await query<{ totalRondas: number }>(`
    SELECT COUNT(*) AS totalRondas
    FROM modu_rest_Comandas
    WHERE PedidoID = @pedidoID
  `, (req) => {
    req.input('pedidoID', sql.UniqueIdentifier, pedidoID);
  });

  const numeroRonda = rondasRows[0].totalRondas + 1;

  // Calcular sin IVA adicional
  let subtotalNuevo = 0;

  const itemsConPrecio = await Promise.all(
    items.map(async (item) => {
      const art          = await obtenerPrecioArticulo(item.articuloID);
      const itemSubtotal = art.precioVenta * item.cantidad;
      subtotalNuevo     += itemSubtotal;
      return { ...item, ...art, itemSubtotal };
    })
  );

  const comandaRows = await query<{ ComandaID: string }>(`
    INSERT INTO modu_rest_Comandas (PedidoID, NumeroRonda, Estado)
    OUTPUT INSERTED.ComandaID
    VALUES (@pedidoID, @numeroRonda, 'Pendiente')
  `, (req) => {
    req.input('pedidoID',    sql.UniqueIdentifier, pedidoID);
    req.input('numeroRonda', sql.Int,              numeroRonda);
  });

  const comandaID = comandaRows[0].ComandaID;

  for (const item of itemsConPrecio) {
    await query(`
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
    `, (req) => {
      req.input('comandaID',       sql.UniqueIdentifier, comandaID);
      req.input('pedidoID',        sql.UniqueIdentifier, pedidoID);
      req.input('articuloID',      sql.Int,              item.articuloID);
      req.input('nombreArticulo',  sql.NVarChar,         item.nombre);
      req.input('cantidad',        sql.Decimal(10, 2),   item.cantidad);
      req.input('precioVenta',     sql.Decimal(18, 2),   item.precioVenta);
      req.input('subtotal',        sql.Decimal(18, 2),   item.itemSubtotal);
      req.input('notasEspeciales', sql.NVarChar,         item.notasEspeciales ?? null);
    });
  }

  // Actualizar totales — solo sumar subtotal, sin IVA
  await query(`
    UPDATE modu_rest_Pedidos SET
      Subtotal    = Subtotal    + @subtotalNuevo,
      TotalCuenta = TotalCuenta + @subtotalNuevo
    WHERE PedidoID = @pedidoID
  `, (req) => {
    req.input('pedidoID',      sql.UniqueIdentifier, pedidoID);
    req.input('subtotalNuevo', sql.Decimal(18, 2),   subtotalNuevo);
  });

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

  // 1. El pedido debe ser modificable
  const pedidoRows = await query<{
    estadoPedido: string;
    totalCuenta:  number;
    numeroPedido: number;
    mesaAlias:    string | null;
  }>(`
    SELECT
      p.EstadoPedido AS estadoPedido,
      p.TotalCuenta  AS totalCuenta,
      p.NumeroPedido AS numeroPedido,
      m.Alias        AS mesaAlias
    FROM modu_rest_Pedidos p
    LEFT JOIN modu_rest_Mesas m ON p.MesaID = m.MesaID
    WHERE p.PedidoID = @pedidoID
  `, (req) => {
    req.input('pedidoID', sql.UniqueIdentifier, pedidoID);
  });

  if (pedidoRows.length === 0) throw new AppError('Pedido no encontrado', 404);

  const pedidoActual = pedidoRows[0];

  if (!ESTADOS_EDITABLES.includes(pedidoActual.estadoPedido))
    throw new AppError(
      `No se puede modificar un pedido en estado ${pedidoActual.estadoPedido}`, 409);

  // 2. El artículo debe existir, pertenecer al pedido y no estar cancelado
  const itemRows = await query<{
    articulo: string;
    subtotal: number;
    estadoItem: string;
  }>(`
    SELECT
      cd.NombreArticulo AS articulo,
      cd.Subtotal       AS subtotal,
      cd.EstadoItem     AS estadoItem
    FROM modu_rest_ComandaDetalle cd
    WHERE cd.DetalleID = @detalleID AND cd.PedidoID = @pedidoID
  `, (req) => {
    req.input('detalleID', sql.UniqueIdentifier, detalleID);
    req.input('pedidoID',  sql.UniqueIdentifier, pedidoID);
  });

  if (itemRows.length === 0)
    throw new AppError('El artículo no pertenece a este pedido', 404);

  const item = itemRows[0];

  if (item.estadoItem === 'Cancelado')
    throw new AppError('Este artículo ya estaba cancelado', 409);

  // 3. No dejar el total por debajo de lo ya cobrado
  const pagos = await query<{ pagado: number }>(`
    SELECT ISNULL(SUM(pa.MontoPagado - pa.Vuelto), 0) AS pagado
    FROM modu_rest_Pagos pa
    WHERE pa.PedidoID = @pedidoID AND pa.Anulado = 0
  `, (req) => {
    req.input('pedidoID', sql.UniqueIdentifier, pedidoID);
  });

  const yaPagado  = pagos[0].pagado;
  const nuevoTotal = pedidoActual.totalCuenta - item.subtotal;

  if (nuevoTotal < yaPagado) {
    throw new AppError(
      `No se puede quitar este artículo: el pedido quedaría en ` +
      `$${nuevoTotal.toLocaleString()} y ya se han cobrado ` +
      `$${yaPagado.toLocaleString()}. Anula primero el pago.`,
      409);
  }

  // 4. Marcar como cancelado dejando el rastro
  await query(`
    UPDATE modu_rest_ComandaDetalle SET
      EstadoItem        = 'Cancelado',
      MotivoCancelacion = @motivo,
      CanceladoPor      = @usuarioID,
      FechaCancelacion  = SYSUTCDATETIME()
    WHERE DetalleID = @detalleID
  `, (req) => {
    req.input('detalleID', sql.UniqueIdentifier, detalleID);
    req.input('usuarioID', sql.UniqueIdentifier, usuarioID);
    req.input('motivo',    sql.NVarChar,         motivo);
  });

  // 5. Recalcular el total del pedido
  await recalcularTotales(pedidoID);

  // 6. Cuántos artículos quedan vigentes
  const restantes = await query<{ total: number }>(`
    SELECT COUNT(*) AS total
    FROM modu_rest_ComandaDetalle
    WHERE PedidoID = @pedidoID AND EstadoItem <> 'Cancelado'
  `, (req) => {
    req.input('pedidoID', sql.UniqueIdentifier, pedidoID);
  });

  const pedido = await obtenerPedido(pedidoID);

  return {
    pedido,
    articulo:       item.articulo,
    montoRetirado:  item.subtotal,
    itemsRestantes: restantes[0].total,
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

  // 1. El pedido debe ser modificable
  const pedidoRows = await query<{ estadoPedido: string; totalCuenta: number }>(`
    SELECT EstadoPedido AS estadoPedido, TotalCuenta AS totalCuenta
    FROM modu_rest_Pedidos WHERE PedidoID = @pedidoID
  `, (req) => {
    req.input('pedidoID', sql.UniqueIdentifier, pedidoID);
  });

  if (pedidoRows.length === 0) throw new AppError('Pedido no encontrado', 404);

  if (!ESTADOS_EDITABLES.includes(pedidoRows[0].estadoPedido))
    throw new AppError(
      `No se puede modificar un pedido en estado ${pedidoRows[0].estadoPedido}`, 409);

  // 2. El artículo debe existir y estar vigente
  const itemRows = await query<{
    articulo: string; cantidad: number;
    precio: number; subtotal: number; estadoItem: string;
  }>(`
    SELECT
      cd.NombreArticulo       AS articulo,
      cd.Cantidad             AS cantidad,
      cd.PrecioVentaHistorico AS precio,
      cd.Subtotal             AS subtotal,
      cd.EstadoItem           AS estadoItem
    FROM modu_rest_ComandaDetalle cd
    WHERE cd.DetalleID = @detalleID AND cd.PedidoID = @pedidoID
  `, (req) => {
    req.input('detalleID', sql.UniqueIdentifier, detalleID);
    req.input('pedidoID',  sql.UniqueIdentifier, pedidoID);
  });

  if (itemRows.length === 0)
    throw new AppError('El artículo no pertenece a este pedido', 404);

  const item = itemRows[0];

  if (item.estadoItem === 'Cancelado')
    throw new AppError('Este artículo está cancelado', 409);

  // 3. No dejar el total por debajo de lo ya cobrado
  const nuevoSubtotal = item.precio * cantidad;
  const nuevoTotal =
    pedidoRows[0].totalCuenta - item.subtotal + nuevoSubtotal;

  const pagos = await query<{ pagado: number }>(`
    SELECT ISNULL(SUM(pa.MontoPagado - pa.Vuelto), 0) AS pagado
    FROM modu_rest_Pagos pa
    WHERE pa.PedidoID = @pedidoID AND pa.Anulado = 0
  `, (req) => {
    req.input('pedidoID', sql.UniqueIdentifier, pedidoID);
  });

  if (nuevoTotal < pagos[0].pagado) {
    throw new AppError(
      `No se puede reducir tanto: el pedido quedaría en ` +
      `$${nuevoTotal.toLocaleString()} y ya se cobraron ` +
      `$${pagos[0].pagado.toLocaleString()}.`,
      409);
  }

  // 4. Actualizar la línea
  await query(`
    UPDATE modu_rest_ComandaDetalle SET
      Cantidad = @cantidad,
      Subtotal = @subtotal
    WHERE DetalleID = @detalleID
  `, (req) => {
    req.input('detalleID', sql.UniqueIdentifier, detalleID);
    req.input('cantidad',  sql.Decimal(10, 2),   cantidad);
    req.input('subtotal',  sql.Decimal(18, 2),   nuevoSubtotal);
  });

  await recalcularTotales(pedidoID);

  return {
    pedido: await obtenerPedido(pedidoID),
    articulo: item.articulo,
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

  await query(`
    UPDATE modu_rest_Pedidos
    SET EstadoPedido = 'Cancelado', FechaCierre = SYSUTCDATETIME()
    WHERE PedidoID = @pedidoID
  `, (req) => {
    req.input('pedidoID', sql.UniqueIdentifier, pedidoID);
  });

  await query(`
    UPDATE modu_rest_Comandas
    SET Estado = 'Cancelada'
    WHERE PedidoID = @pedidoID AND Estado NOT IN ('Lista', 'Cancelada')
  `, (req) => {
    req.input('pedidoID', sql.UniqueIdentifier, pedidoID);
  });

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