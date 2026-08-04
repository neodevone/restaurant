// src/modules/comandas/comandas.controller.ts
//
// Se quitaron los endpoints del KDS (vista, en-preparación, lista,
// prioridad, nota) porque el service ya no los exportaba y el módulo
// no compilaba. La cocina no participa en el flujo: el pedido se pide
// de viva voz y el mesero confirma la entrega.

import { Request, Response, NextFunction } from 'express';
import { respond } from '../../shared/response.helper';
import {
  obtenerComanda, obtenerItemsComanda, historialComandasPedido,
  marcarDespachada, marcarPedidoEntregado, comandasPendientesPedido
} from './comandas.service';

export async function getComanda(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await obtenerComanda(req.params.id as string);
    respond.ok(res, data);
  } catch (err) { next(err); }
}

export async function getItemsComanda(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await obtenerItemsComanda(req.params.id as string);
    respond.ok(res, data);
  } catch (err) { next(err); }
}

export async function getHistorialPedido(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await historialComandasPedido(req.params.pedidoID as string);
    respond.ok(res, data);
  } catch (err) { next(err); }
}

// GET /comandas/pedido/:pedidoID/pendientes
// El escritorio lo usa para saber si habilita el botón de cobro.
export async function getPendientesPedido(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const pendientes = await comandasPendientesPedido(
      req.params.pedidoID as string);
    respond.ok(res, {
      pendientes,
      entregado: pendientes === 0,
    });
  } catch (err) { next(err); }
}

// POST /comandas/:id/despachada
// El mesero entregó UNA ronda en la mesa.
export async function postMarcarDespachada(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await marcarDespachada(
      req.params.id as string,
      req.usuario!.usuarioID
    );
    respond.ok(res, data,
      `Ronda ${data.numeroRonda} entregada en ${data.mesaAlias ?? 'la mesa'}`);
  } catch (err) { next(err); }
}

// POST /comandas/pedido/:pedidoID/entregado
// El mesero entregó TODO lo que faltaba del pedido.
export async function postMarcarPedidoEntregado(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const data = await marcarPedidoEntregado(
      req.params.pedidoID as string,
      req.usuario!.usuarioID
    );
    respond.ok(res, data,
      data.rondasEntregadas === 1
        ? 'Pedido entregado en la mesa'
        : `${data.rondasEntregadas} rondas entregadas en la mesa`);
  } catch (err) { next(err); }
}