// src/modules/clientes/clientes.service.ts
//
// Clientes frecuentes de domicilio. Se separa de Usuarios a propósito:
// un cliente no inicia sesión ni tiene rol — son conceptos distintos
// aunque ambos sean "personas" en el negocio.
//
// El celular es el identificador real: la cédula casi nunca se pide
// para un domicilio.

import { query, sql } from '../../config/database';
import { AppError } from '../../middlewares/error.middleware';

export interface Cliente {
  clienteID:         string;
  celular:            string;
  nombre:             string;
  direccion:          string | null;
  notas:              string | null;
  activo:             boolean;
  fechaRegistro:      string;
  fechaUltimoPedido:  string | null;
}

export interface ClienteDTO {
  celular:    string;
  nombre:     string;
  direccion?: string;
  notas?:     string;
}

function limpiarCelular(celular: string): string {
  return celular.replace(/[^\d]/g, '');
}

// ── Buscar por celular ────────────────────────────────
// Es la operación central del formulario de captura: el cajero
// escribe el número y el sistema dice si ya existe.

export async function buscarPorCelular(
  celular: string
): Promise<Cliente | null> {
  const rows = await query<Cliente>(`
    SELECT
      ClienteID         AS clienteID,
      Celular           AS celular,
      Nombre            AS nombre,
      Direccion         AS direccion,
      Notas             AS notas,
      Activo            AS activo,
      FechaRegistro     AS fechaRegistro,
      FechaUltimoPedido AS fechaUltimoPedido
    FROM modu_rest_Clientes
    WHERE Celular = @celular AND Activo = 1
  `, (req) => {
    req.input('celular', sql.NVarChar, limpiarCelular(celular));
  });

  return rows[0] ?? null;
}

// ── Buscar por texto (nombre o celular) ───────────────
// Para el autocompletar del formulario: el cajero puede recordar
// el nombre y no el número, o al revés.

export async function buscarClientes(texto: string): Promise<Cliente[]> {
  const q = texto.trim();
  if (q.length < 2) return [];

  return query<Cliente>(`
    SELECT TOP 15
      ClienteID         AS clienteID,
      Celular           AS celular,
      Nombre            AS nombre,
      Direccion         AS direccion,
      Notas             AS notas,
      Activo            AS activo,
      FechaRegistro     AS fechaRegistro,
      FechaUltimoPedido AS fechaUltimoPedido
    FROM modu_rest_Clientes
    WHERE Activo = 1
      AND (Nombre LIKE '%' + @q + '%' OR Celular LIKE '%' + @q + '%')
    ORDER BY FechaUltimoPedido DESC, Nombre
  `, (req) => {
    req.input('q', sql.NVarChar, q);
  });
}

// ── Crear cliente ──────────────────────────────────────

export async function crearCliente(data: ClienteDTO): Promise<Cliente> {
  const celular = limpiarCelular(data.celular);

  if (celular.length < 7)
    throw new AppError('El celular debe tener al menos 7 dígitos', 400);

  const existente = await buscarPorCelular(celular);
  if (existente)
    throw new AppError(
      `Ya existe un cliente con este celular: ${existente.nombre}`, 409);

  const rows = await query<{ ClienteID: string }>(`
    INSERT INTO modu_rest_Clientes (Celular, Nombre, Direccion, Notas)
    OUTPUT INSERTED.ClienteID
    VALUES (@celular, @nombre, @direccion, @notas)
  `, (req) => {
    req.input('celular',   sql.NVarChar, celular);
    req.input('nombre',    sql.NVarChar, data.nombre.trim());
    req.input('direccion', sql.NVarChar, data.direccion?.trim() || null);
    req.input('notas',     sql.NVarChar, data.notas?.trim()     || null);
  });

  const cliente = await buscarPorCelular(celular);
  return cliente!;
}

// ── Actualizar cliente ─────────────────────────────────
// Cambia el nombre/dirección "actuales" de la ficha. Los pedidos
// ya registrados NO se tocan: guardan su propia DireccionEntrega
// como estaba el día del domicilio.

export async function actualizarCliente(
  clienteID: string,
  data: Partial<ClienteDTO>
): Promise<Cliente> {
  await query(`
    UPDATE modu_rest_Clientes SET
      Nombre    = COALESCE(@nombre,    Nombre),
      Direccion = COALESCE(@direccion, Direccion),
      Notas     = COALESCE(@notas,     Notas)
    WHERE ClienteID = @clienteID
  `, (req) => {
    req.input('clienteID', sql.UniqueIdentifier, clienteID);
    req.input('nombre',    sql.NVarChar, data.nombre?.trim()    ?? null);
    req.input('direccion', sql.NVarChar, data.direccion?.trim() ?? null);
    req.input('notas',     sql.NVarChar, data.notas?.trim()     ?? null);
  });

  const rows = await query<Cliente>(`
    SELECT
      ClienteID AS clienteID, Celular AS celular, Nombre AS nombre,
      Direccion AS direccion, Notas AS notas, Activo AS activo,
      FechaRegistro AS fechaRegistro, FechaUltimoPedido AS fechaUltimoPedido
    FROM modu_rest_Clientes WHERE ClienteID = @clienteID
  `, (req) => {
    req.input('clienteID', sql.UniqueIdentifier, clienteID);
  });

  if (rows.length === 0) throw new AppError('Cliente no encontrado', 404);
  return rows[0];
}

/** Se llama al registrar un domicilio, para que la lista salga ordenada por recencia. */
export async function marcarUltimoPedido(clienteID: string): Promise<void> {
  await query(`
    UPDATE modu_rest_Clientes
    SET FechaUltimoPedido = SYSUTCDATETIME()
    WHERE ClienteID = @clienteID
  `, (req) => {
    req.input('clienteID', sql.UniqueIdentifier, clienteID);
  });
}

export async function listarClientesFrecuentes(limite = 50): Promise<Cliente[]> {
  return query<Cliente>(`
    SELECT TOP (@limite)
      ClienteID AS clienteID, Celular AS celular, Nombre AS nombre,
      Direccion AS direccion, Notas AS notas, Activo AS activo,
      FechaRegistro AS fechaRegistro, FechaUltimoPedido AS fechaUltimoPedido
    FROM modu_rest_Clientes
    WHERE Activo = 1
    ORDER BY FechaUltimoPedido DESC, FechaRegistro DESC
  `, (req) => {
    req.input('limite', sql.Int, limite);
  });
}