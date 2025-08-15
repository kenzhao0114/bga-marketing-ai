// BGA Marketing AI - フロントエンドアプリケーション

class BGAMarketingApp {
  constructor() {
    this.apiBase = '/api';
    this.currentUser = null;
    this.currentTenant = null;
    this.templates = null;
    
    this.init();
  }

  async init() {
    try {
      // 既存セッションの確認
      await this.checkSession();
      this.setupEventListeners();
      this.loadTemplates();
    } catch (error) {
      console.error('App initialization error:', error);
    }
  }

  // セッション確認
  async checkSession() {
    try {
      const response = await axios.get(`${this.apiBase}/auth/profile`);
      if (response.data.success) {
        this.currentUser = response.data.data.user;
        this.currentTenant = response.data.data.tenant;
        this.showDashboard();
        this.updateUserInfo();
      }
    } catch (error) {
      // セッションなし - ログイン画面表示
      this.showLoginForm();
    }
  }

  // イベントリスナー設定
  setupEventListeners() {
    // ログインボタン
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) {
      loginBtn.addEventListener('click', () => this.showLoginForm());
    }

    // コンテンツ生成ボタン
    const generateBtn = document.getElementById('generateBtn');
    if (generateBtn) {
      generateBtn.addEventListener('click', () => this.showContentGenerator());
    }

    // 法令チェックボタン
    const checkBtn = document.getElementById('checkBtn');
    if (checkBtn) {
      checkBtn.addEventListener('click', () => this.showLegalChecker());
    }
  }

  // ログインフォーム表示
  showLoginForm() {
    const modalHtml = `
      <div class="modal-overlay" id="loginModal">
        <div class="modal-content">
          <h2 class="text-2xl font-bold mb-6 text-center">ログイン</h2>
          <form id="loginForm" class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">メールアドレス</label>
              <input type="email" id="email" class="form-input" placeholder="例: admin@bga.co.jp" required>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">テナントID</label>
              <select id="tenantId" class="form-select" required>
                <option value="">選択してください</option>
                <option value="bga-internal">BGA社内</option>
              </select>
            </div>
            <div class="flex space-x-4">
              <button type="submit" class="btn-primary flex-1">
                <span id="loginSpinner" class="loading-spinner hidden mr-2"></span>
                ログイン
              </button>
              <button type="button" class="btn-secondary flex-1" onclick="bgaApp.closeModal('loginModal')">
                キャンセル
              </button>
            </div>
          </form>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    // フォーム送信イベント
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleLogin();
    });
  }

  // ログイン処理
  async handleLogin() {
    const email = document.getElementById('email').value;
    const tenantId = document.getElementById('tenantId').value;
    const spinner = document.getElementById('loginSpinner');
    
    try {
      spinner.classList.remove('hidden');
      
      const response = await axios.post(`${this.apiBase}/auth/login`, {
        email,
        tenant_id: tenantId
      });

      if (response.data.success) {
        this.currentUser = response.data.data.user;
        this.currentTenant = response.data.data.tenant;
        this.closeModal('loginModal');
        this.showDashboard();
        this.updateUserInfo();
        this.showNotification('ログインしました', 'success');
      }
    } catch (error) {
      console.error('Login error:', error);
      this.showNotification('ログインに失敗しました', 'error');
    } finally {
      spinner.classList.add('hidden');
    }
  }

  // ダッシュボード表示
  showDashboard() {
    const dashboard = document.getElementById('dashboard');
    if (dashboard) {
      dashboard.classList.remove('hidden');
      this.loadDashboardContent();
    }
  }

  // ダッシュボードコンテンツ読み込み
  async loadDashboardContent() {
    const content = document.getElementById('dashboardContent');
    if (!content) return;

    try {
      const [historyResponse] = await Promise.all([
        axios.get(`${this.apiBase}/content/history?limit=5`)
      ]);

      const recentContent = historyResponse.data.success ? historyResponse.data.data : [];

      content.innerHTML = `
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <!-- 最近のコンテンツ -->
          <div class="bg-gray-50 p-6 rounded-lg">
            <h3 class="text-lg font-semibold mb-4">最近のコンテンツ生成</h3>
            <div class="space-y-3">
              ${recentContent.length > 0 ? 
                recentContent.map(content => `
                  <div class="bg-white p-4 rounded border-l-4 border-blue-500">
                    <h4 class="font-medium text-sm">${content.input_prompt.slice(0, 50)}...</h4>
                    <div class="flex items-center justify-between mt-2">
                      <span class="status-${content.legal_check_status}">${this.getStatusText(content.legal_check_status)}</span>
                      <span class="text-xs text-gray-500">${this.formatDate(content.created_at)}</span>
                    </div>
                  </div>
                `).join('') : 
                '<p class="text-gray-500 text-center py-8">まだコンテンツがありません</p>'
              }
            </div>
            <button class="btn-primary w-full mt-4" onclick="bgaApp.showContentGenerator()">
              <i class="fas fa-plus mr-2"></i>新しいコンテンツを生成
            </button>
          </div>

          <!-- 統計情報 -->
          <div class="bg-gray-50 p-6 rounded-lg">
            <h3 class="text-lg font-semibold mb-4">システム統計</h3>
            <div class="grid grid-cols-2 gap-4">
              <div class="text-center p-4 bg-white rounded">
                <div class="text-2xl font-bold text-blue-600">${recentContent.length}</div>
                <div class="text-sm text-gray-600">生成コンテンツ数</div>
              </div>
              <div class="text-center p-4 bg-white rounded">
                <div class="text-2xl font-bold text-green-600">
                  ${recentContent.filter(c => c.legal_check_status === 'passed').length}
                </div>
                <div class="text-sm text-gray-600">法令チェック合格</div>
              </div>
              <div class="text-center p-4 bg-white rounded">
                <div class="text-2xl font-bold text-purple-600">
                  ${recentContent.filter(c => c.approval_status === 'approved').length}
                </div>
                <div class="text-sm text-gray-600">承認済み</div>
              </div>
              <div class="text-center p-4 bg-white rounded">
                <div class="text-2xl font-bold text-orange-600">
                  ${this.calculateAverageQuality(recentContent).toFixed(1)}
                </div>
                <div class="text-sm text-gray-600">平均品質スコア</div>
              </div>
            </div>
          </div>
        </div>
      `;
    } catch (error) {
      console.error('Dashboard load error:', error);
      content.innerHTML = '<p class="text-red-500 text-center py-8">ダッシュボードの読み込みに失敗しました</p>';
    }
  }

  // コンテンツ生成画面表示
  async showContentGenerator() {
    if (!this.currentUser) {
      this.showLoginForm();
      return;
    }

    await this.loadTemplates();

    const modalHtml = `
      <div class="modal-overlay" id="generatorModal">
        <div class="modal-content max-w-2xl">
          <h2 class="text-2xl font-bold mb-6">AIコンテンツ生成</h2>
          <form id="generatorForm" class="space-y-6">
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">業界</label>
                <select id="industry" class="form-select">
                  <option value="">選択してください</option>
                  ${this.templates?.industries?.map(t => 
                    `<option value="${t.id}">${t.name}</option>`
                  ).join('') || ''}
                </select>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">成長ステージ</label>
                <select id="growthStage" class="form-select">
                  <option value="">選択してください</option>
                  ${this.templates?.growth_stages?.map(t => 
                    `<option value="${t.id}">${t.name}</option>`
                  ).join('') || ''}
                </select>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">チャネル</label>
                <select id="channel" class="form-select">
                  <option value="">選択してください</option>
                  ${this.templates?.channels?.map(t => 
                    `<option value="${t.id}">${t.name}</option>`
                  ).join('') || ''}
                </select>
              </div>
            </div>
            
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">プロンプト</label>
              <textarea id="prompt" class="form-textarea h-32" placeholder="生成したいコンテンツの詳細を入力してください..." required></textarea>
            </div>
            
            <div class="flex space-x-4">
              <button type="submit" class="btn-primary flex-1">
                <span id="generateSpinner" class="loading-spinner hidden mr-2"></span>
                <i class="fas fa-magic mr-2"></i>
                コンテンツ生成
              </button>
              <button type="button" class="btn-secondary" onclick="bgaApp.closeModal('generatorModal')">
                キャンセル
              </button>
            </div>
          </form>
          
          <div id="generationResult" class="hidden mt-6 p-4 border rounded-lg bg-gray-50">
            <h3 class="text-lg font-semibold mb-4">生成結果</h3>
            <div id="generatedContent" class="bg-white p-4 rounded border">
              <!-- 生成されたコンテンツがここに表示される -->
            </div>
            <div class="mt-4 flex space-x-4">
              <button class="btn-success" onclick="bgaApp.approveContent()">
                <i class="fas fa-check mr-2"></i>承認
              </button>
              <button class="btn-warning" onclick="bgaApp.checkLegal()">
                <i class="fas fa-shield-alt mr-2"></i>法令チェック
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    document.getElementById('generatorForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleContentGeneration();
    });
  }

  // コンテンツ生成処理
  async handleContentGeneration() {
    const prompt = document.getElementById('prompt').value;
    const industry_id = document.getElementById('industry').value || undefined;
    const growth_stage_id = document.getElementById('growthStage').value || undefined;
    const channel_id = document.getElementById('channel').value || undefined;
    const spinner = document.getElementById('generateSpinner');
    
    try {
      spinner.classList.remove('hidden');
      
      const response = await axios.post(`${this.apiBase}/content/generate`, {
        prompt,
        industry_id,
        growth_stage_id,
        channel_id
      });

      if (response.data.success) {
        this.currentGeneratedContent = response.data.data;
        this.displayGenerationResult(response.data.data);
        this.showNotification('コンテンツを生成しました', 'success');
      }
    } catch (error) {
      console.error('Content generation error:', error);
      this.showNotification('コンテンツ生成に失敗しました', 'error');
    } finally {
      spinner.classList.add('hidden');
    }
  }

  // 生成結果表示
  displayGenerationResult(result) {
    const resultDiv = document.getElementById('generationResult');
    const contentDiv = document.getElementById('generatedContent');
    
    contentDiv.innerHTML = `
      <div class="mb-4">
        <div class="flex items-center justify-between mb-2">
          <h4 class="font-semibold">生成されたコンテンツ</h4>
          <div class="flex items-center space-x-4">
            <span class="text-sm text-gray-500">品質スコア: ${result.quality_score}/10</span>
            <span class="status-${result.legal_check_status}">${this.getStatusText(result.legal_check_status)}</span>
          </div>
        </div>
        <div class="bg-gray-50 p-4 rounded border whitespace-pre-wrap">${result.generated_content}</div>
      </div>
      
      ${result.suggestions && result.suggestions.length > 0 ? `
        <div class="mt-4">
          <h5 class="font-medium mb-2">改善提案</h5>
          <ul class="list-disc list-inside text-sm text-gray-600 space-y-1">
            ${result.suggestions.map(s => `<li>${s}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
    `;
    
    resultDiv.classList.remove('hidden');
  }

  // テンプレート読み込み
  async loadTemplates() {
    if (this.templates) return;
    
    try {
      const response = await axios.get(`${this.apiBase}/templates`);
      if (response.data.success) {
        this.templates = response.data.data;
      }
    } catch (error) {
      console.error('Templates load error:', error);
    }
  }

  // ユーティリティメソッド
  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.remove();
    }
  }

  showNotification(message, type = 'info') {
    const colors = {
      success: 'bg-green-500',
      error: 'bg-red-500',
      warning: 'bg-yellow-500',
      info: 'bg-blue-500'
    };

    const notification = document.createElement('div');
    notification.className = `fixed top-4 right-4 ${colors[type]} text-white px-6 py-3 rounded-lg shadow-lg z-50 fade-in`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.remove();
    }, 3000);
  }

  updateUserInfo() {
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn && this.currentUser) {
      loginBtn.innerHTML = `
        <i class="fas fa-user mr-2"></i>
        ${this.currentUser.name}
      `;
      loginBtn.onclick = () => this.showUserMenu();
    }
  }

  showUserMenu() {
    // ユーザーメニュー実装
    console.log('User menu clicked');
  }

  getStatusText(status) {
    const statusMap = {
      'pending': '確認中',
      'passed': '合格',
      'warning': '注意',
      'violation': '違反',
      'failed': '失敗',
      'draft': '下書き',
      'approved': '承認済み'
    };
    return statusMap[status] || status;
  }

  formatDate(dateString) {
    return new Date(dateString).toLocaleDateString('ja-JP', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  calculateAverageQuality(contents) {
    if (!contents.length) return 0;
    const total = contents.reduce((sum, content) => sum + (content.quality_score || 0), 0);
    return total / contents.length;
  }
}

// アプリケーション初期化
const bgaApp = new BGAMarketingApp();

// グローバル関数（HTML内から呼び出し用）
window.bgaApp = bgaApp;