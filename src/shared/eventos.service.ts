// src/shared/eventos.service.ts

import { query, sql } from '../config/database';
import {
  emitirEvento,
  emitirEventoMultiple,
  ROOMS,
  EVENTOS_SOCKET
} from '../sockets/socket.manager';

export type TipoEvento =
  | 'MESA_ABIERTA'
  | 'MESA_CERRADA'
  | 'COMANDA_ENVIADA'
  | 'COMANDA_LISTA'
  | 'PAGO_RECIBIDO'
  | 'ARTICULO_AGOTADO'
  | 'ALERTA_KDS_ROJA';

interface RegistrarEventoParams {
  tipo: TipoEvento;
  entidadTipo?: string;
  entidadID?: string;
  usuarioID?: string;
  payload?: Record<string, unknown>;
}

export async function registrarEvento(
  params: RegistrarEventoParams
): Promise<void> {
  const { tipo, entidadTipo, entidadID, usuarioID, payload } = params;

  // Persiste en BD
  await query(`
    INSERT INTO modu_rest_EventosSistema
      (TipoEvento, EntidadTipo, EntidadID, UsuarioID, Payload)
    VALUES
      (@tipo, @entidadTipo, @entidadID, @usuarioID, @payload)
  `, (req) => {
    req.input('tipo',        sql.NVarChar,      tipo);
    req.input('entidadTipo', sql.NVarChar,      entidadTipo ?? null);
    req.input('entidadID',   sql.UniqueIdentifier, entidadID ?? null);
    req.input('usuarioID',   sql.UniqueIdentifier, usuarioID ?? null);
    req.input('payload',     sql.NVarChar,
      payload ? JSON.stringify(payload) : null);
  });

  // Emite en tiempo real
  routearEvento(tipo, payload ?? {});
}

function routearEvento(
  tipo: TipoEvento,
  data: Record<string, unknown>
): void {
  switch (tipo) {
    case 'COMANDA_ENVIADA':
      emitirEventoMultiple(
        [ROOMS.COCINA, ROOMS.ADMIN],
        EVENTOS_SOCKET.COMANDA_NUEVA,
        data
      );
      break;

    case 'COMANDA_LISTA':
      emitirEventoMultiple(
        [ROOMS.SALA, ROOMS.ADMIN],
        EVENTOS_SOCKET.COMANDA_LISTA,
        data
      );
      break;

    case 'ALERTA_KDS_ROJA':
      emitirEvento(ROOMS.ADMIN, EVENTOS_SOCKET.ALERTA_KDS, data);
      break;

    case 'MESA_ABIERTA':
    case 'MESA_CERRADA':
      emitirEventoMultiple(
        [ROOMS.SALA, ROOMS.ADMIN],
        EVENTOS_SOCKET.MESA_ACTUALIZADA,
        data
      );
      break;

    case 'PAGO_RECIBIDO':
      emitirEventoMultiple(
        [ROOMS.CAJA, ROOMS.ADMIN],
        EVENTOS_SOCKET.PAGO_RECIBIDO,
        data
      );
      break;

    default:
      emitirEvento(ROOMS.ADMIN, EVENTOS_SOCKET.METRICAS_ACTUALIZADAS, data);
  }
}