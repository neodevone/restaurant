// src/modules/usuarios/usuarios.service.ts

import bcrypt from 'bcrypt';
import { query, sql } from '../../config/database';
import { AppError } from '../../middlewares/error.middleware';

// ── Interfaces ───────────────────────────────────────

export interface Usuario {
  usuarioID:     string;
  rolID:         string;
  rol:           string;
  nombre:        string;
  apellido:      string;
  usuario:       string;
  pin:           string | null;
  activo:        boolean;
  fechaCreacion: string;
  ultimoAcceso:  string | null;
}

export interface Rol {
  rolID:       string;
  nombre:      string;
  descripcion: string;
}

// ── Listar usuarios ──────────────────────────────────

export async function listarUsuarios(): Promise<Usuario[]> {
  return query<Usuario>(`
    SELECT
      u.UsuarioID     AS usuarioID,
      u.RolID         AS rolID,
      r.Nombre        AS rol,
      u.Nombre        AS nombre,
      u.Apellido      AS apellido,
      u.Usuario       AS usuario,
      u.PIN           AS pin,
      u.Activo        AS activo,
      u.FechaCreacion AS fechaCreacion,
      u.UltimoAcceso  AS ultimoAcceso
    FROM modu_rest_Usuarios u
    JOIN modu_rest_Roles r ON u.RolID = r.RolID
    ORDER BY r.Nombre, u.Nombre
  `);
}

// ── Obtener usuario ──────────────────────────────────

export async function obtenerUsuario(usuarioID: string): Promise<Usuario> {
  const rows = await query<Usuario>(`
    SELECT
      u.UsuarioID     AS usuarioID,
      u.RolID         AS rolID,
      r.Nombre        AS rol,
      u.Nombre        AS nombre,
      u.Apellido      AS apellido,
      u.Usuario       AS usuario,
      u.PIN           AS pin,
      u.Activo        AS activo,
      u.FechaCreacion AS fechaCreacion,
      u.UltimoAcceso  AS ultimoAcceso
    FROM modu_rest_Usuarios u
    JOIN modu_rest_Roles r ON u.RolID = r.RolID
    WHERE u.UsuarioID = @usuarioID
  `, (req) => {
    req.input('usuarioID', sql.UniqueIdentifier, usuarioID);
  });

  if (rows.length === 0) throw new AppError('Usuario no encontrado', 404);
  return rows[0];
}

// ── Listar roles ─────────────────────────────────────

export async function listarRoles(): Promise<Rol[]> {
  return query<Rol>(`
    SELECT
      RolID       AS rolID,
      Nombre      AS nombre,
      Descripcion AS descripcion
    FROM modu_rest_Roles
    WHERE Activo = 1
    ORDER BY Nombre
  `);
}

// ── Crear usuario ────────────────────────────────────

export async function crearUsuario(data: {
  rolID:    string;
  nombre:   string;
  apellido: string;
  usuario:  string;
  password: string;
  pin?:     string;
}): Promise<Usuario> {

  // Verificar usuario duplicado
  const existente = await query<{ total: number }>(`
    SELECT COUNT(*) AS total
    FROM modu_rest_Usuarios
    WHERE Usuario = @usuario
  `, (req) => {
    req.input('usuario', sql.NVarChar, data.usuario);
  });

  if (existente[0].total > 0)
    throw new AppError('Ya existe un usuario con ese nombre de usuario', 409);

  // Hash de la contraseña
  const passwordHash = await bcrypt.hash(data.password, 12);

  const rows = await query<{ UsuarioID: string }>(`
    INSERT INTO modu_rest_Usuarios
      (RolID, Nombre, Apellido, Usuario, PasswordHash, PIN, Activo)
    OUTPUT INSERTED.UsuarioID
    VALUES
      (@rolID, @nombre, @apellido, @usuario, @passwordHash, @pin, 1)
  `, (req) => {
    req.input('rolID',        sql.UniqueIdentifier, data.rolID);
    req.input('nombre',       sql.NVarChar,         data.nombre);
    req.input('apellido',     sql.NVarChar,         data.apellido);
    req.input('usuario',      sql.NVarChar,         data.usuario);
    req.input('passwordHash', sql.NVarChar,         passwordHash);
    req.input('pin',          sql.NVarChar,         data.pin ?? null);
  });

  return obtenerUsuario(rows[0].UsuarioID);
}

// ── Actualizar usuario ───────────────────────────────

export async function actualizarUsuario(
  usuarioID: string,
  data: {
    rolID?:    string;
    nombre?:   string;
    apellido?: string;
    usuario?:  string;
    pin?:      string;
  }
): Promise<Usuario> {
  await obtenerUsuario(usuarioID);

  await query(`
    UPDATE modu_rest_Usuarios SET
      RolID    = COALESCE(@rolID,    RolID),
      Nombre   = COALESCE(@nombre,   Nombre),
      Apellido = COALESCE(@apellido, Apellido),
      Usuario  = COALESCE(@usuario,  Usuario),
      PIN      = COALESCE(@pin,      PIN)
    WHERE UsuarioID = @usuarioID
  `, (req) => {
    req.input('usuarioID', sql.UniqueIdentifier, usuarioID);
    req.input('rolID',     sql.UniqueIdentifier, data.rolID    ?? null);
    req.input('nombre',    sql.NVarChar,         data.nombre   ?? null);
    req.input('apellido',  sql.NVarChar,         data.apellido ?? null);
    req.input('usuario',   sql.NVarChar,         data.usuario  ?? null);
    req.input('pin',       sql.NVarChar,         data.pin      ?? null);
  });

  return obtenerUsuario(usuarioID);
}

// ── Cambiar contraseña ───────────────────────────────

export async function cambiarPassword(
  usuarioID: string,
  nuevaPassword: string
): Promise<void> {
  await obtenerUsuario(usuarioID);

  const hash = await bcrypt.hash(nuevaPassword, 12);

  await query(`
    UPDATE modu_rest_Usuarios
    SET PasswordHash = @hash
    WHERE UsuarioID = @usuarioID
  `, (req) => {
    req.input('usuarioID', sql.UniqueIdentifier, usuarioID);
    req.input('hash',      sql.NVarChar,         hash);
  });
}

// ── Activar / Desactivar ─────────────────────────────

export async function toggleActivo(
  usuarioID: string,
  activo: boolean
): Promise<void> {
  await obtenerUsuario(usuarioID);

  await query(`
    UPDATE modu_rest_Usuarios
    SET Activo = @activo
    WHERE UsuarioID = @usuarioID
  `, (req) => {
    req.input('usuarioID', sql.UniqueIdentifier, usuarioID);
    req.input('activo',    sql.Bit,              activo);
  });
}