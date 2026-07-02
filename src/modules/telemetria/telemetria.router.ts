// src/modules/telemetria/telemetria.router.ts

import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { requireAdmin, requireRol } from '../../middlewares/rol.middleware';
import {
  getDashboard, getMetricasHoy, getVentasPorHora,
  getRendimientoMeseros, getTopArticulos, getVentasPorMetodo,
  getEstadoMesas, getAlertasKDS, getComparativoSemanal
} from './telemetria.controller';

export const telemetriaRouter = Router();

telemetriaRouter.use(authMiddleware);

// Dashboard completo — un solo request para la pantalla del dueño
// ?fecha=2026-02-26 para ver un día específico
telemetriaRouter.get('/dashboard',
  requireAdmin,
  getDashboard
);

// Métricas individuales — para widgets específicos en tiempo real
telemetriaRouter.get('/metricas/hoy',
  requireAdmin,
  getMetricasHoy
);

telemetriaRouter.get('/ventas/horas',
  requireAdmin,
  getVentasPorHora
);

telemetriaRouter.get('/ventas/metodos',
  requireAdmin,
  getVentasPorMetodo
);

telemetriaRouter.get('/ventas/semanal',
  requireAdmin,
  getComparativoSemanal
);

telemetriaRouter.get('/meseros',
  requireAdmin,
  getRendimientoMeseros
);

telemetriaRouter.get('/articulos/top',
  requireAdmin,
  getTopArticulos
);

// Estado de mesas — admin y cajero lo ven
telemetriaRouter.get('/mesas/estado',
  requireRol('Administrador', 'Cajero'),
  getEstadoMesas
);

// Alertas KDS activas — comandas en amarillo o rojo
telemetriaRouter.get('/alertas/kds',
  requireAdmin,
  getAlertasKDS
);