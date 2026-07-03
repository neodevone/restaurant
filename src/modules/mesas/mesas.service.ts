// src/modules/mesas/mesas.service.ts

import { query, sql } from '../../config/database';
import { AppError } from '../../middlewares/error.middleware';

// ── Interfaces ───────────────────────────────────────

export interface Zona {
  zonaID: string;
  nombre: string;
  activa: boolean;
  orden: number;
}

export interface Mesa {
  mesaID: string;
  zonaID: string;
  zonaNombre: string;
  alias: string;
  capacidad: number;
  estado: string;
  posicionX: number;
  posicionY: number;
  activa: boolean;
}

export interface MesaConPedido extends Mesa {
  pedidoID: string | null;
  numeroPedido: number | null;
  numeroPersonas: number | null;
  mesero: string | null;
  minutosOcupada: number | null;
  totalCuenta: number | null;
}

export type EstadoMesa =
  | 'Libre'
  | 'Ocupada'
  | 'Reservada'
  | 'Cuenta-Pedida';

// ── ZONAS ────────────────────────────────────────────

export async function listarZonas(): Promise<Zona[]> {
  return query<Zona>(`
    SELECT
      ZonaID  AS zonaID,
      Nombre  AS nombre,
      Activa  AS activa,
      Orden   AS orden
    FROM modu_rest_Zonas
    ORDER BY Orden, Nombre
  `);
}

export async function crearZona(data: { nombre: string; orden?: number }): Promise<Zona> {
  const rows = await query<{ ZonaID: string }>(`
    INSERT INTO modu_rest_Zonas (Nombre, Orden)
    OUTPUT INSERTED.ZonaID
    VALUES (@nombre, @orden)
  `, (req) => {
    req.input('nombre', sql.NVarChar, data.nombre);
    req.input('orden',  sql.Int,      data.orden ?? 0);
  });

  const zonas = await query<Zona>(`
    SELECT ZonaID AS zonaID, Nombre AS nombre,
           Activa AS activa, Orden AS orden
    FROM modu_rest_Zonas WHERE ZonaID = @id
  `, (req) => {
    req.input('id', sql.UniqueIdentifier, rows[0].ZonaID);
  });

  return zonas[0];
}

export async function toggleZona(zonaID: string, activa: boolean): Promise<void> {
  await query(`
    UPDATE modu_rest_Zonas SET Activa = @activa WHERE ZonaID = @zonaID
  `, (req) => {
    req.input('activa', sql.Bit,              activa);
    req.input('zonaID', sql.UniqueIdentifier, zonaID);
  });
}

// ── MESAS ────────────────────────────────────────────

export async function listarMesas(zonaID?: string): Promise<Mesa[]> {
  return query<Mesa>(`
    SELECT
      m.MesaID    AS mesaID,
      m.ZonaID    AS zonaID,
      z.Nombre    AS zonaNombre,
      m.Alias     AS alias,
      m.Capacidad AS capacidad,
      m.Estado    AS estado,
      m.PosicionX AS posicionX,
      m.PosicionY AS posicionY,
      m.Activa    AS activa
    FROM modu_rest_Mesas m
    JOIN modu_rest_Zonas z ON m.ZonaID = z.ZonaID
    WHERE m.Activa = 1
      AND (@zonaID IS NULL OR m.ZonaID = @zonaID)
    ORDER BY z.Orden, m.Alias
  `, (req) => {
    req.input('zonaID', sql.UniqueIdentifier, zonaID ?? null);
  });
}

export async function listarMesasConPedido(): Promise<MesaConPedido[]> {
  return query<MesaConPedido>(`
    SELECT
      m.MesaID         AS mesaID,
      m.ZonaID         AS zonaID,
      z.Nombre         AS zonaNombre,
      m.Alias          AS alias,
      m.Capacidad      AS capacidad,
      m.Estado         AS estado,
      m.PosicionX      AS posicionX,
      m.PosicionY      AS posicionY,
      m.Activa         AS activa,
      p.PedidoID       AS pedidoID,
      p.NumeroPedido   AS numeroPedido,
      p.NumeroPersonas AS numeroPersonas,
      u.Nombre + ' ' + u.Apellido AS mesero,
      DATEDIFF(MINUTE, p.FechaApertura, SYSUTCDATETIME()) AS minutosOcupada,
      p.TotalCuenta    AS totalCuenta
    FROM modu_rest_Mesas m
    JOIN modu_rest_Zonas z ON m.ZonaID = z.ZonaID
    LEFT JOIN modu_rest_Pedidos p
      ON  p.MesaID = m.MesaID
      AND p.EstadoPedido IN ('Abierto', 'Por Pagar')
    LEFT JOIN modu_rest_Usuarios u ON p.MeseroID = u.UsuarioID
    WHERE m.Activa = 1
    ORDER BY z.Orden, m.Alias
  `);
}

export async function obtenerMesa(mesaID: string): Promise<Mesa> {
  const rows = await query<Mesa>(`
    SELECT
      m.MesaID    AS mesaID,
      m.ZonaID    AS zonaID,
      z.Nombre    AS zonaNombre,
      m.Alias     AS alias,
      m.Capacidad AS capacidad,
      m.Estado    AS estado,
      m.PosicionX AS posicionX,
      m.PosicionY AS posicionY,
      m.Activa    AS activa
    FROM modu_rest_Mesas m
    JOIN modu_rest_Zonas z ON m.ZonaID = z.ZonaID
    WHERE m.MesaID = @mesaID
  `, (req) => {
    req.input('mesaID', sql.UniqueIdentifier, mesaID);
  });

  if (rows.length === 0) throw new AppError('Mesa no encontrada', 404);
  return rows[0];
}

export async function crearMesa(data: {
  zonaID: string;
  alias: string;
  capacidad?: number;
  posicionX?: number;
  posicionY?: number;
}): Promise<Mesa> {
  const existente = await query<{ total: number }>(`
    SELECT COUNT(*) AS total
    FROM modu_rest_Mesas
    WHERE ZonaID = @zonaID AND Alias = @alias
  `, (req) => {
    req.input('zonaID', sql.UniqueIdentifier, data.zonaID);
    req.input('alias',  sql.NVarChar,         data.alias);
  });

  if (existente[0].total > 0) {
    throw new AppError('Ya existe una mesa con ese nombre en esta zona', 409);
  }

  const rows = await query<{ MesaID: string }>(`
    INSERT INTO modu_rest_Mesas (ZonaID, Alias, Capacidad, PosicionX, PosicionY)
    OUTPUT INSERTED.MesaID
    VALUES (@zonaID, @alias, @capacidad, @posicionX, @posicionY)
  `, (req) => {
    req.input('zonaID',    sql.UniqueIdentifier, data.zonaID);
    req.input('alias',     sql.NVarChar,         data.alias);
    req.input('capacidad', sql.Int,              data.capacidad  ?? 4);
    req.input('posicionX', sql.Int,              data.posicionX  ?? 0);
    req.input('posicionY', sql.Int,              data.posicionY  ?? 0);
  });

  return obtenerMesa(rows[0].MesaID);
}

export async function actualizarMesa(mesaID: string, data: {
  zonaID?: string;
  alias?: string;
  capacidad?: number;
  posicionX?: number;
  posicionY?: number;
}): Promise<Mesa> {
  await obtenerMesa(mesaID);

  await query(`
    UPDATE modu_rest_Mesas SET
      ZonaID    = COALESCE(@zonaID,    ZonaID),
      Alias     = COALESCE(@alias,     Alias),
      Capacidad = COALESCE(@capacidad, Capacidad),
      PosicionX = COALESCE(@posicionX, PosicionX),
      PosicionY = COALESCE(@posicionY, PosicionY)
    WHERE MesaID = @mesaID
  `, (req) => {
    req.input('mesaID',    sql.UniqueIdentifier, mesaID);
    req.input('zonaID',    sql.UniqueIdentifier, data.zonaID    ?? null);
    req.input('alias',     sql.NVarChar,         data.alias     ?? null);
    req.input('capacidad', sql.Int,              data.capacidad ?? null);
    req.input('posicionX', sql.Int,              data.posicionX ?? null);
    req.input('posicionY', sql.Int,              data.posicionY ?? null);
  });

  return obtenerMesa(mesaID);
}

export async function cambiarEstadoMesa(
  mesaID: string,
  estado: EstadoMesa
): Promise<Mesa> {
  await obtenerMesa(mesaID);

  await query(`
    UPDATE modu_rest_Mesas SET Estado = @estado WHERE MesaID = @mesaID
  `, (req) => {
    req.input('estado',  sql.NVarChar,         estado);
    req.input('mesaID',  sql.UniqueIdentifier, mesaID);
  });

  return obtenerMesa(mesaID);
}

export async function toggleMesa(mesaID: string, activa: boolean): Promise<void> {
  await obtenerMesa(mesaID);

  await query(`
    UPDATE modu_rest_Mesas SET Activa = @activa WHERE MesaID = @mesaID
  `, (req) => {
    req.input('activa', sql.Bit,              activa);
    req.input('mesaID', sql.UniqueIdentifier, mesaID);
  });
}

export async function actualizarPosicionMesa(
  mesaID: string,
  posicionX: number,
  posicionY: number
): Promise<void> {
  await query(`
    UPDATE modu_rest_Mesas
    SET PosicionX = @posicionX,
        PosicionY = @posicionY
    WHERE MesaID = @mesaID
  `, (req) => {
    req.input('mesaID',    sql.UniqueIdentifier, mesaID);
    req.input('posicionX', sql.Int,              posicionX);
    req.input('posicionY', sql.Int,              posicionY);
  });
}