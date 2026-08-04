// src/modules/comandas/comandas.service.ts
//
// Este módulo quedó a medias cuando se quitó el KDS: el controller
// importaba funciones que el service ya no exportaba. Aquí queda
// alineado con el flujo real del restaurante:
//
//   El mesero toma el pedido  → comanda Pendiente
//   El mesero entrega en mesa → comanda Despachada
//
// La cocina no participa: el pedido se pide de viva voz. Por eso
// no hay estados Vista / En Preparación / Lista.

import { query, sql } from '../../config/database';
import { AppError } from '../../middlewares/error.middleware';
import { registrarEvento } from '../../shared/eventos.service';

// Minutos desde que se tomó el pedido para considerarlo demorado.
// Es solo una señal visual: no bloquea nada.
export const UMBRAL_DEMORA = 20;

// ── Interfaces ───────────────────────────────────────

export interface Comanda {
  comandaID: string;
  pedidoID: string;
  numeroPedido: number;
  mesaAlias: string | null;
  zonaNombre: string | null;
  numeroRonda: number;
  estado: string;
  horaEnviada: string;
  horaDespachada: string | null;
  despachadaPor: string | null;
  notasCocina: string | null;
  minutosDesdeEnvio: number;
  minutosEnEntregar: number | null;
  entregada: boolean;
  demorada: boolean;
}

export interface ComandaDetalle {
  detalleID: string;
  articuloID: number;
  articulo: string;
  cantidad: number;
  estadoItem: string;
  notasEspeciales: string | null;
  horaPedido: string;
}

// ── SQL compartido ───────────────────────────────────

const CAMPOS_COMANDA = `
  c.ComandaID      AS comandaID,
  c.PedidoID       AS pedidoID,
  p.NumeroPedido   AS numeroPedido,
  m.Alias          AS mesaAlias,
  z.Nombre         AS zonaNombre,
  c.NumeroRonda    AS numeroRonda,
  c.Estado         AS estado,
  c.HoraEnviada    AS horaEnviada,
  c.HoraDespachada AS horaDespachada,
  u.Nombre + ' ' + u.Apellido AS despachadaPor,
  c.NotasCocina    AS notasCocina,
  DATEDIFF(MINUTE, c.HoraEnviada, SYSUTCDATETIME()) AS minutosDesdeEnvio,
  CASE WHEN c.HoraDespachada IS NOT NULL
       THEN DATEDIFF(MINUTE, c.HoraEnviada, c.HoraDespachada)
       ELSE NULL END                                AS minutosEnEntregar,
  CASE WHEN c.Estado = 'Despachada'
       THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END  AS entregada,
  CASE WHEN c.Estado <> 'Despachada'
        AND DATEDIFF(MINUTE, c.HoraEnviada, SYSUTCDATETIME()) >= ${UMBRAL_DEMORA}
       THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END  AS demorada
`;

const JOIN_COMANDA = `
  FROM modu_rest_Comandas c
  JOIN modu_rest_Pedidos      p ON c.PedidoID       = p.PedidoID
  LEFT JOIN modu_rest_Mesas    m ON p.MesaID        = m.MesaID
  LEFT JOIN modu_rest_Zonas    z ON m.ZonaID        = z.ZonaID
  LEFT JOIN modu_rest_Usuarios u ON c.DespachadaPor = u.UsuarioID
`;

// ── Consultas ────────────────────────────────────────

export async function obtenerComanda(comandaID: string): Promise<Comanda> {
  const rows = await query<Comanda>(`
    SELECT ${CAMPOS_COMANDA}
    ${JOIN_COMANDA}
    WHERE c.ComandaID = @comandaID
  `, (req) => {
    req.input('comandaID', sql.UniqueIdentifier, comandaID);
  });

  if (rows.length === 0) throw new AppError('Comanda no encontrada', 404);
  return rows[0];
}

export async function historialComandasPedido(
  pedidoID: string
): Promise<Comanda[]> {
  return query<Comanda>(`
    SELECT ${CAMPOS_COMANDA}
    ${JOIN_COMANDA}
    WHERE c.PedidoID = @pedidoID
    ORDER BY c.NumeroRonda ASC
  `, (req) => {
    req.input('pedidoID', sql.UniqueIdentifier, pedidoID);
  });
}

export async function obtenerItemsComanda(
  comandaID: string
): Promise<ComandaDetalle[]> {
  return query<ComandaDetalle>(`
    SELECT
      cd.DetalleID       AS detalleID,
      cd.IdArticulo      AS articuloID,
      cd.NombreArticulo  AS articulo,
      cd.Cantidad        AS cantidad,
      cd.EstadoItem      AS estadoItem,
      cd.NotasEspeciales AS notasEspeciales,
      cd.HoraPedido      AS horaPedido
    FROM modu_rest_ComandaDetalle cd
    WHERE cd.ComandaID = @comandaID
    ORDER BY cd.HoraPedido
  `, (req) => {
    req.input('comandaID', sql.UniqueIdentifier, comandaID);
  });
}

/**
 * Rondas de un pedido que todavía no se han entregado.
 * Es la consulta que decide si el cajero puede cobrar.
 */
export async function comandasPendientesPedido(
  pedidoID: string
): Promise<number> {
  const rows = await query<{ total: number }>(`
    SELECT COUNT(*) AS total
    FROM modu_rest_Comandas
    WHERE PedidoID = @pedidoID AND Estado <> 'Despachada'
  `, (req) => {
    req.input('pedidoID', sql.UniqueIdentifier, pedidoID);
  });
  return rows[0].total;
}

// ── Marcar entrega ───────────────────────────────────

/**
 * El mesero confirma que llevó los platos de UNA ronda a la mesa.
 */
export async function marcarDespachada(
  comandaID: string,
  usuarioID: string
): Promise<Comanda> {
  const comanda = await obtenerComanda(comandaID);

  if (comanda.entregada)
    throw new AppError('Esta ronda ya fue marcada como entregada', 409);

  await query(`
    UPDATE modu_rest_Comandas SET
      Estado         = 'Despachada',
      HoraDespachada = SYSUTCDATETIME(),
      DespachadaPor  = @usuarioID
    WHERE ComandaID = @comandaID
  `, (req) => {
    req.input('comandaID', sql.UniqueIdentifier, comandaID);
    req.input('usuarioID', sql.UniqueIdentifier, usuarioID);
  });

  await query(`
    UPDATE modu_rest_ComandaDetalle SET EstadoItem = 'Entregado'
    WHERE ComandaID = @comandaID AND EstadoItem <> 'Cancelado'
  `, (req) => {
    req.input('comandaID', sql.UniqueIdentifier, comandaID);
  });

  const actualizada = await obtenerComanda(comandaID);
  const pendientes = await comandasPendientesPedido(comanda.pedidoID);

  await registrarEvento({
    tipo:        'PEDIDO_ENTREGADO',
    entidadTipo: 'Comanda',
    entidadID:   comandaID,
    usuarioID,
    payload: {
      pedidoID:      comanda.pedidoID,
      numeroPedido:  comanda.numeroPedido,
      mesaAlias:     comanda.mesaAlias,
      numeroRonda:   comanda.numeroRonda,
      pendientes,
      pedidoCompleto: pendientes === 0,
    },
  });

  return actualizada;
}

/**
 * Marca TODAS las rondas pendientes del pedido como entregadas.
 *
 * Es lo que el mesero usa en la práctica: llega a la mesa con todo
 * y presiona un botón. Marcar ronda por ronda solo tiene sentido
 * cuando entrega la bebida primero y la comida después.
 */
export async function marcarPedidoEntregado(
  pedidoID: string,
  usuarioID: string
): Promise<{ rondasEntregadas: number; pedidoID: string }> {

  const pedidoRows = await query<{
    estadoPedido: string; numeroPedido: number; mesaAlias: string | null;
  }>(`
    SELECT
      p.EstadoPedido AS estadoPedido,
      p.NumeroPedido AS numeroPedido,
      m.Alias        AS mesaAlias
    FROM modu_rest_Pedidos p
    LEFT JOIN modu_rest_Mesas m ON p.MesaID = m.MesaID
    WHERE p.PedidoID = @pedidoID
  `, (req) => {
    req.input('pedidoID', sql.UniqueIdentifier, pedidoID);
  });

  if (pedidoRows.length === 0) throw new AppError('Pedido no encontrado', 404);

  const pedido = pedidoRows[0];

  if (!['Abierto', 'Por Pagar'].includes(pedido.estadoPedido))
    throw new AppError(
      `No se puede marcar la entrega de un pedido ${pedido.estadoPedido}`, 409);

  const pendientesAntes = await comandasPendientesPedido(pedidoID);

  if (pendientesAntes === 0)
    throw new AppError('Este pedido ya está entregado completo', 409);

  await query(`
    UPDATE modu_rest_Comandas SET
      Estado         = 'Despachada',
      HoraDespachada = SYSUTCDATETIME(),
      DespachadaPor  = @usuarioID
    WHERE PedidoID = @pedidoID AND Estado <> 'Despachada'
  `, (req) => {
    req.input('pedidoID',  sql.UniqueIdentifier, pedidoID);
    req.input('usuarioID', sql.UniqueIdentifier, usuarioID);
  });

  await query(`
    UPDATE cd SET cd.EstadoItem = 'Entregado'
    FROM modu_rest_ComandaDetalle cd
    WHERE cd.PedidoID = @pedidoID AND cd.EstadoItem <> 'Cancelado'
  `, (req) => {
    req.input('pedidoID', sql.UniqueIdentifier, pedidoID);
  });

  await registrarEvento({
    tipo:        'PEDIDO_ENTREGADO',
    entidadTipo: 'Pedido',
    entidadID:   pedidoID,
    usuarioID,
    payload: {
      pedidoID,
      numeroPedido:   pedido.numeroPedido,
      mesaAlias:      pedido.mesaAlias,
      rondas:         pendientesAntes,
      pedidoCompleto: true,
    },
  });

  return { rondasEntregadas: pendientesAntes, pedidoID };
}