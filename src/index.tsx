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
  const contentAutomation = new ContentAutomationService(db, contentGenerator);
  const contentDelivery = new ContentDeliveryService(db, contentAutomation);
  
  c.set('db', db);
  c.set('authService', authService);
  c.set('authMiddleware', authMiddleware);
  c.set('contentGenerator', contentGenerator);
  c.set('legalChecker', legalChecker);
  c.set('contentAutomation', contentAutomation);
  c.set('contentDelivery', contentDelivery);
  
  await next();
});

// 必要なインポートを追加
import { Database } from './db/database';
import { AuthService } from './auth/auth';
import { AuthMiddleware } from './auth/middleware';
import { ContentGenerationService } from './services/content-generator';
import { LegalCheckService } from './services/legal-checker';
import { ContentAutomationService } from './services/content-automation';
import { ContentDeliveryService } from './services/content-delivery';

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

// 自動化設定関連API
app.get('/api/automation/schedules', async (c) => {
  try {
    const token = getCookie(c, 'session_token');
    if (!token) {
      return c.json({ success: false, error: 'Authentication required' }, 401);
    }

    const authService = c.get('authService') as AuthService;
    const authContext = await authService.validateSession(token);
    if (!authContext) {
      return c.json({ success: false, error: 'Invalid session' }, 401);
    }

    const contentAutomation = c.get('contentAutomation') as ContentAutomationService;
    const schedules = await contentAutomation.getUserAutomationSchedules(
      authContext.user.id, 
      authContext.tenant.id
    );

    return c.json({
      success: true,
      data: schedules
    });
  } catch (error) {
    console.error('Error fetching automation schedules:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to fetch automation schedules' 
    }, 500);
  }
});

app.put('/api/automation/schedules/:id', async (c) => {
  try {
    const token = getCookie(c, 'session_token');
    if (!token) {
      return c.json({ success: false, error: 'Authentication required' }, 401);
    }

    const authService = c.get('authService') as AuthService;
    const authContext = await authService.validateSession(token);
    if (!authContext) {
      return c.json({ success: false, error: 'Invalid session' }, 401);
    }

    const scheduleId = parseInt(c.req.param('id'));
    const updates = await c.req.json();

    const contentAutomation = c.get('contentAutomation') as ContentAutomationService;
    await contentAutomation.updateAutomationSchedule(scheduleId, updates);

    return c.json({
      success: true,
      message: 'Automation schedule updated successfully'
    });
  } catch (error) {
    console.error('Error updating automation schedule:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to update automation schedule' 
    }, 500);
  }
});

// 配信設定関連API
app.get('/api/delivery/schedules', async (c) => {
  try {
    const token = getCookie(c, 'session_token');
    if (!token) {
      return c.json({ success: false, error: 'Authentication required' }, 401);
    }

    const authService = c.get('authService') as AuthService;
    const authContext = await authService.validateSession(token);
    if (!authContext) {
      return c.json({ success: false, error: 'Invalid session' }, 401);
    }

    const contentDelivery = c.get('contentDelivery') as ContentDeliveryService;
    const schedules = await contentDelivery.getUserDeliverySchedules(
      authContext.user.id, 
      authContext.tenant.id
    );

    return c.json({
      success: true,
      data: schedules
    });
  } catch (error) {
    console.error('Error fetching delivery schedules:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to fetch delivery schedules' 
    }, 500);
  }
});

// ダッシュボード通知API
app.get('/api/notifications', async (c) => {
  try {
    const token = getCookie(c, 'session_token');
    if (!token) {
      return c.json({ success: false, error: 'Authentication required' }, 401);
    }

    const authService = c.get('authService') as AuthService;
    const authContext = await authService.validateSession(token);
    if (!authContext) {
      return c.json({ success: false, error: 'Invalid session' }, 401);
    }

    const contentDelivery = c.get('contentDelivery') as ContentDeliveryService;
    const notifications = await contentDelivery.getDashboardNotifications(
      authContext.user.id, 
      authContext.tenant.id
    );

    return c.json({
      success: true,
      data: notifications
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to fetch notifications' 
    }, 500);
  }
});

// 生成されたコンテンツ取得API
app.get('/api/content/generated', async (c) => {
  try {
    const token = getCookie(c, 'session_token');
    if (!token) {
      return c.json({ success: false, error: 'Authentication required' }, 401);
    }

    const authService = c.get('authService') as AuthService;
    const authContext = await authService.validateSession(token);
    if (!authContext) {
      return c.json({ success: false, error: 'Invalid session' }, 401);
    }

    const contentAutomation = c.get('contentAutomation') as ContentAutomationService;
    const contentItems = await contentAutomation.getPendingContentForDelivery(
      authContext.user.id, 
      authContext.tenant.id
    );

    return c.json({
      success: true,
      data: contentItems
    });
  } catch (error) {
    console.error('Error fetching generated content:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to fetch generated content' 
    }, 500);
  }
});

// 手動コンテンツ生成実行API（テスト用）
app.post('/api/automation/run-test', async (c) => {
  try {
    const token = getCookie(c, 'session_token');
    if (!token) {
      return c.json({ success: false, error: 'Authentication required' }, 401);
    }

    const authService = c.get('authService') as AuthService;
    const authContext = await authService.validateSession(token);
    if (!authContext) {
      return c.json({ success: false, error: 'Invalid session' }, 401);
    }

    const contentAutomation = c.get('contentAutomation') as ContentAutomationService;
    await contentAutomation.runAutomation();

    return c.json({
      success: true,
      message: 'Test automation completed successfully'
    });
  } catch (error) {
    console.error('Error running test automation:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to run test automation' 
    }, 500);
  }
});

// 手動配信実行API（テスト用）
app.post('/api/delivery/run-test', async (c) => {
  try {
    const token = getCookie(c, 'session_token');
    if (!token) {
      return c.json({ success: false, error: 'Authentication required' }, 401);
    }

    const authService = c.get('authService') as AuthService;
    const authContext = await authService.validateSession(token);
    if (!authContext) {
      return c.json({ success: false, error: 'Invalid session' }, 401);
    }

    const contentDelivery = c.get('contentDelivery') as ContentDeliveryService;
    await contentDelivery.runTestDelivery(authContext.user.id, authContext.tenant.id);

    return c.json({
      success: true,
      message: 'Test delivery completed successfully'
    });
  } catch (error) {
    console.error('Error running test delivery:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to run test delivery' 
    }, 500);
  }
});

// レンダラー設定
app.use(renderer)

// メインページ
app.get('/', (c) => {
  return c.render(
    <div className="mesh-background cyber-scrollbar">
      {/* ヘッダー */}
      <header className="glass-morphism border-b border-glass">
        <div className="cyber-container">
          <div className="cyber-flex-between h-20">
            <div className="cyber-flex">
              <div className="text-3xl font-bold cyber-text-gradient">
                <i className="fas fa-robot mr-3"></i>
                BGA Marketing AI
              </div>
              <span className="cyber-badge neon-pulse">
                Phase 0 MVP
              </span>
            </div>
            <div className="cyber-flex">
              <button id="loginBtn" className="cyber-btn-primary cyber-btn-lg">
                <i className="fas fa-sign-in-alt mr-2"></i>
                ログイン
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* メインコンテンツ */}
      <main className="cyber-container py-16">
        {/* ヒーローセクション */}
        <div className="text-center mb-20 fade-in">
          <h1 className="text-6xl font-bold cyber-text-gradient mb-6 scan-lines">
            生成AI活用 B2Bデジタルマーケティング自動化
          </h1>
          <p className="text-2xl text-secondary mb-12 neural-network">
            「誰でも90秒で効果把握」「3クリックで実施」× 法令チェックの新体験
          </p>
          <div className="cyber-grid-3 max-w-6xl mx-auto">
            <div className="cyber-card hologram-effect float">
              <div className="text-5xl mb-4" style={{color: 'var(--success-color)'}}>⚡</div>
              <h3 className="text-xl font-bold mb-3" style={{color: 'var(--text-primary)'}}>生産性向上</h3>
              <p style={{color: 'var(--text-secondary)'}}>マーケティング業務工数を最大70%削減</p>
            </div>
            <div className="cyber-card hologram-effect float" style={{'animationDelay': '0.2s'}}>
              <div className="text-5xl mb-4" style={{color: 'var(--danger-color)'}}>🛡️</div>
              <h3 className="text-xl font-bold mb-3" style={{color: 'var(--text-primary)'}}>リスク軽減</h3>
              <p style={{color: 'var(--text-secondary)'}}>景表法・薬機法等の法令違反を自動検知</p>
            </div>
            <div className="cyber-card hologram-effect float" style={{'animationDelay': '0.4s'}}>
              <div className="text-5xl mb-4" style={{color: 'var(--primary-color)'}}>📈</div>
              <h3 className="text-xl font-bold mb-3" style={{color: 'var(--text-primary)'}}>ROI向上</h3>
              <p style={{color: 'var(--text-secondary)'}}>データ駆動によるマーケティング効果最大化</p>
            </div>
          </div>
        </div>

        {/* 機能紹介 */}
        <div className="cyber-grid-2 mb-20 slide-in">
          {/* コンテンツ生成 */}
          <div className="cyber-card neural-network neon-border">
            <h2 className="text-3xl font-bold mb-6" style={{color: 'var(--text-primary)'}}>
              <i className="fas fa-magic mr-4 cyber-glow" style={{color: 'var(--secondary-color)'}}></i>
              AIコンテンツ生成
            </h2>
            <ul className="space-y-4 mb-8" style={{color: 'var(--text-secondary)'}}>
              <li className="cyber-flex">
                <i className="fas fa-check cyber-glow mr-4" style={{color: 'var(--success-color)'}}></i>
                5業界 × 3成長ステージ × 4チャネル対応
              </li>
              <li className="cyber-flex">
                <i className="fas fa-check cyber-glow mr-4" style={{color: 'var(--success-color)'}}></i>
                日本特化LocalePack搭載
              </li>
              <li className="cyber-flex">
                <i className="fas fa-check cyber-glow mr-4" style={{color: 'var(--success-color)'}}></i>
                季節性・文化的文脈を自動考慮
              </li>
            </ul>
            <button id="generateBtn" className="cyber-btn cyber-btn-lg w-full" style={{background: 'var(--gradient-accent)'}}>
              <i className="fas fa-bolt mr-2"></i>
              コンテンツ生成を試す
            </button>
          </div>

          {/* 法令チェック */}
          <div className="cyber-card neural-network neon-border">
            <h2 className="text-3xl font-bold mb-6" style={{color: 'var(--text-primary)'}}>
              <i className="fas fa-shield-alt mr-4 cyber-glow" style={{color: 'var(--danger-color)'}}></i>
              法令チェック
            </h2>
            <ul className="space-y-4 mb-8" style={{color: 'var(--text-secondary)'}}>
              <li className="cyber-flex">
                <i className="fas fa-check cyber-glow mr-4" style={{color: 'var(--success-color)'}}></i>
                景表法・薬機法・金商法対応
              </li>
              <li className="cyber-flex">
                <i className="fas fa-check cyber-glow mr-4" style={{color: 'var(--success-color)'}}></i>
                5段階リスクレベル評価
              </li>
              <li className="cyber-flex">
                <i className="fas fa-check cyber-glow mr-4" style={{color: 'var(--success-color)'}}></i>
                修正提案と法的根拠の提示
              </li>
            </ul>
            <button id="checkBtn" className="cyber-btn-danger cyber-btn-lg w-full">
              <i className="fas fa-search mr-2"></i>
              法令チェックを実行
            </button>
          </div>
        </div>

        {/* 統計情報 */}
        <div className="cyber-card matrix-rain data-stream mb-20" style={{background: 'var(--gradient-primary)'}}>
          <div className="text-center">
            <h2 className="text-4xl font-bold mb-10" style={{color: 'var(--text-primary)'}}>フェーズ0 社内MVP統計</h2>
            <div className="cyber-grid-4">
              <div className="text-center">
                <div className="text-6xl font-bold cyber-text-gradient mb-2">70%</div>
                <div className="text-lg" style={{color: 'var(--text-secondary)'}}>業務工数削減</div>
              </div>
              <div className="text-center">
                <div className="text-6xl font-bold cyber-text-gradient mb-2">90秒</div>
                <div className="text-lg" style={{color: 'var(--text-secondary)'}}>効果把握時間</div>
              </div>
              <div className="text-center">
                <div className="text-6xl font-bold cyber-text-gradient mb-2">3クリック</div>
                <div className="text-lg" style={{color: 'var(--text-secondary)'}}>実施までの操作</div>
              </div>
              <div className="text-center">
                <div className="text-6xl font-bold cyber-text-gradient mb-2">0件</div>
                <div className="text-lg" style={{color: 'var(--text-secondary)'}}>法令違反発生</div>
              </div>
            </div>
          </div>
        </div>

        {/* ダッシュボード（認証後表示） */}
        <div id="dashboard" className="hidden">
          <div className="cyber-card neural-network">
            <h2 className="text-3xl font-bold mb-8 cyber-text-gradient">マーケティング ダッシュボード</h2>
            <div id="dashboardContent">
              {/* JavaScript で動的に生成 */}
            </div>
          </div>
        </div>
      </main>

      <div className="cyber-divider"></div>

      {/* フッター */}
      <footer className="glass-morphism py-12">
        <div className="cyber-container text-center">
          <p style={{color: 'var(--text-secondary)'}}>&copy; 2025 BGA株式会社 & Apoptosis株式会社. All rights reserved.</p>
          <p className="mt-2 cyber-text-gradient">生成AI活用 B2Bデジタルマーケティング自動化SaaS - Phase 0 MVP</p>
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
