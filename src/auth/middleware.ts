// 認証ミドルウェア - Honoベース実装

import { Context, Next } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { Env, AuthContext } from '../types';
import { Database } from '../db/database';
import { AuthService } from './auth';

// 認証コンテキストをHonoのContextに追加
declare module 'hono' {
  interface ContextVariableMap {
    auth?: AuthContext;
    db?: any;
    authService?: any;
    authMiddleware?: any;
    contentGenerator?: any;
    legalChecker?: any;
  }
}

export class AuthMiddleware {
  constructor(private authService: AuthService) {}

  // テナント識別ミドルウェア
  tenantIdentification() {
    return async (c: Context<{ Bindings: Env }>, next: Next) => {
      try {
        const host = c.req.header('host') || 'localhost';
        const tenant = await this.authService.identifyTenant(host);
        
        if (!tenant) {
          return c.json({ error: 'Tenant not found' }, 404);
        }

        // テナント情報をコンテキストに保存
        c.set('tenant', tenant);
        await next();
      } catch (error) {
        console.error('Tenant identification error:', error);
        return c.json({ error: 'Tenant identification failed' }, 500);
      }
    };
  }

  // 認証必須ミドルウェア
  requireAuth() {
    return async (c: Context<{ Bindings: Env }>, next: Next) => {
      try {
        // セッショントークンをCookieから取得
        const token = getCookie(c, 'session_token');
        
        if (!token) {
          return c.json({ error: 'Authentication required' }, 401);
        }

        // セッション検証
        const authContext = await this.authService.validateSession(token);
        
        if (!authContext) {
          // 無効なセッション - Cookieを削除
          setCookie(c, 'session_token', '', {
            maxAge: 0,
            httpOnly: true,
            secure: true,
            sameSite: 'strict'
          });
          return c.json({ error: 'Invalid session' }, 401);
        }

        // 認証コンテキストを設定
        c.set('auth', authContext);
        await next();
      } catch (error) {
        console.error('Authentication error:', error);
        return c.json({ error: 'Authentication failed' }, 500);
      }
    };
  }

  // 権限チェックミドルウェア
  requirePermission(permission: string) {
    return async (c: Context<{ Bindings: Env }>, next: Next) => {
      const auth = c.get('auth');
      
      if (!auth) {
        return c.json({ error: 'Authentication required' }, 401);
      }

      if (!this.authService.hasPermission(auth.permissions, permission)) {
        return c.json({ error: 'Insufficient permissions' }, 403);
      }

      await next();
    };
  }

  // 複数権限チェック（いずれかが必要）
  requireAnyPermission(permissions: string[]) {
    return async (c: Context<{ Bindings: Env }>, next: Next) => {
      const auth = c.get('auth');
      
      if (!auth) {
        return c.json({ error: 'Authentication required' }, 401);
      }

      const hasAnyPermission = permissions.some(permission => 
        this.authService.hasPermission(auth.permissions, permission)
      );

      if (!hasAnyPermission) {
        return c.json({ error: 'Insufficient permissions' }, 403);
      }

      await next();
    };
  }

  // セキュリティレベルチェック
  requireSecurityLevel(level: 'internal' | 'client' | 'saas') {
    return async (c: Context<{ Bindings: Env }>, next: Next) => {
      const auth = c.get('auth');
      
      if (!auth) {
        return c.json({ error: 'Authentication required' }, 401);
      }

      if (!this.authService.checkSecurityLevel(auth.tenant, level)) {
        return c.json({ error: 'Insufficient security level' }, 403);
      }

      await next();
    };
  }

  // オプショナル認証（ログインしていればコンテキストに設定）
  optionalAuth() {
    return async (c: Context<{ Bindings: Env }>, next: Next) => {
      try {
        const token = getCookie(c, 'session_token');
        
        if (token) {
          const authContext = await this.authService.validateSession(token);
          if (authContext) {
            c.set('auth', authContext);
          }
        }
        
        await next();
      } catch (error) {
        console.error('Optional auth error:', error);
        // エラーが発生してもリクエストは続行
        await next();
      }
    };
  }

  // CORS対応
  cors() {
    return async (c: Context<{ Bindings: Env }>, next: Next) => {
      const origin = c.req.header('origin');
      
      // 許可するオリジンのチェック（本番環境では厳密に設定）
      const allowedOrigins = [
        'http://localhost:3000',
        'https://localhost:3000',
        // 本番ドメインを追加
      ];

      if (origin && (allowedOrigins.includes(origin) || origin.endsWith('.pages.dev'))) {
        c.header('Access-Control-Allow-Origin', origin);
      }

      c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
      c.header('Access-Control-Allow-Credentials', 'true');
      c.header('Access-Control-Max-Age', '86400');

      if (c.req.method === 'OPTIONS') {
        return c.text('', 200);
      }

      await next();
    };
  }

  // レート制限（簡易版）
  rateLimit(maxRequests: number = 100, windowMs: number = 60000) {
    const requests = new Map<string, { count: number; resetTime: number }>();

    return async (c: Context<{ Bindings: Env }>, next: Next) => {
      const clientIP = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
      const now = Date.now();
      
      const clientData = requests.get(clientIP);
      
      if (!clientData || now > clientData.resetTime) {
        requests.set(clientIP, { count: 1, resetTime: now + windowMs });
      } else {
        clientData.count++;
        
        if (clientData.count > maxRequests) {
          return c.json({ error: 'Rate limit exceeded' }, 429);
        }
      }

      await next();
    };
  }

  // セキュリティヘッダー
  securityHeaders() {
    return async (c: Context<{ Bindings: Env }>, next: Next) => {
      c.header('X-Content-Type-Options', 'nosniff');
      c.header('X-Frame-Options', 'DENY');
      c.header('X-XSS-Protection', '1; mode=block');
      c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
      c.header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.jsdelivr.net; img-src 'self' data: https:;");
      
      await next();
    };
  }

  // リクエストログ
  requestLogger() {
    return async (c: Context<{ Bindings: Env }>, next: Next) => {
      const start = Date.now();
      const method = c.req.method;
      const path = c.req.path;
      const userAgent = c.req.header('user-agent') || 'unknown';
      const clientIP = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
      
      await next();
      
      const duration = Date.now() - start;
      const status = c.res.status;
      
      // 本番環境では適切なログサービスに送信
      console.log(`${method} ${path} ${status} ${duration}ms - ${clientIP} - ${userAgent}`);
    };
  }
}