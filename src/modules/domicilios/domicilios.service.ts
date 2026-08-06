// src/modules/domicilios/domicilios.service.ts
//
// Un domicilio en KROCO se anota en papel durante el día y se carga
// al sistema en la noche, uno por uno, ya resuelto: se sabe qué se
// pidió, quién lo llevó y cómo se pagó.
//
// Por eso NO pasa por el flujo normal de pedidos/pagos:
//
//   · No exige turno abierto. El dinero de un domicilio de las 2pm
//     ya se movió, se gastó o se entregó al dueño horas antes de que
//     el cajero lo capture a las 10pm. Forzarlo dentro del turno de
//     la noche ensuciaría un arqueo que nunca tuvo ese efectivo.
//
//   · Nace directamente en estado 'Pagado', con FechaApertura y
//     FechaCierre iguales a la hora real que el cliente anotó en la
//     hoja — no a la hora de captura. Sin esto, "Movimiento por hora"
//     en Informes mostraría todos los domicilios a las 10pm.
//
//   · El pago se registra con TurnoID = NULL a propósito: no
//     pertenece a ningún arqueo de caja. Solo cuenta en los informes
//     de ventas, nunca en "cuánto hay en el cajón ahora mismo".
//
// Reutiliza ComandaDetalle para los artículos y Pagos para el método,
// así que el buscador de pedidos, el detalle completo y el informe
// de productos más vendidos lo muestran sin ningún cambio.
//
// Diseñado para que un futuro modo "domicilio en tiempo real" (con
// estados de despacho) se pueda agregar sin migrar esta tabla: el
// pedido ya puede nacer en 'Abierto' si algún día hace falta — hoy
// simplemente no se usa esa rama.

import { query, sql } from '../../config/database';
import { AppError } from '../../middlewares/error.middleware';
import { registrarEvento } from '../../shared/eventos.service';
import { obtenerPrecioArticulo } from '../pedidos/pedidos.service';
import { marcarUltimoPedido } from '../clientes/clientes.service';

// ── Interfaces ───────────────────────────────────────

export interface ItemDomicilio {
  articuloID: number;
  cantidad: number;
  notasEspeciales?: string;
}

export interface CrearDomicilioDTO {
  clienteID: string;
  domiciliarioID: string;
  metodoID: string;
  direccionEntrega?: string;   // si no viene, se usa la del cliente
  fechaPedido?: string;        // ISO. Si no viene, se usa "ahora"
  notasGenerales?: string;
  items: ItemDomicilio[];
}

export interface Domicilio {
  pedidoID: string;
  numeroPedido: number;
  clienteID: string;
  clienteNombre: string;
  clienteCelular: string;
  direccionEntrega: string | null;
  domiciliarioID: string;
  domiciliario: string;
  metodoNombre: string;
  fechaApertura: string;
  totalCuenta: number;
}

const ESTADOS_VENTA = `('Pagado', 'Fiado')`;

async function siguienteNumeroPedido(fecha: Date): Promise<number> {
  const rows = await query<{ siguiente: number }>(`
    SELECT ISNULL(MAX(NumeroPedido), 0) + 1 AS siguiente
    FROM modu_rest_Pedidos
    WHERE CAST(FechaApertura AS DATE) = CAST(@fecha AS DATE)
  `, (req) => {
    req.input('fecha', sql.DateTime2, fecha);
  });
  return rows[0].siguiente;
}

// ── Crear domicilio ────────────────────────────────────

export async function crearDomicilio(
  cajeroID: string,
  data: CrearDomicilioDTO
): Promise<Domicilio> {

  if (!data.items || data.items.length === 0)
    throw new AppError('Debes agregar al menos un artículo', 400);

  // 1. Cliente
  const clienteRows = await query<{
    nombre: string; celular: string; direccion: string | null;
  }>(`
    SELECT Nombre AS nombre, Celular AS celular, Direccion AS direccion
    FROM modu_rest_Clientes WHERE ClienteID = @clienteID AND Activo = 1
  `, (req) => {
    req.input('clienteID', sql.UniqueIdentifier, data.clienteID);
  });

  if (clienteRows.length === 0)
    throw new AppError('Cliente no encontrado', 404);

  const cliente = clienteRows[0];
  const direccion = data.direccionEntrega?.trim() || cliente.direccion;

  if (!direccion)
    throw new AppError(
      'Este cliente no tiene dirección guardada. Escribe la dirección de entrega.',
      400);

  // 2. Domiciliario — debe tener el rol correspondiente
  const domRows = await query<{ nombre: string; activo: boolean }>(`
    SELECT u.Nombre + ' ' + u.Apellido AS nombre, u.Activo AS activo
    FROM modu_rest_Usuarios u
    JOIN modu_rest_Roles r ON u.RolID = r.RolID
    WHERE u.UsuarioID = @domiciliarioID AND r.Nombre = 'Domiciliario'
  `, (req) => {
    req.input('domiciliarioID', sql.UniqueIdentifier, data.domiciliarioID);
  });

  if (domRows.length === 0)
    throw new AppError('El domiciliario no existe o no tiene ese rol', 404);

  if (!domRows[0].activo)
    throw new AppError('Este domiciliario está inactivo', 409);

  // 3. Método de pago — cualquiera menos Crédito. Un domicilio ya
  //    resuelto no puede quedar fiado: si no pagó, no se captura
  //    todavía, se espera a que se sepa cómo se resolvió.
  const metodoRows = await query<{ nombre: string; tipo: string }>(`
    SELECT Nombre AS nombre, Tipo AS tipo
    FROM modu_rest_MetodosPago WHERE MetodoID = @metodoID AND Activo = 1
  `, (req) => {
    req.input('metodoID', sql.UniqueIdentifier, data.metodoID);
  });

  if (metodoRows.length === 0)
    throw new AppError('Método de pago no encontrado', 404);

  if (metodoRows[0].tipo === 'Credito')
    throw new AppError(
      'Un domicilio no puede quedar fiado en esta captura. ' +
      'Regístralo cuando se sepa cómo se pagó.',
      400);

  // 4. Fecha real del pedido — la que el cliente anotó en la hoja.
  //    Si no la especifican, se usa el momento de la captura.
  const fechaPedido = data.fechaPedido
    ? new Date(data.fechaPedido)
    : new Date();

  if (isNaN(fechaPedido.getTime()))
    throw new AppError('La fecha del pedido no es válida', 400);

  if (fechaPedido.getTime() > Date.now() + 5 * 60 * 1000)
    throw new AppError('La fecha del pedido no puede ser futura', 400);

  // 5. Precios — mismo motor que usa una mesa, para no cobrar distinto
  let subtotal = 0;
  const itemsConPrecio = await Promise.all(
    data.items.map(async (item) => {
      const art = await obtenerPrecioArticulo(item.articuloID);
      const itemSubtotal = art.precioVenta * item.cantidad;
      subtotal += itemSubtotal;
      return { ...item, ...art, itemSubtotal };
    })
  );

  const totalCuenta = subtotal;
  const numeroPedido = await siguienteNumeroPedido(fechaPedido);

  // 6. Insertar el pedido — nace y muere en el mismo instante.
  //    Sin MesaID, sin MeseroID real: el cajero que lo captura queda
  //    como responsable administrativo, pero el pedido no aparece en
  //    su informe de meseros porque ese informe filtra por rol Mesero.
  const pedidoRows = await query<{ PedidoID: string }>(`
    INSERT INTO modu_rest_Pedidos (
      MesaID, MeseroID, NumeroPedido, TipoPedido,
      NombreCliente, NumeroPersonas, EstadoPedido,
      Subtotal, TotalImpuestos, TotalDescuento, TotalCuenta,
      NotasGenerales, ClienteID, DomiciliarioID, DireccionEntrega,
      FechaApertura, FechaCierre
    )
    OUTPUT INSERTED.PedidoID
    VALUES (
      NULL, @cajeroID, @numeroPedido, 'Domicilio',
      @nombreCliente, 1, 'Pagado',
      @subtotal, 0, 0, @totalCuenta,
      @notasGenerales, @clienteID, @domiciliarioID, @direccion,
      @fechaPedido, @fechaPedido
    )
  `, (req) => {
    req.input('cajeroID',       sql.UniqueIdentifier, cajeroID);
    req.input('numeroPedido',   sql.Int,              numeroPedido);
    req.input('nombreCliente',  sql.NVarChar,         cliente.nombre);
    req.input('subtotal',       sql.Decimal(18, 2),   subtotal);
    req.input('totalCuenta',    sql.Decimal(18, 2),   totalCuenta);
    req.input('notasGenerales', sql.NVarChar,         data.notasGenerales ?? null);
    req.input('clienteID',      sql.UniqueIdentifier, data.clienteID);
    req.input('domiciliarioID', sql.UniqueIdentifier, data.domiciliarioID);
    req.input('direccion',      sql.NVarChar,         direccion);
    req.input('fechaPedido',    sql.DateTime2,        fechaPedido);
  });

  const pedidoID = pedidoRows[0].PedidoID;

  // 7. Comanda y detalle — nace despachada: no hay entrega en mesa
  //    que confirmar, el domicilio ya se entregó cuando se anotó.
  const comandaRows = await query<{ ComandaID: string }>(`
    INSERT INTO modu_rest_Comandas (
      PedidoID, NumeroRonda, Estado, HoraEnviada, HoraDespachada
    )
    OUTPUT INSERTED.ComandaID
    VALUES (@pedidoID, 1, 'Despachada', @fechaPedido, @fechaPedido)
  `, (req) => {
    req.input('pedidoID',    sql.UniqueIdentifier, pedidoID);
    req.input('fechaPedido', sql.DateTime2,        fechaPedido);
  });

  const comandaID = comandaRows[0].ComandaID;

  for (const item of itemsConPrecio) {
    await query(`
      INSERT INTO modu_rest_ComandaDetalle (
        ComandaID, PedidoID, IdArticulo, NombreArticulo,
        Cantidad, PrecioVentaHistorico,
        PorcentajeIVA, MontoIVA, MontoDescuento,
        Subtotal, EstadoItem, NotasEspeciales, HoraPedido
      )
      VALUES (
        @comandaID, @pedidoID, @articuloID, @nombreArticulo,
        @cantidad, @precioVenta,
        0, 0, 0,
        @subtotal, 'Entregado', @notasEspeciales, @fechaPedido
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
      req.input('fechaPedido',     sql.DateTime2,        fechaPedido);
    });
  }

  // 8. Pago — TurnoID NULL a propósito. Este dinero no pertenece a
  //    ningún arqueo: no se puede reconstruir en qué cajón físico
  //    estuvo hace ocho horas.
  await query(`
    INSERT INTO modu_rest_Pagos (
      PedidoID, MetodoID, CajeroID, TurnoID,
      MontoPagado, MontoEsperado, Vuelto, Propina,
      MetadataPago, FechaTransaccion
    )
    VALUES (
      @pedidoID, @metodoID, @cajeroID, NULL,
      @totalCuenta, @totalCuenta, 0, 0,
      @metadataPago, @fechaPedido
    )
  `, (req) => {
    req.input('pedidoID',     sql.UniqueIdentifier, pedidoID);
    req.input('metodoID',     sql.UniqueIdentifier, data.metodoID);
    req.input('cajeroID',     sql.UniqueIdentifier, cajeroID);
    req.input('totalCuenta',  sql.Decimal(18, 2),   totalCuenta);
    req.input('metadataPago', sql.NVarChar, JSON.stringify({
      tipoPedido: 'Domicilio',
      clienteID: data.clienteID,
      capturadoEn: new Date().toISOString(),
    }));
    req.input('fechaPedido',  sql.DateTime2, fechaPedido);
  });

  // 9. Última vez que este cliente pidió — para ordenar la búsqueda
  await marcarUltimoPedido(data.clienteID);

  // 10. Evento — no es MESA_ABIERTA porque no hay mesa. Se reporta
  //     directo como venta cerrada para que los paneles que escuchan
  //     PAGO_RECIBIDO se enteren igual.
  await registrarEvento({
    tipo:        'PAGO_RECIBIDO',
    entidadTipo: 'Pedido',
    entidadID:   pedidoID,
    usuarioID:   cajeroID,
    payload: {
      pedidoID,
      numeroPedido,
      tipoPedido: 'Domicilio',
      cliente: cliente.nombre,
      totalCuenta,
      montoPagado: totalCuenta,
      metodo: metodoRows[0].nombre,
      capturaNocturna: true,
    },
  });

  return {
    pedidoID,
    numeroPedido,
    clienteID: data.clienteID,
    clienteNombre: cliente.nombre,
    clienteCelular: cliente.celular,
    direccionEntrega: direccion,
    domiciliarioID: data.domiciliarioID,
    domiciliario: domRows[0].nombre,
    metodoNombre: metodoRows[0].nombre,
    fechaApertura: fechaPedido.toISOString(),
    totalCuenta,
  };
}

// ── Listar domicilios ──────────────────────────────────

export async function listarDomicilios(filtros: {
  desde: string;
  hasta: string;
  clienteID?: string;
}) {
  return query(`
    SELECT
      p.PedidoID         AS pedidoID,
      p.NumeroPedido     AS numeroPedido,
      p.NombreCliente    AS clienteNombre,
      c.Celular          AS clienteCelular,
      p.DireccionEntrega AS direccionEntrega,
      ISNULL(d.Nombre + ' ' + d.Apellido, '—') AS domiciliario,
      STUFF((
        SELECT DISTINCT ', ' + mp2.Nombre
        FROM modu_rest_Pagos pa2
        JOIN modu_rest_MetodosPago mp2 ON pa2.MetodoID = mp2.MetodoID
        WHERE pa2.PedidoID = p.PedidoID AND pa2.Anulado = 0
        FOR XML PATH('')), 1, 2, '')          AS metodos,
      p.FechaApertura    AS fechaApertura,
      p.TotalCuenta      AS totalCuenta,
      p.EstadoPedido     AS estadoPedido
    FROM modu_rest_Pedidos p
    LEFT JOIN modu_rest_Clientes c ON p.ClienteID      = c.ClienteID
    LEFT JOIN modu_rest_Usuarios d ON p.DomiciliarioID = d.UsuarioID
    WHERE p.TipoPedido = 'Domicilio'
      AND CAST(p.FechaApertura AS DATE) BETWEEN @desde AND @hasta
      AND (@clienteID IS NULL OR p.ClienteID = @clienteID)
    ORDER BY p.FechaApertura DESC
  `, (req) => {
    req.input('desde',     sql.Date,             filtros.desde);
    req.input('hasta',     sql.Date,             filtros.hasta);
    req.input('clienteID', sql.UniqueIdentifier, filtros.clienteID ?? null);
  });
}

// ── Historial de un cliente ────────────────────────────

export async function historialCliente(clienteID: string) {
  return query(`
    SELECT
      p.PedidoID       AS pedidoID,
      p.NumeroPedido   AS numeroPedido,
      p.DireccionEntrega AS direccionEntrega,
      p.FechaApertura  AS fechaApertura,
      p.TotalCuenta    AS totalCuenta,
      ISNULL(d.Nombre + ' ' + d.Apellido, '—') AS domiciliario
    FROM modu_rest_Pedidos p
    LEFT JOIN modu_rest_Usuarios d ON p.DomiciliarioID = d.UsuarioID
    WHERE p.ClienteID = @clienteID AND p.TipoPedido = 'Domicilio'
    ORDER BY p.FechaApertura DESC
  `, (req) => {
    req.input('clienteID', sql.UniqueIdentifier, clienteID);
  });
}

// ── Resumen para informes ──────────────────────────────
// Cuánto entró por domicilios y por qué método, en un rango de
// fechas. Es lo que va a alimentar la pastilla nueva de Informes.

export async function resumenDomicilios(filtros: {
  desde: string;
  hasta: string;
}) {
  const [totales, metodos] = await Promise.all([
    query<{ pedidos: number; total: number; clientes: number }>(`
      SELECT
        COUNT(*)                        AS pedidos,
        ISNULL(SUM(p.TotalCuenta), 0)   AS total,
        COUNT(DISTINCT p.ClienteID)     AS clientes
      FROM modu_rest_Pedidos p
      WHERE p.TipoPedido = 'Domicilio'
        AND p.EstadoPedido IN ${ESTADOS_VENTA}
        AND CAST(p.FechaApertura AS DATE) BETWEEN @desde AND @hasta
    `, (req) => {
      req.input('desde', sql.Date, filtros.desde);
      req.input('hasta', sql.Date, filtros.hasta);
    }),

    query<{ metodo: string; tipo: string; transacciones: number; total: number }>(`
      SELECT
        mp.Nombre         AS metodo,
        mp.Tipo           AS tipo,
        COUNT(*)          AS transacciones,
        SUM(pa.MontoPagado) AS total
      FROM modu_rest_Pagos pa
      JOIN modu_rest_Pedidos     p  ON pa.PedidoID = p.PedidoID
      JOIN modu_rest_MetodosPago mp ON pa.MetodoID = mp.MetodoID
      WHERE p.TipoPedido = 'Domicilio'
        AND pa.Anulado = 0
        AND CAST(p.FechaApertura AS DATE) BETWEEN @desde AND @hasta
      GROUP BY mp.Nombre, mp.Tipo
      ORDER BY total DESC
    `, (req) => {
      req.input('desde', sql.Date, filtros.desde);
      req.input('hasta', sql.Date, filtros.hasta);
    }),
  ]);

  return { ...totales[0], metodos };
}