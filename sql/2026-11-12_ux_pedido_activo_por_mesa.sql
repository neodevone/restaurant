-- 2026-11-12 — Evita que una mesa tenga más de un pedido activo.
--
-- Causa: POST /pedidos concurrentes (0-3 ms entre sí) pasaban todos la
-- verificación "¿la mesa está libre?" antes de que alguno insertara.
-- La API ya lo previene con una transacción + UPDLOCK; este índice es la
-- garantía a nivel de base de datos, por si otro cliente o código escribe
-- directamente en la tabla.
--
-- 1) Verificar que hoy NO haya mesas con más de un pedido activo
--    (si devuelve filas, cancelar los duplicados antes de crear el índice):
SELECT m.Alias, p.MesaID, COUNT(*) AS activos
FROM modu_rest_Pedidos p
JOIN modu_rest_Mesas m ON m.MesaID = p.MesaID
WHERE p.MesaID IS NOT NULL
  AND p.EstadoPedido IN ('Abierto', 'Por Pagar')
GROUP BY m.Alias, p.MesaID
HAVING COUNT(*) > 1;
GO

-- 2) Crear el índice (SET options requeridas para índices filtrados)
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UX_modu_rest_Pedidos_MesaActiva'
    AND object_id = OBJECT_ID('dbo.modu_rest_Pedidos')
)
CREATE UNIQUE NONCLUSTERED INDEX UX_modu_rest_Pedidos_MesaActiva
  ON dbo.modu_rest_Pedidos (MesaID)
  WHERE MesaID IS NOT NULL
    AND EstadoPedido IN ('Abierto', 'Por Pagar');
GO

-- Rollback:
-- DROP INDEX UX_modu_rest_Pedidos_MesaActiva ON dbo.modu_rest_Pedidos;
