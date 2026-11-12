-- 2026-11-13 — Identificador de envío en las comandas (idempotencia).
--
-- La app genera un idEnvio (UUID) cada vez que el mesero toca "Enviar" y
-- lo reutiliza en los reintentos de ese mismo envío (timeout, mala señal,
-- doble toque). La API guarda ese idEnvio en la comanda que crea; si llega
-- otra vez, responde con lo que ya quedó registrado en vez de duplicar.
--
-- Clientes que no mandan idEnvio (escritorio, versiones viejas de la app)
-- dejan la columna en NULL y no se ven afectados.
--
-- Orden de despliegue: da igual. Si la API nueva corre sin esta columna,
-- ignora el idEnvio (lo revisa cada minuto) y sigue funcionando como antes.
--
-- Ejecutar con sqlcmd usando -I (QUOTED_IDENTIFIER ON), igual que el
-- script del índice UX_modu_rest_Pedidos_MesaActiva.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
GO

-- 1) Columna (nullable: las comandas existentes quedan en NULL, sin reescribir datos)
IF COL_LENGTH('dbo.modu_rest_Comandas', 'IdEnvio') IS NULL
  ALTER TABLE dbo.modu_rest_Comandas ADD IdEnvio UNIQUEIDENTIFIER NULL;
GO

-- 2) Índice único filtrado: un mismo envío nunca crea dos comandas
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UX_modu_rest_Comandas_IdEnvio'
    AND object_id = OBJECT_ID('dbo.modu_rest_Comandas')
)
CREATE UNIQUE NONCLUSTERED INDEX UX_modu_rest_Comandas_IdEnvio
  ON dbo.modu_rest_Comandas (IdEnvio)
  WHERE IdEnvio IS NOT NULL;
GO

-- Verificación
SELECT COL_LENGTH('dbo.modu_rest_Comandas', 'IdEnvio') AS columna_bytes,
       (SELECT COUNT(*) FROM sys.indexes WHERE name = 'UX_modu_rest_Comandas_IdEnvio') AS indice;
GO

-- Rollback:
-- DROP INDEX UX_modu_rest_Comandas_IdEnvio ON dbo.modu_rest_Comandas;
-- ALTER TABLE dbo.modu_rest_Comandas DROP COLUMN IdEnvio;
