// src/modules/pedidos/pedidos.service.ts

import { query, sql } from '../../config/database';
import { AppError } from '../../middlewares/error.middleware';
import { registrarEvento } from '../../shared/eventos.service';
import { cambiarEstadoMesa } from '../mesas/mesas.service';

// ── Interfaces ───────────────────────────────────────

export interface Pedido {
  pedidoID: string;
  mesaID: string | null;
  mesaAlias: string | null;
  meseroID: string;
  mesero: string;
  numeroPedido: number;
  tipoPedido: string;
  nombreCliente: string | null;
  numeroPersonas: number;
  fechaApertura: string;
  fechaCierre: string | null;
  estadoPedido: string;
  subtotal: number;
  totalImpuestos: number;
  totalDescuento: number;
  totalCuenta: number;
  notasGenerales: string | null;
  facturado: boolean;
}

export interface ItemPedido {
  articuloID: number;       // INT — Id del sistema existente
  cantidad: number;
  notasEspeciales?: string;
}

export interface AbrirPedidoDTO {
  mesaID?: string;
  tipoPedido?: 'Mesa' | 'Para Llevar' | 'Domicilio';
  nombreCliente?: string;
  numeroPersonas?: number;
  notasGenerales?: string;
  items: ItemPedido[];
}

// ── Helpers ──────────────────────────────────────────

async function siguienteNumeroPedido(): Promise<number> {
  const rows = await query<{ siguiente: number }>(`
    SELECT ISNULL(MAX(NumeroPedido), 0) + 1 AS siguiente
    FROM modu_rest_Pedidos
    WHERE CAST(FechaApertura AS DATE) = CAST(SYSUTCDATETIME() AS DATE)
  `);
  return rows[0].siguiente;
}

// Obtiene precio vigente de la tabla articulo del sistema existente
async function obtenerPrecioArticulo(articuloID: number): Promise<{
  nombre: string;
  precioVenta: number;
  porcentajeIVA: number;
}> {
  const rows = await query<{
    nombre: string;
    precioVenta: number;
    porcentajeIVA: number;
  }>(`
    SELECT
      a.Nombre                    AS nombre,
      a.Venta                     AS precioVenta,
      ISNULL(t.Num, 0)            AS porcentajeIVA
    FROM articulo a
    LEFT JOIN tarifas t ON a.Idiva = t.Id
    WHERE a.Id = @articuloID AND a.Estado = 1
  `, (req) => {
    req.input('articuloID', sql.Int, articuloID);
  });

  if (rows.length === 0) {
    throw new AppError(`El artículo ${articuloID} no existe o está inactivo`, 400);
  }
  return rows[0];
}

// ── Obtener pedido ───────────────────────────────────

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

// ── Detalle del pedido ───────────────────────────────

export async function obtenerDetallePedido(pedidoID: string) {
  return query(`
    SELECT
      cd.DetalleID              AS detalleID,
      cd.IdArticulo             AS articuloID,
      cd.NombreArticulo         AS articulo,
      cd.Cantidad               AS cantidad,
      cd.PrecioVentaHistorico   AS precioUnitario,
      cd.PorcentajeIVA          AS porcentajeIVA,
      cd.MontoIVA               AS montoIVA,
      cd.MontoDescuento         AS montoDescuento,
      cd.Subtotal               AS subtotal,
      cd.EstadoItem             AS estadoItem,
      cd.NotasEspeciales        AS notasEspeciales,
      cd.HoraPedido             AS horaPedido
    FROM modu_rest_ComandaDetalle cd
    WHERE cd.PedidoID = @pedidoID
    ORDER BY cd.HoraPedido
  `, (req) => {
    req.input('pedidoID', sql.UniqueIdentifier, pedidoID);
  });
}

// ── Listar pedidos ───────────────────────────────────

export async function listarPedidos(filtros: {
  estado?: string;
  mesaID?: string;
  fecha?: string;
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

// ── Abrir pedido ─────────────────────────────────────

export async function abrirPedido(
  meseroID: string,
  data: AbrirPedidoDTO
): Promise<Pedido> {

  // 1. Verificar que la mesa esté libre si viene con mesa
  if (data.mesaID) {
    const mesaOcupada = await query<{ total: number }>(`
      SELECT COUNT(*) AS total
      FROM modu_rest_Pedidos
      WHERE MesaID = @mesaID
        AND EstadoPedido IN ('Abierto', 'Por Pagar')
    `, (req) => {
      req.input('mesaID', sql.UniqueIdentifier, data.mesaID!);
    });

    if (mesaOcupada[0].total > 0) {
      throw new AppError('Esta mesa ya tiene un pedido activo', 409);
    }
  }

  // 2. Calcular totales leyendo precios de la tabla articulo
  let subtotal = 0;
  let totalImpuestos = 0;

  const itemsConPrecio = await Promise.all(
    data.items.map(async (item) => {
      const art = await obtenerPrecioArticulo(item.articuloID);
      const montoIVA    = art.precioVenta * item.cantidad * (art.porcentajeIVA / 100);
      const itemSubtotal = art.precioVenta * item.cantidad;

      subtotal       += itemSubtotal;
      totalImpuestos += montoIVA;

      return { ...item, ...art, montoIVA, itemSubtotal };
    })
  );

  const totalCuenta  = subtotal + totalImpuestos;
  const numeroPedido = await siguienteNumeroPedido();

  // 3. Crear el pedido
  const pedidoRows = await query<{ PedidoID: string }>(`
    INSERT INTO modu_rest_Pedidos (
      MesaID, MeseroID, NumeroPedido, TipoPedido,
      NombreCliente, NumeroPersonas, EstadoPedido,
      Subtotal, TotalImpuestos, TotalCuenta,
      NotasGenerales, MesaAlias
    )
    OUTPUT INSERTED.PedidoID
    VALUES (
      @mesaID, @meseroID, @numeroPedido, @tipoPedido,
      @nombreCliente, @numeroPersonas, 'Abierto',
      @subtotal, @totalImpuestos, @totalCuenta,
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
    req.input('totalImpuestos', sql.Decimal(18, 2),   totalImpuestos);
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

  // 5. Insertar ítems en ComandaDetalle
  for (const item of itemsConPrecio) {
    await query(`
      INSERT INTO modu_rest_ComandaDetalle (
        ComandaID, PedidoID, IdArticulo, NombreArticulo,
        Cantidad, PrecioVentaHistorico, PorcentajeIVA,
        MontoIVA, Subtotal, EstadoItem, NotasEspeciales
      )
      VALUES (
        @comandaID, @pedidoID, @articuloID, @nombreArticulo,
        @cantidad, @precioVenta, @porcentajeIVA,
        @montoIVA, @subtotal, 'Pendiente', @notasEspeciales
      )
    `, (req) => {
      req.input('comandaID',      sql.UniqueIdentifier, comandaID);
      req.input('pedidoID',       sql.UniqueIdentifier, pedidoID);
      req.input('articuloID',     sql.Int,              item.articuloID);
      req.input('nombreArticulo', sql.NVarChar,         item.nombre);
      req.input('cantidad',       sql.Decimal(10, 2),   item.cantidad);
      req.input('precioVenta',    sql.Decimal(18, 2),   item.precioVenta);
      req.input('porcentajeIVA',  sql.Decimal(5, 2),    item.porcentajeIVA);
      req.input('montoIVA',       sql.Decimal(18, 2),   item.montoIVA);
      req.input('subtotal',       sql.Decimal(18, 2),   item.itemSubtotal);
      req.input('notasEspeciales',sql.NVarChar,         item.notasEspeciales ?? null);
    });
  }

  // 6. Cambiar estado de la mesa a Ocupada
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

// ── Agregar ronda ────────────────────────────────────

export async function agregarRonda(
  pedidoID: string,
  meseroID: string,
  items: ItemPedido[]
): Promise<{ pedido: Pedido; comandaID: string; numeroRonda: number }> {

  const pedido = await obtenerPedido(pedidoID);

  if (pedido.estadoPedido !== 'Abierto') {
    throw new AppError('No se pueden agregar ítems a un pedido que no está abierto', 409);
  }

  const rondasRows = await query<{ totalRondas: number }>(`
    SELECT COUNT(*) AS totalRondas
    FROM modu_rest_Comandas
    WHERE PedidoID = @pedidoID
  `, (req) => {
    req.input('pedidoID', sql.UniqueIdentifier, pedidoID);
  });

  const numeroRonda = rondasRows[0].totalRondas + 1;

  let subtotalNuevo = 0;
  let impuestosNuevo = 0;

  const itemsConPrecio = await Promise.all(
    items.map(async (item) => {
      const art = await obtenerPrecioArticulo(item.articuloID);
      const montoIVA     = art.precioVenta * item.cantidad * (art.porcentajeIVA / 100);
      const itemSubtotal = art.precioVenta * item.cantidad;

      subtotalNuevo  += itemSubtotal;
      impuestosNuevo += montoIVA;

      return { ...item, ...art, montoIVA, itemSubtotal };
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
        Cantidad, PrecioVentaHistorico, PorcentajeIVA,
        MontoIVA, Subtotal, EstadoItem, NotasEspeciales
      )
      VALUES (
        @comandaID, @pedidoID, @articuloID, @nombreArticulo,
        @cantidad, @precioVenta, @porcentajeIVA,
        @montoIVA, @subtotal, 'Pendiente', @notasEspeciales
      )
    `, (req) => {
      req.input('comandaID',      sql.UniqueIdentifier, comandaID);
      req.input('pedidoID',       sql.UniqueIdentifier, pedidoID);
      req.input('articuloID',     sql.Int,              item.articuloID);
      req.input('nombreArticulo', sql.NVarChar,         item.nombre);
      req.input('cantidad',       sql.Decimal(10, 2),   item.cantidad);
      req.input('precioVenta',    sql.Decimal(18, 2),   item.precioVenta);
      req.input('porcentajeIVA',  sql.Decimal(5, 2),    item.porcentajeIVA);
      req.input('montoIVA',       sql.Decimal(18, 2),   item.montoIVA);
      req.input('subtotal',       sql.Decimal(18, 2),   item.itemSubtotal);
      req.input('notasEspeciales',sql.NVarChar,         item.notasEspeciales ?? null);
    });
  }

  // Actualizar totales del pedido
  await query(`
    UPDATE modu_rest_Pedidos SET
      Subtotal       = Subtotal       + @subtotalNuevo,
      TotalImpuestos = TotalImpuestos + @impuestosNuevo,
      TotalCuenta    = TotalCuenta    + @subtotalNuevo + @impuestosNuevo
    WHERE PedidoID = @pedidoID
  `, (req) => {
    req.input('pedidoID',       sql.UniqueIdentifier, pedidoID);
    req.input('subtotalNuevo',  sql.Decimal(18, 2),   subtotalNuevo);
    req.input('impuestosNuevo', sql.Decimal(18, 2),   impuestosNuevo);
  });

  const pedidoActualizado = await obtenerPedido(pedidoID);

  return { pedido: pedidoActualizado, comandaID, numeroRonda };
}

// ── Solicitar cuenta ─────────────────────────────────

export async function solicitarCuenta(
  pedidoID: string,
  meseroID: string
): Promise<Pedido> {
  const pedido = await obtenerPedido(pedidoID);

  if (pedido.estadoPedido !== 'Abierto') {
    throw new AppError('El pedido no está en estado Abierto', 409);
  }

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

// ── Cancelar pedido ──────────────────────────────────

export async function cancelarPedido(
  pedidoID: string,
  usuarioID: string
): Promise<void> {
  const pedido = await obtenerPedido(pedidoID);

  if (pedido.estadoPedido === 'Pagado') {
    throw new AppError('No se puede cancelar un pedido ya pagado', 409);
  }

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
    payload:     {
      pedidoID,
      motivo:          'Cancelado',
      mesaAlias:       pedido.mesaAlias,
      nuevoEstadoMesa: 'Libre',
    },
  });
}