// APIルート定義 - マルチテナント対応

import { Hono } from 'hono';
import { Env, ContentGenerationRequest, ApiResponse } from '../types';
import { Database } from '../db/database';
import { AuthService } from '../auth/auth';
import { AuthMiddleware } from '../auth/middleware';
import { ContentGenerationService } from '../services/content-generator';
import { LegalCheckService } from '../services/legal-checker';

export function createApiRoutes(): Hono<{ Bindings: Env }> {
  const api = new Hono<{ Bindings: Env }>();
  
  // ミドルウェアでサービス初期化
  api.use('*', async (c, next) => {
    const env = c.env;
    
    // サービス初期化
    const db = new Database(env.DB);
    const authService = new AuthService(db, env.JWT_SECRET);
    const authMiddleware = new AuthMiddleware(authService);
    const contentGenerator = new ContentGenerationService(db, env.AI, env.OPENAI_API_KEY);
    const legalChecker = new LegalCheckService(db);
    
    // コンテキストに設定
    c.set('db', db);
    c.set('authService', authService);
    c.set('authMiddleware', authMiddleware);
    c.set('contentGenerator', contentGenerator);
    c.set('legalChecker', legalChecker);
    
    await next();
  });

  // 共通ミドルウェア
  api.use('*', authMiddleware.cors());
  api.use('*', authMiddleware.securityHeaders());
  api.use('*', authMiddleware.requestLogger());
  api.use('*', authMiddleware.rateLimit(200, 60000)); // 200 requests per minute

  // 認証エンドポイント
  api.post('/auth/login', async (c) => {
    try {
      const { email, tenant_id } = await c.req.json();
      
      if (!email || !tenant_id) {
        return c.json<ApiResponse>({ 
          success: false, 
          error: 'Email and tenant_id are required' 
        }, 400);
      }

      const authContext = await authService.authenticateUser(email, tenant_id);
      
      // セッションCookie設定
      c.cookie('session_token', authContext.session.token_hash, {
        maxAge: 24 * 60 * 60, // 24 hours
        httpOnly: true,
        secure: true,
        sameSite: 'strict'
      });

      return c.json<ApiResponse>({
        success: true,
        data: {
          user: {
            id: authContext.user.id,
            email: authContext.user.email,
            name: authContext.user.name,
            role: authContext.user.role_internal
          },
          tenant: {
            id: authContext.tenant.id,
            name: authContext.tenant.name,
            security_level: authContext.tenant.security_level
          },
          permissions: authContext.permissions
        }
      });
    } catch (error) {
      console.error('Login error:', error);
      return c.json<ApiResponse>({ 
        success: false, 
        error: 'Login failed' 
      }, 401);
    }
  });

  api.post('/auth/logout', authMiddleware.requireAuth(), async (c) => {
    try {
      const auth = c.get('auth')!;
      await authService.logout(auth.session.id);
      
      // Cookie削除
      c.cookie('session_token', '', {
        maxAge: 0,
        httpOnly: true,
        secure: true,
        sameSite: 'strict'
      });

      return c.json<ApiResponse>({ success: true });
    } catch (error) {
      console.error('Logout error:', error);
      return c.json<ApiResponse>({ 
        success: false, 
        error: 'Logout failed' 
      }, 500);
    }
  });

  // プロフィール取得
  api.get('/auth/profile', authMiddleware.requireAuth(), async (c) => {
    const auth = c.get('auth')!;
    return c.json<ApiResponse>({
      success: true,
      data: {
        user: {
          id: auth.user.id,
          email: auth.user.email,
          name: auth.user.name,
          role_internal: auth.user.role_internal,
          role_client: auth.user.role_client,
          role_saas: auth.user.role_saas
        },
        tenant: {
          id: auth.tenant.id,
          name: auth.tenant.name,
          security_level: auth.tenant.security_level
        },
        permissions: auth.permissions
      }
    });
  });

  // テンプレート管理
  api.get('/templates', authMiddleware.requireAuth(), async (c) => {
    try {
      const templates = await db.getIndustryTemplates();
      
      // カテゴリ別にグループ化
      const grouped = {
        industries: templates.filter(t => t.category === 'industry'),
        growth_stages: templates.filter(t => t.category === 'growth_stage'),
        channels: templates.filter(t => t.category === 'channel')
      };

      return c.json<ApiResponse>({
        success: true,
        data: grouped
      });
    } catch (error) {
      console.error('Templates fetch error:', error);
      return c.json<ApiResponse>({ 
        success: false, 
        error: 'Failed to fetch templates' 
      }, 500);
    }
  });

  api.get('/templates/:category', authMiddleware.requireAuth(), async (c) => {
    try {
      const category = c.req.param('category') as 'industry' | 'growth_stage' | 'channel';
      const templates = await db.getTemplatesByCategory(category);

      return c.json<ApiResponse>({
        success: true,
        data: templates
      });
    } catch (error) {
      console.error('Templates by category fetch error:', error);
      return c.json<ApiResponse>({ 
        success: false, 
        error: 'Failed to fetch templates' 
      }, 500);
    }
  });

  // コンテンツ生成
  api.post('/content/generate', 
    authMiddleware.requireAuth(),
    authMiddleware.requirePermission('create:content'),
    async (c) => {
      try {
        const auth = c.get('auth')!;
        const request: ContentGenerationRequest = await c.req.json();

        if (!request.prompt) {
          return c.json<ApiResponse>({ 
            success: false, 
            error: 'Prompt is required' 
          }, 400);
        }

        const result = await contentGenerator.generateContent(
          auth.tenant.id,
          auth.user.id,
          request
        );

        // 法令チェック実行（非同期）
        legalChecker.checkContent(result.id, result.generated_content)
          .catch(error => console.error('Legal check error:', error));

        return c.json<ApiResponse>({
          success: true,
          data: result
        });
      } catch (error) {
        console.error('Content generation error:', error);
        return c.json<ApiResponse>({ 
          success: false, 
          error: 'Content generation failed' 
        }, 500);
      }
    }
  );

  // バッチコンテンツ生成
  api.post('/content/generate-batch',
    authMiddleware.requireAuth(),
    authMiddleware.requirePermission('create:content'),
    async (c) => {
      try {
        const auth = c.get('auth')!;
        const { requests }: { requests: ContentGenerationRequest[] } = await c.req.json();

        if (!requests || requests.length === 0) {
          return c.json<ApiResponse>({ 
            success: false, 
            error: 'Requests array is required' 
          }, 400);
        }

        if (requests.length > 10) {
          return c.json<ApiResponse>({ 
            success: false, 
            error: 'Maximum 10 requests per batch' 
          }, 400);
        }

        const results = await contentGenerator.generateBatch(
          auth.tenant.id,
          auth.user.id,
          requests
        );

        return c.json<ApiResponse>({
          success: true,
          data: results,
          metadata: {
            total_count: results.length
          }
        });
      } catch (error) {
        console.error('Batch content generation error:', error);
        return c.json<ApiResponse>({ 
          success: false, 
          error: 'Batch content generation failed' 
        }, 500);
      }
    }
  );

  // コンテンツ履歴取得
  api.get('/content/history', authMiddleware.requireAuth(), async (c) => {
    try {
      const auth = c.get('auth')!;
      const limit = Number(c.req.query('limit')) || 20;
      const offset = Number(c.req.query('offset')) || 0;

      const contents = await db.getContentGenerations(auth.tenant.id, limit, offset);

      return c.json<ApiResponse>({
        success: true,
        data: contents,
        metadata: {
          total_count: contents.length,
          limit,
          offset,
          tenant_id: auth.tenant.id
        }
      });
    } catch (error) {
      console.error('Content history fetch error:', error);
      return c.json<ApiResponse>({ 
        success: false, 
        error: 'Failed to fetch content history' 
      }, 500);
    }
  });

  // 特定コンテンツ取得
  api.get('/content/:id', authMiddleware.requireAuth(), async (c) => {
    try {
      const auth = c.get('auth')!;
      const contentId = c.req.param('id');

      const content = await db.getContentGeneration(contentId, auth.tenant.id);
      
      if (!content) {
        return c.json<ApiResponse>({ 
          success: false, 
          error: 'Content not found' 
        }, 404);
      }

      // 法令チェック結果も取得
      const legalResults = await db.getLegalCheckResults(contentId);

      return c.json<ApiResponse>({
        success: true,
        data: {
          content,
          legal_check_results: legalResults
        }
      });
    } catch (error) {
      console.error('Content fetch error:', error);
      return c.json<ApiResponse>({ 
        success: false, 
        error: 'Failed to fetch content' 
      }, 500);
    }
  });

  // コンテンツ承認
  api.post('/content/:id/approve',
    authMiddleware.requireAuth(),
    authMiddleware.requirePermission('approve:content'),
    async (c) => {
      try {
        const auth = c.get('auth')!;
        const contentId = c.req.param('id');

        await db.updateContentGenerationStatus(
          contentId,
          auth.tenant.id,
          'approved',
          auth.user.id
        );

        return c.json<ApiResponse>({
          success: true,
          message: 'Content approved successfully'
        });
      } catch (error) {
        console.error('Content approval error:', error);
        return c.json<ApiResponse>({ 
          success: false, 
          error: 'Failed to approve content' 
        }, 500);
      }
    }
  );

  // 法令チェック結果取得
  api.get('/content/:id/legal-check', authMiddleware.requireAuth(), async (c) => {
    try {
      const contentId = c.req.param('id');
      const legalResults = await db.getLegalCheckResults(contentId);
      const overallRisk = await legalChecker.getOverallRisk(contentId);

      return c.json<ApiResponse>({
        success: true,
        data: {
          results: legalResults,
          overall_risk: overallRisk
        }
      });
    } catch (error) {
      console.error('Legal check fetch error:', error);
      return c.json<ApiResponse>({ 
        success: false, 
        error: 'Failed to fetch legal check results' 
      }, 500);
    }
  });

  // 手動法令チェック実行
  api.post('/content/:id/legal-check',
    authMiddleware.requireAuth(),
    authMiddleware.requireAnyPermission(['read:legal_checks', 'manage:legal_checks']),
    async (c) => {
      try {
        const auth = c.get('auth')!;
        const contentId = c.req.param('id');

        const content = await db.getContentGeneration(contentId, auth.tenant.id);
        if (!content) {
          return c.json<ApiResponse>({ 
            success: false, 
            error: 'Content not found' 
          }, 404);
        }

        const legalResults = await legalChecker.checkContent(contentId, content.generated_content);
        const overallRisk = await legalChecker.getOverallRisk(contentId);

        return c.json<ApiResponse>({
          success: true,
          data: {
            results: legalResults,
            overall_risk: overallRisk
          }
        });
      } catch (error) {
        console.error('Manual legal check error:', error);
        return c.json<ApiResponse>({ 
          success: false, 
          error: 'Legal check failed' 
        }, 500);
      }
    }
  );

  // ヘルスチェック
  api.get('/health', async (c) => {
    return c.json<ApiResponse>({
      success: true,
      data: {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0-phase0'
      }
    });
  });

  return api;
}