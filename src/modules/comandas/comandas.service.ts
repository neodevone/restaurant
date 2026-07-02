// src/modules/comandas/comandas.service.ts

import { query, sql } from '../../config/database';
import { AppError } from '../../middlewares/error.middleware';

// ── Interfaces ───────────────────────────────────────

export interface Comanda {
  comandaID: string;
  pedidoID: string;
  numeroPedido: number;
  mesaAlias: string | null;
  zonaNombre: string | null;
  numeroRonda: number;
  estado: string;
  prioridad: number;
  horaEnviada: string;
  horaVista: string | null;
  horaIniciada: string | null;
  horaLista: string | null;
  horaDespachada: string | null;
  tiempoReaccion: number | null;
  tiempoPrep: number | null;
  tiempoTotal: number | null;
  notasCocina: string | null;
  segundosDesdeEnvio: number;
  minutosDesdeEnvio: number;
  semaforo: 'VERDE' | 'AMARILLO' | 'ROJO';
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

// ── Obtener comanda ──────────────────────────────────

export async function obtenerComanda(comandaID: string): Promise<Comanda> {
  const rows = await query<Comanda>(`
    SELECT
      c.ComandaID     AS comandaID,
      c.PedidoID      AS pedidoID,
      p.NumeroPedido  AS numeroPedido,
      m.Alias         AS mesaAlias,
      z.Nombre        AS zonaNombre,
      c.NumeroRonda   AS numeroRonda,
      c.Estado        AS estado,
      0               AS prioridad,
      c.HoraEnviada   AS horaEnviada,
      NULL            AS horaVista,
      NULL            AS horaIniciada,
      c.HoraLista     AS horaLista,
      NULL            AS horaDespachada,
      NULL            AS tiempoReaccion,
      NULL            AS tiempoPrep,
      NULL            AS tiempoTotal,
      c.NotasCocina   AS notasCocina,
      DATEDIFF(SECOND, c.HoraEnviada, SYSUTCDATETIME()) AS segundosDesdeEnvio,
      DATEDIFF(MINUTE, c.HoraEnviada, SYSUTCDATETIME()) AS minutosDesdeEnvio,
      CASE
        WHEN DATEDIFF(MINUTE, c.HoraEnviada, SYSUTCDATETIME()) >= 20 THEN 'ROJO'
        WHEN DATEDIFF(MINUTE, c.HoraEnviada, SYSUTCDATETIME()) >= 10 THEN 'AMARILLO'
        ELSE 'VERDE'
      END AS semaforo
    FROM modu_rest_Comandas c
    JOIN modu_rest_Pedidos p      ON c.PedidoID = p.PedidoID
    LEFT JOIN modu_rest_Mesas m   ON p.MesaID   = m.MesaID
    LEFT JOIN modu_rest_Zonas z   ON m.ZonaID   = z.ZonaID
    WHERE c.ComandaID = @comandaID
  `, (req) => {
    req.input('comandaID', sql.UniqueIdentifier, comandaID);
  });

  if (rows.length === 0) throw new AppError('Comanda no encontrada', 404);
  return rows[0];
}

// ── Obtener ítems de una comanda ─────────────────────

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

// ── Historial de comandas de un pedido ───────────────

export async function historialComandasPedido(
  pedidoID: string
): Promise<Comanda[]> {
  return query<Comanda>(`
    SELECT
      c.ComandaID     AS comandaID,
      c.PedidoID      AS pedidoID,
      p.NumeroPedido  AS numeroPedido,
      m.Alias         AS mesaAlias,
      z.Nombre        AS zonaNombre,
      c.NumeroRonda   AS numeroRonda,
      c.Estado        AS estado,
      0               AS prioridad,
      c.HoraEnviada   AS horaEnviada,
      NULL            AS horaVista,
      NULL            AS horaIniciada,
      c.HoraLista     AS horaLista,
      NULL            AS horaDespachada,
      NULL            AS tiempoReaccion,
      NULL            AS tiempoPrep,
      NULL            AS tiempoTotal,
      c.NotasCocina   AS notasCocina,
      DATEDIFF(SECOND, c.HoraEnviada, SYSUTCDATETIME()) AS segundosDesdeEnvio,
      DATEDIFF(MINUTE, c.HoraEnviada, SYSUTCDATETIME()) AS minutosDesdeEnvio,
      CASE
        WHEN DATEDIFF(MINUTE, c.HoraEnviada, SYSUTCDATETIME()) >= 20 THEN 'ROJO'
        WHEN DATEDIFF(MINUTE, c.HoraEnviada, SYSUTCDATETIME()) >= 10 THEN 'AMARILLO'
        ELSE 'VERDE'
      END AS semaforo
    FROM modu_rest_Comandas c
    JOIN modu_rest_Pedidos p      ON c.PedidoID = p.PedidoID
    LEFT JOIN modu_rest_Mesas m   ON p.MesaID   = m.MesaID
    LEFT JOIN modu_rest_Zonas z   ON m.ZonaID   = z.ZonaID
    WHERE c.PedidoID = @pedidoID
    ORDER BY c.NumeroRonda ASC
  `, (req) => {
    req.input('pedidoID', sql.UniqueIdentifier, pedidoID);
  });
}

// ── Marcar comanda LISTA ─────────────────────────────

export async function marcarLista(
  comandaID: string,
  usuarioID: string
): Promise<Comanda> {
  const comanda = await obtenerComanda(comandaID);

  if (comanda.estado === 'Lista') {
    throw new AppError('La comanda ya está marcada como Lista', 409);
  }

  await query(`
    UPDATE modu_rest_Comandas SET
      Estado    = 'Lista',
      HoraLista = SYSUTCDATETIME()
    WHERE ComandaID = @comandaID
  `, (req) => {
    req.input('comandaID', sql.UniqueIdentifier, comandaID);
  });

  await query(`
    UPDATE modu_rest_ComandaDetalle SET EstadoItem = 'Listo'
    WHERE ComandaID = @comandaID AND EstadoItem != 'Cancelado'
  `, (req) => {
    req.input('comandaID', sql.UniqueIdentifier, comandaID);
  });

  return obtenerComanda(comandaID);
}

// ── Marcar comanda DESPACHADA ─────────────────────────

export async function marcarDespachada(
  comandaID: string,
  usuarioID: string
): Promise<Comanda> {
  const comanda = await obtenerComanda(comandaID);

  if (!['Pendiente', 'Lista'].includes(comanda.estado)) {
    throw new AppError('La comanda no está en estado válido para despachar', 409);
  }

  await query(`
    UPDATE modu_rest_Comandas SET Estado = 'Despachada'
    WHERE ComandaID = @comandaID
  `, (req) => {
    req.input('comandaID', sql.UniqueIdentifier, comandaID);
  });

  await query(`
    UPDATE modu_rest_ComandaDetalle SET EstadoItem = 'Entregado'
    WHERE ComandaID = @comandaID AND EstadoItem != 'Cancelado'
  `, (req) => {
    req.input('comandaID', sql.UniqueIdentifier, comandaID);
  });

  return obtenerComanda(comandaID);
}