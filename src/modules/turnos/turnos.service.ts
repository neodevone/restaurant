// src/modules/turnos/turnos.service.ts
// ── Este archivo ya NO se usa ──
// TurnosCaja fue eliminado del sistema simplificado.
// Se mantiene el archivo vacío para no romper imports existentes.
// Puedes eliminar este archivo y el módulo turnos completo.

export async function obtenerTurnoAbierto(_usuarioID: string) {
  // Ya no se valida turno — cualquier usuario autenticado puede cobrar
  return { turnoID: null };
}