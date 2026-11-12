// src/shared/fechas.ts
//
// Las columnas de fecha se guardan en UTC (DEFAULT SYSUTCDATETIME()),
// pero el "día" del negocio es el de Colombia. Comparar
// CAST(col AS DATE) = CAST(SYSUTCDATETIME() AS DATE) corta el día a las
// 7 p. m. hora local: el consecutivo de pedidos volvía a 1 y los filtros
// "del día" mezclaban la noche con el día siguiente.
//
// Estos helpers arman fragmentos SQL. Los filtros se expresan como
// RANGO sobre la columna UTC (col >= inicio AND col < fin) y no como
// CAST(col ...) para que SQL Server pueda usar el índice de la columna.
//
// Por qué desfase fijo y no AT TIME ZONE: Colombia es UTC-5 todo el año
// (sin horario de verano desde 1993). Con AT TIME ZONE el optimizador no
// puede estimar el rango y recorre la tabla entera (Clustered Index Scan);
// con DATEADD hace Index Seek sobre IX_modu_rest_Pedidos_Fecha. Importa
// porque el consecutivo se calcula con UPDLOCK + HOLDLOCK: un scan
// bloquearía toda la tabla en cada apertura de pedido.

/** Horas a sumar a UTC para obtener la hora de Colombia. */
export const OFFSET_HORAS_NEGOCIO = -5;

/**
 * Hoy en Colombia como 'YYYY-MM-DD', calculado en JS.
 * new Date().toISOString().split('T')[0] da la fecha UTC: después de las
 * 7 p. m. devolvía el día siguiente y los reportes "de hoy" salían vacíos.
 */
export function hoyLocal(ahora: Date = new Date()): string {
  return new Date(ahora.getTime() + OFFSET_HORAS_NEGOCIO * 3_600_000)
    .toISOString().split('T')[0];
}

/** Fecha local (DATE) de una expresión guardada en UTC. */
export const fechaLocal = (exprUtc: string): string =>
  `CAST(DATEADD(HOUR, ${OFFSET_HORAS_NEGOCIO}, ${exprUtc}) AS DATE)`;

/** Hoy, en fecha local de Colombia. */
export const HOY_LOCAL = fechaLocal('SYSUTCDATETIME()');

/** Instante UTC (DATETIME2) en que empieza el día local `fechaExpr` (DATE). */
export const inicioDiaLocalUtc = (fechaExpr: string): string =>
  `DATEADD(HOUR, ${-OFFSET_HORAS_NEGOCIO}, CAST(${fechaExpr} AS DATETIME2))`;

/** `colUtc` cae dentro del día local `fechaExpr`. */
export const enDiaLocal = (colUtc: string, fechaExpr: string): string =>
  `(${colUtc} >= ${inicioDiaLocalUtc(fechaExpr)} AND ${colUtc} < ${inicioDiaLocalUtc(`DATEADD(DAY, 1, ${fechaExpr})`)})`;

/** `colUtc` cae entre los días locales `desdeExpr` y `hastaExpr`, ambos incluidos. */
export const entreDiasLocales = (colUtc: string, desdeExpr: string, hastaExpr: string): string =>
  `(${colUtc} >= ${inicioDiaLocalUtc(desdeExpr)} AND ${colUtc} < ${inicioDiaLocalUtc(`DATEADD(DAY, 1, ${hastaExpr})`)})`;
