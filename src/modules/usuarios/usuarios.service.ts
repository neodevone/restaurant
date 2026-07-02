// src/modules/usuarios/usuarios.service.ts

import { query, sql } from '../../config/database';
import { AppError } from '../../middlewares/error.middleware';
import { hashPassword } from '../auth/auth.service';

export interface Usuario {
  usuarioID: string;
  rolID: string;
  rolNombre: string;
  nombre: string;
  apellido: string;
  usuario: string;
  pin: string | null;
  activo: boolean;
  fechaCreacion: string;
  ultimoAcceso: string | null;
}

export interface CrearUsuarioDTO {
  rolID: string;
  nombre: string;
  apellido: string;
  usuario: string;
  password: string;
  pin?: string;
}

export interface ActualizarUsuarioDTO {
  rolID?: string;
  nombre?: string;
  apellido?: string;
  pin?: string | null;
}

// ── Listar todos ─────────────────────────────────────
export async function listarUsuarios(): Promise<Usuario[]> {
  return query<Usuario>(`
    SELECT 
      u.UsuarioID    AS usuarioID,
      u.RolID        AS rolID,
      r.Nombre       AS rolNombre,
      u.Nombre       AS nombre,
      u.Apellido     AS apellido,
      u.Usuario      AS usuario,
      u.PIN          AS pin,
      u.Activo       AS activo,
      u.FechaCreacion AS fechaCreacion,
      u.UltimoAcceso  AS ultimoAcceso
    FROM Usuarios u
    JOIN Roles r ON u.RolID = r.RolID
    ORDER BY u.Nombre
  `);
}

// ── Obtener por ID ───────────────────────────────────
export async function obtenerUsuario(usuarioID: string): Promise<Usuario> {
  const rows = await query<Usuario>(`
    SELECT 
      u.UsuarioID    AS usuarioID,
      u.RolID        AS rolID,
      r.Nombre       AS rolNombre,
      u.Nombre       AS nombre,
      u.Apellido     AS apellido,
      u.Usuario      AS usuario,
      u.PIN          AS pin,
      u.Activo       AS activo,
      u.FechaCreacion AS fechaCreacion,
      u.UltimoAcceso  AS ultimoAcceso
    FROM Usuarios u
    JOIN Roles r ON u.RolID = r.RolID
    WHERE u.UsuarioID = @usuarioID
  `, (req) => {
    req.input('usuarioID', sql.UniqueIdentifier, usuarioID);
  });

  if (rows.length === 0) throw new AppError('Usuario no encontrado', 404);
  return rows[0];
}

// ── Crear usuario ────────────────────────────────────
export async function crearUsuario(data: CrearUsuarioDTO): Promise<Usuario> {
  // Verificar que el nombre de usuario no exista
  const existente = await query<{ total: number }>(`
    SELECT COUNT(*) AS total 
    FROM Usuarios 
    WHERE Usuario = @usuario
  `, (req) => {
    req.input('usuario', sql.NVarChar, data.usuario);
  });

  if (existente[0].total > 0) {
    throw new AppError('El nombre de usuario ya está en uso', 409);
  }

  // Verificar PIN único si se proporcionó
  if (data.pin) {
    const pinExistente = await query<{ total: number }>(`
      SELECT COUNT(*) AS total 
      FROM Usuarios 
      WHERE PIN = @pin
    `, (req) => {
      req.input('pin', sql.NVarChar, data.pin!);
    });

    if (pinExistente[0].total > 0) {
      throw new AppError('El PIN ya está en uso por otro usuario', 409);
    }
  }

  const passwordHash = await hashPassword(data.password);

  const rows = await query<{ UsuarioID: string }>(`
    INSERT INTO Usuarios 
      (RolID, Nombre, Apellido, Usuario, PasswordHash, PIN, Activo)
    OUTPUT INSERTED.UsuarioID
    VALUES 
      (@rolID, @nombre, @apellido, @usuario, @passwordHash, @pin, 1)
  `, (req) => {
    req.input('rolID',        sql.UniqueIdentifier, data.rolID);
    req.input('nombre',       sql.NVarChar, data.nombre);
    req.input('apellido',     sql.NVarChar, data.apellido);
    req.input('usuario',      sql.NVarChar, data.usuario);
    req.input('passwordHash', sql.NVarChar, passwordHash);
    req.input('pin',          sql.NVarChar, data.pin ?? null);
  });

  return obtenerUsuario(rows[0].UsuarioID);
}

// ── Actualizar usuario ───────────────────────────────
export async function actualizarUsuario(
  usuarioID: string,
  data: ActualizarUsuarioDTO
): Promise<Usuario> {
  await obtenerUsuario(usuarioID); // Verifica que existe

  // Verificar PIN único si se está cambiando
  if (data.pin) {
    const pinExistente = await query<{ total: number }>(`
      SELECT COUNT(*) AS total 
      FROM Usuarios 
      WHERE PIN = @pin AND UsuarioID != @usuarioID
    `, (req) => {
      req.input('pin',       sql.NVarChar,       data.pin!);
      req.input('usuarioID', sql.UniqueIdentifier, usuarioID);
    });

    if (pinExistente[0].total > 0) {
      throw new AppError('El PIN ya está en uso por otro usuario', 409);
    }
  }

  await query(`
    UPDATE Usuarios SET
      RolID    = COALESCE(@rolID,    RolID),
      Nombre   = COALESCE(@nombre,   Nombre),
      Apellido = COALESCE(@apellido, Apellido),
      PIN      = COALESCE(@pin,      PIN)
    WHERE UsuarioID = @usuarioID
  `, (req) => {
    req.input('usuarioID', sql.UniqueIdentifier, usuarioID);
    req.input('rolID',     sql.UniqueIdentifier, data.rolID    ?? null);
    req.input('nombre',    sql.NVarChar,         data.nombre   ?? null);
    req.input('apellido',  sql.NVarChar,         data.apellido ?? null);
    req.input('pin',       sql.NVarChar,         data.pin      ?? null);
  });

  return obtenerUsuario(usuarioID);
}

// ── Cambiar password ─────────────────────────────────
export async function cambiarPassword(
  usuarioID: string,
  passwordNuevo: string
): Promise<void> {
  await obtenerUsuario(usuarioID);
  const hash = await hashPassword(passwordNuevo);

  await query(`
    UPDATE Usuarios 
    SET PasswordHash = @hash 
    WHERE UsuarioID = @usuarioID
  `, (req) => {
    req.input('hash',      sql.NVarChar,         hash);
    req.input('usuarioID', sql.UniqueIdentifier, usuarioID);
  });
}

// ── Activar / Desactivar ─────────────────────────────
export async function toggleUsuario(
  usuarioID: string,
  activo: boolean
): Promise<void> {
  await obtenerUsuario(usuarioID);

  await query(`
    UPDATE Usuarios 
    SET Activo = @activo 
    WHERE UsuarioID = @usuarioID
  `, (req) => {
    req.input('activo',    sql.Bit,              activo);
    req.input('usuarioID', sql.UniqueIdentifier, usuarioID);
  });
}

// ── Listar roles disponibles ─────────────────────────
export async function listarRoles() {
  return query(`
    SELECT RolID AS rolID, Nombre AS nombre, Descripcion AS descripcion
    FROM Roles
    WHERE Activo = 1
    ORDER BY Nombre
  `);
}