// src/modules/auth/auth.service.ts

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { query, sql } from '../../config/database';
import { AppError } from '../../middlewares/error.middleware';
import { env } from '../../config/environment';

// ── Interfaces ───────────────────────────────────────

export interface UsuarioToken {
  usuarioID: string;
  nombre: string;
  apellido: string;
  usuario: string;
  rol: string;
}

interface UsuarioDB {
  usuarioID: string;
  passwordHash: string;
  pin: string | null;
  nombre: string;
  apellido: string;
  usuario: string;
  rol: string;
  activo: boolean;
}

// ── Login con credenciales ───────────────────────────

export async function loginConCredenciales(
  usuario: string,
  password: string
): Promise<{ token: string; usuario: UsuarioToken }> {

  const rows = await query<UsuarioDB>(`
    SELECT
      u.UsuarioID    AS usuarioID,
      u.PasswordHash AS passwordHash,
      u.PIN          AS pin,
      u.Nombre       AS nombre,
      u.Apellido     AS apellido,
      u.Usuario      AS usuario,
      r.Nombre       AS rol,
      u.Activo       AS activo
    FROM modu_rest_Usuarios u
    JOIN modu_rest_Roles r ON u.RolID = r.RolID
    WHERE u.Usuario = @usuario
  `, (req) => {
    req.input('usuario', sql.NVarChar, usuario);
  });

  if (rows.length === 0) {
    throw new AppError('Usuario o contraseña incorrectos', 401);
  }

  const user = rows[0];

  if (!user.activo) {
    throw new AppError('Usuario desactivado. Contacte al administrador.', 403);
  }

  const passwordValida = await bcrypt.compare(password, user.passwordHash);
  if (!passwordValida) {
    throw new AppError('Usuario o contraseña incorrectos', 401);
  }

  // Actualizar último acceso
  await query(`
    UPDATE modu_rest_Usuarios
    SET UltimoAcceso = SYSUTCDATETIME()
    WHERE UsuarioID = @id
  `, (req) => {
    req.input('id', sql.UniqueIdentifier, user.usuarioID);
  });

  const payload: UsuarioToken = {
    usuarioID: user.usuarioID,
    nombre:    user.nombre,
    apellido:  user.apellido,
    usuario:   user.usuario,
    rol:       user.rol,
  };

  const token = jwt.sign(payload, env.jwt.secret, {
    expiresIn: env.jwt.expiresIn as any,
  });

  return { token, usuario: payload };
}

// ── Login con PIN ────────────────────────────────────

export async function loginConPIN(
  pin: string
): Promise<{ token: string; usuario: UsuarioToken }> {

  const rows = await query<UsuarioDB>(`
    SELECT
      u.UsuarioID    AS usuarioID,
      u.PasswordHash AS passwordHash,
      u.PIN          AS pin,
      u.Nombre       AS nombre,
      u.Apellido     AS apellido,
      u.Usuario      AS usuario,
      r.Nombre       AS rol,
      u.Activo       AS activo
    FROM modu_rest_Usuarios u
    JOIN modu_rest_Roles r ON u.RolID = r.RolID
    WHERE u.PIN = @pin AND u.Activo = 1
  `, (req) => {
    req.input('pin', sql.NVarChar, pin);
  });

  if (rows.length === 0) {
    throw new AppError('PIN incorrecto', 401);
  }

  const user = rows[0];

  await query(`
    UPDATE modu_rest_Usuarios
    SET UltimoAcceso = SYSUTCDATETIME()
    WHERE UsuarioID = @id
  `, (req) => {
    req.input('id', sql.UniqueIdentifier, user.usuarioID);
  });

  const payload: UsuarioToken = {
    usuarioID: user.usuarioID,
    nombre:    user.nombre,
    apellido:  user.apellido,
    usuario:   user.usuario,
    rol:       user.rol,
  };

  const token = jwt.sign(payload, env.jwt.secret, {
    expiresIn: env.jwt.expiresIn as any,
  });

  return { token, usuario: payload };
}