import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-workers'
import { setCookie, getCookie } from 'hono/cookie'
import { renderer } from './renderer'
import { createApiRoutes } from './routes/api'
import { Env } from './types'

const app = new Hono<{ Bindings: Env }>()

// セキュリティヘッダー
app.use('*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
  c.header('X-XSS-Protection', '1; mode=block')
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  await next()
})

// 静的ファイル配信
app.use('/static/*', serveStatic({ root: './public' }))

// サービス初期化ミドルウェア
app.use('/api/*', async (c, next) => {
  const env = c.env;
  
  const db = new Database(env.DB);
  const authService = new AuthService(db, env.JWT_SECRET || 'dev-secret');
  const authMiddleware = new AuthMiddleware(authService);
  const contentGenerator = new ContentGenerationService(db, env.AI, env.OPENAI_API_KEY);
  const legalChecker = new LegalCheckService(db);
  
  c.set('db', db);
  c.set('authService', authService);
  c.set('authMiddleware', authMiddleware);
  c.set('contentGenerator', contentGenerator);
  c.set('legalChecker', legalChecker);
  
  await next();
});

// 必要なインポートを追加
import { Database } from './db/database';
import { AuthService } from './auth/auth';
import { AuthMiddleware } from './auth/middleware';
import { ContentGenerationService } from './services/content-generator';
import { LegalCheckService } from './services/legal-checker';

// APIエンドポイント
app.get('/api/health', async (c) => {
  return c.json({
    success: true,
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0-phase0'
    }
  });
});

app.post('/api/auth/login', async (c) => {
  try {
    const { email, tenant_id } = await c.req.json();
    
    if (!email || !tenant_id) {
      return c.json({ 
        success: false, 
        error: 'Email and tenant_id are required' 
      }, 400);
    }

    const authService = c.get('authService') as AuthService;
    if (!authService) {
      console.error('AuthService not initialized');
      return c.json({ 
        success: false, 
        error: 'AuthService not available' 
      }, 500);
    }

    console.log(`Login attempt: ${email} @ ${tenant_id}`);
    const authContext = await authService.authenticateUser(email, tenant_id);
    
    // セッションCookie設定
    setCookie(c, 'session_token', authContext.session.token_hash, {
      maxAge: 24 * 60 * 60, // 24 hours
      httpOnly: true,
      secure: false, // ローカル開発用
      sameSite: 'Lax'
    });

    console.log(`Login successful for user: ${authContext.user.id}`);
    
    return c.json({
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
    console.error('Login error details:', error);
    return c.json({ 
      success: false, 
      error: error.message || 'Login failed',
      debug: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, 401);
  }
});

app.get('/api/auth/profile', async (c) => {
  try {
    const token = getCookie(c, 'session_token');
    
    if (!token) {
      return c.json({ 
        success: false, 
        error: 'No session token' 
      }, 401);
    }

    const authService = c.get('authService') as AuthService;
    const authContext = await authService.validateSession(token);
    
    if (!authContext) {
      return c.json({ 
        success: false, 
        error: 'Invalid session' 
      }, 401);
    }

    return c.json({
      success: true,
      data: {
        user: {
          id: authContext.user.id,
          email: authContext.user.email,
          name: authContext.user.name,
          role_internal: authContext.user.role_internal,
          role_client: authContext.user.role_client,
          role_saas: authContext.user.role_saas
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
    console.error('Profile fetch error:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to fetch profile' 
    }, 500);
  }
});

app.get('/api/templates', async (c) => {
  try {
    const db = c.get('db') as Database;
    const templates = await db.getIndustryTemplates();
    
    const grouped = {
      industries: templates.filter(t => t.category === 'industry'),
      growth_stages: templates.filter(t => t.category === 'growth_stage'),
      channels: templates.filter(t => t.category === 'channel')
    };

    return c.json({
      success: true,
      data: grouped
    });
  } catch (error) {
    console.error('Templates fetch error:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to fetch templates' 
    }, 500);
  }
});

app.post('/api/content/generate', async (c) => {
  try {
    const token = getCookie(c, 'session_token');
    
    if (!token) {
      return c.json({ 
        success: false, 
        error: 'Authentication required' 
      }, 401);
    }

    const authService = c.get('authService') as AuthService;
    const authContext = await authService.validateSession(token);
    
    if (!authContext) {
      return c.json({ 
        success: false, 
        error: 'Invalid session' 
      }, 401);
    }

    const { prompt, industry_id, growth_stage_id, channel_id } = await c.req.json();
    
    if (!prompt) {
      return c.json({ 
        success: false, 
        error: 'Prompt is required' 
      }, 400);
    }

    const contentGenerator = c.get('contentGenerator') as ContentGenerationService;
    const result = await contentGenerator.generateContent(
      authContext.tenant.id,
      authContext.user.id,
      { prompt, industry_id, growth_stage_id, channel_id }
    );

    // 法令チェック実行（非同期）
    const legalChecker = c.get('legalChecker') as LegalCheckService;
    legalChecker.checkContent(result.id, result.generated_content)
      .catch(error => console.error('Legal check error:', error));

    return c.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Content generation error:', error);
    return c.json({ 
      success: false, 
      error: 'Content generation failed' 
    }, 500);
  }
});

// レンダラー設定
app.use(renderer)

// メインページ
app.get('/', (c) => {
  return c.render(
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <div className="text-2xl font-bold text-blue-600">
                <i className="fas fa-robot mr-2"></i>
                BGA Marketing AI
              </div>
              <span className="px-3 py-1 text-xs font-semibold text-blue-700 bg-blue-100 rounded-full">
                Phase 0 MVP
              </span>
            </div>
            <div className="flex items-center space-x-4">
              <button id="loginBtn" className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">
                <i className="fas fa-sign-in-alt mr-2"></i>
                ログイン
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* メインコンテンツ */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* ヒーローセクション */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            生成AI活用 B2Bデジタルマーケティング自動化
          </h1>
          <p className="text-xl text-gray-600 mb-8">
            「誰でも90秒で効果把握」「3クリックで実施」× 法令チェックの新体験
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            <div className="bg-white p-6 rounded-lg shadow-md">
              <div className="text-3xl text-green-600 mb-3">⚡</div>
              <h3 className="text-lg font-semibold mb-2">生産性向上</h3>
              <p className="text-gray-600">マーケティング業務工数を最大70%削減</p>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-md">
              <div className="text-3xl text-red-600 mb-3">🛡️</div>
              <h3 className="text-lg font-semibold mb-2">リスク軽減</h3>
              <p className="text-gray-600">景表法・薬機法等の法令違反を自動検知</p>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-md">
              <div className="text-3xl text-blue-600 mb-3">📈</div>
              <h3 className="text-lg font-semibold mb-2">ROI向上</h3>
              <p className="text-gray-600">データ駆動によるマーケティング効果最大化</p>
            </div>
          </div>
        </div>

        {/* 機能紹介 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
          {/* コンテンツ生成 */}
          <div className="bg-white p-8 rounded-lg shadow-md">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              <i className="fas fa-magic mr-3 text-purple-600"></i>
              AIコンテンツ生成
            </h2>
            <ul className="space-y-3 text-gray-600">
              <li className="flex items-center">
                <i className="fas fa-check text-green-500 mr-3"></i>
                5業界 × 3成長ステージ × 4チャネル対応
              </li>
              <li className="flex items-center">
                <i className="fas fa-check text-green-500 mr-3"></i>
                日本特化LocalePack搭載
              </li>
              <li className="flex items-center">
                <i className="fas fa-check text-green-500 mr-3"></i>
                季節性・文化的文脈を自動考慮
              </li>
            </ul>
            <button id="generateBtn" className="mt-6 w-full bg-purple-600 text-white py-3 rounded-lg hover:bg-purple-700 transition-colors">
              コンテンツ生成を試す
            </button>
          </div>

          {/* 法令チェック */}
          <div className="bg-white p-8 rounded-lg shadow-md">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              <i className="fas fa-shield-alt mr-3 text-red-600"></i>
              法令チェック
            </h2>
            <ul className="space-y-3 text-gray-600">
              <li className="flex items-center">
                <i className="fas fa-check text-green-500 mr-3"></i>
                景表法・薬機法・金商法対応
              </li>
              <li className="flex items-center">
                <i className="fas fa-check text-green-500 mr-3"></i>
                5段階リスクレベル評価
              </li>
              <li className="flex items-center">
                <i className="fas fa-check text-green-500 mr-3"></i>
                修正提案と法的根拠の提示
              </li>
            </ul>
            <button id="checkBtn" className="mt-6 w-full bg-red-600 text-white py-3 rounded-lg hover:bg-red-700 transition-colors">
              法令チェックを実行
            </button>
          </div>
        </div>

        {/* 統計情報 */}
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-8 rounded-lg mb-12">
          <div className="text-center">
            <h2 className="text-2xl font-bold mb-6">Phase 0 社内MVP統計</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div>
                <div className="text-3xl font-bold">70%</div>
                <div className="text-sm opacity-90">業務工数削減</div>
              </div>
              <div>
                <div className="text-3xl font-bold">90秒</div>
                <div className="text-sm opacity-90">効果把握時間</div>
              </div>
              <div>
                <div className="text-3xl font-bold">3クリック</div>
                <div className="text-sm opacity-90">実施までの操作</div>
              </div>
              <div>
                <div className="text-3xl font-bold">0件</div>
                <div className="text-sm opacity-90">法令違反発生</div>
              </div>
            </div>
          </div>
        </div>

        {/* ダッシュボード（認証後表示） */}
        <div id="dashboard" className="hidden">
          <div className="bg-white p-8 rounded-lg shadow-md">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">マーケティング ダッシュボード</h2>
            <div id="dashboardContent">
              {/* JavaScript で動的に生成 */}
            </div>
          </div>
        </div>
      </main>

      {/* フッター */}
      <footer className="bg-gray-800 text-white py-8 mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p>&copy; 2025 BGA株式会社 & Apoptosis株式会社. All rights reserved.</p>
          <p className="text-gray-400 mt-2">生成AI活用 B2Bデジタルマーケティング自動化SaaS - Phase 0 MVP</p>
        </div>
      </footer>
    </div>
  )
})

// ダッシュボードページ
app.get('/dashboard', (c) => {
  return c.render(
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">ダッシュボード</h1>
        <div id="app">
          {/* React/Vue.js などのフロントエンドアプリケーションがマウントされる */}
        </div>
      </div>
    </div>
  )
})

// 404ページ
app.notFound((c) => {
  return c.render(
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-gray-900 mb-4">404</h1>
        <p className="text-xl text-gray-600 mb-8">ページが見つかりません</p>
        <a href="/" className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors">
          ホームに戻る
        </a>
      </div>
    </div>
  )
})

export default app
