// src/shared/urlPublica.ts
//
// URLs públicas de archivos servidos por la API (imágenes de productos).
//
// En la BD se guarda solo la RUTA ("/imagenes/articulos/1.jpg?v=...") y el
// dominio se agrega al responder. Antes se guardaba la URL completa con el
// dominio del momento (https://restaurant.alyneos.com/...): al cambiar de
// dominio todas las imágenes quedaban apuntando al viejo.
//
// El dominio sale de PUBLIC_URL en el .env (p. ej. https://api.krocobroaster.com)
// o, si no está, de la propia petición. Detrás de Cloudflare Tunnel la API
// recibe http: app.ts activa 'trust proxy' para que req.protocol respete el
// X-Forwarded-Proto: https que manda cloudflared.

import { Request } from 'express';
import { env } from '../config/environment';

/** Deja solo la ruta: quita esquema y dominio si los trae (filas viejas). */
export function rutaRelativa(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /^https?:\/\/[^/]+(\/.*)$/i.exec(url.trim());
  return m ? m[1] : url.trim();
}

/** Base pública de la API, sin "/" final. */
export function basePublica(req: Request): string {
  if (env.publicUrl) return env.publicUrl.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

/** URL absoluta lista para la app y el escritorio. */
export function urlPublica(req: Request, url: string | null | undefined): string | null {
  const ruta = rutaRelativa(url);
  if (!ruta) return null;
  return `${basePublica(req)}${ruta.startsWith('/') ? '' : '/'}${ruta}`;
}
