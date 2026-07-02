// src/modules/auth/auth.router.ts

import { Router } from 'express';
import { login, loginPIN, me } from './auth.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';

export const authRouter = Router();

// Rutas públicas — no requieren token
authRouter.post('/login',     login);
authRouter.post('/login-pin', loginPIN);  // Para tablets en sala

// Rutas protegidas
authRouter.get('/me', authMiddleware, me);