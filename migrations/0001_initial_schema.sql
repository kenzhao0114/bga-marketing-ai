-- マルチテナント基盤スキーマ設計
-- テナント分離とセキュリティファースト設計

-- テナント管理テーブル
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT UNIQUE,
  security_level TEXT CHECK (security_level IN ('internal', 'client', 'saas')) DEFAULT 'internal',
  data_isolation TEXT CHECK (data_isolation IN ('complete', 'partial')) DEFAULT 'complete',
  compliance_level TEXT CHECK (compliance_level IN ('SOC2', 'ISO27001', 'GDPR')) DEFAULT 'SOC2',
  subscription_plan TEXT CHECK (subscription_plan IN ('internal', 'startup', 'growth', 'scale', 'enterprise')) DEFAULT 'internal',
  is_active BOOLEAN DEFAULT TRUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ユーザー管理テーブル（テナント分離）
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role_internal TEXT CHECK (role_internal IN ('admin', 'director', 'producer', 'member')) DEFAULT 'member',
  role_client TEXT CHECK (role_client IN ('stakeholder', 'approver', 'viewer')), 
  role_saas TEXT CHECK (role_saas IN ('owner', 'admin', 'editor', 'viewer')),
  password_hash TEXT,
  last_login DATETIME,
  is_active BOOLEAN DEFAULT TRUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- ユニーク制約（テナント内でのメールアドレス一意性）
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_email ON users(tenant_id, email);

-- セッション管理テーブル
CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- 業界・成長ステージ・チャネル定義テーブル
CREATE TABLE IF NOT EXISTS industry_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL, -- 'industry', 'growth_stage', 'channel'
  locale_pack TEXT NOT NULL, -- JSON: 日本特化の文化的文脈データ
  is_active BOOLEAN DEFAULT TRUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- AIコンテンツ生成履歴テーブル（テナント分離）
CREATE TABLE IF NOT EXISTS content_generations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  industry_id TEXT,
  growth_stage_id TEXT,
  channel_id TEXT,
  input_prompt TEXT NOT NULL,
  generated_content TEXT NOT NULL,
  locale_pack_data TEXT, -- JSON: 使用された LocalePack データ
  quality_score REAL DEFAULT 0,
  legal_check_status TEXT CHECK (legal_check_status IN ('pending', 'passed', 'failed', 'needs_review')) DEFAULT 'pending',
  legal_check_details TEXT, -- JSON: 法令チェック詳細結果
  approval_status TEXT CHECK (approval_status IN ('draft', 'pending_approval', 'approved', 'rejected')) DEFAULT 'draft',
  approved_by TEXT,
  approved_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (industry_id) REFERENCES industry_templates(id),
  FOREIGN KEY (growth_stage_id) REFERENCES industry_templates(id),
  FOREIGN KEY (channel_id) REFERENCES industry_templates(id),
  FOREIGN KEY (approved_by) REFERENCES users(id)
);

-- 法令チェック結果テーブル
CREATE TABLE IF NOT EXISTS legal_check_results (
  id TEXT PRIMARY KEY,
  content_generation_id TEXT NOT NULL,
  law_type TEXT NOT NULL, -- '景表法', '薬機法', '金商法', etc.
  check_status TEXT CHECK (check_status IN ('passed', 'warning', 'violation')) NOT NULL,
  risk_level INTEGER CHECK (risk_level BETWEEN 1 AND 5) DEFAULT 1, -- 1:低リスク, 5:高リスク
  violation_details TEXT, -- JSON: 違反詳細と修正提案
  legal_references TEXT, -- JSON: 法的根拠と判例データ
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (content_generation_id) REFERENCES content_generations(id) ON DELETE CASCADE
);

-- 外部API連携データテーブル（テナント分離）
CREATE TABLE IF NOT EXISTS api_integrations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  platform TEXT NOT NULL, -- 'GA4', 'Meta', 'LinkedIn', 'PR_TIMES'
  account_id TEXT NOT NULL,
  api_credentials TEXT NOT NULL, -- 暗号化されたクレデンシャル
  is_active BOOLEAN DEFAULT TRUE,
  last_sync DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- マーケティングメトリクスデータテーブル
CREATE TABLE IF NOT EXISTS marketing_metrics (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  api_integration_id TEXT NOT NULL,
  metric_type TEXT NOT NULL, -- 'impressions', 'clicks', 'conversions', 'cost', 'roi'
  platform TEXT NOT NULL,
  campaign_id TEXT,
  metric_value REAL NOT NULL,
  currency TEXT DEFAULT 'JPY',
  date_recorded DATE NOT NULL,
  data_source TEXT NOT NULL, -- JSON: 元データの詳細
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (api_integration_id) REFERENCES api_integrations(id) ON DELETE CASCADE
);

-- レポート生成履歴テーブル
CREATE TABLE IF NOT EXISTS report_generations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  report_type TEXT NOT NULL, -- '90sec_summary', '3_action_proposal', 'roi_analysis'
  date_range_start DATE NOT NULL,
  date_range_end DATE NOT NULL,
  report_data TEXT NOT NULL, -- JSON: レポート内容
  insights TEXT, -- JSON: AI生成インサイト
  action_recommendations TEXT, -- JSON: 3つのアクション提案
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- インデックス作成（パフォーマンス最適化）
CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_content_generations_tenant_id ON content_generations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_content_generations_user_id ON content_generations(user_id);
CREATE INDEX IF NOT EXISTS idx_content_generations_created_at ON content_generations(created_at);

CREATE INDEX IF NOT EXISTS idx_legal_check_results_content_id ON legal_check_results(content_generation_id);
CREATE INDEX IF NOT EXISTS idx_legal_check_results_law_type ON legal_check_results(law_type);

CREATE INDEX IF NOT EXISTS idx_marketing_metrics_tenant_id ON marketing_metrics(tenant_id);
CREATE INDEX IF NOT EXISTS idx_marketing_metrics_date ON marketing_metrics(date_recorded);
CREATE INDEX IF NOT EXISTS idx_marketing_metrics_platform ON marketing_metrics(platform);

CREATE INDEX IF NOT EXISTS idx_report_generations_tenant_id ON report_generations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_report_generations_user_id ON report_generations(user_id);
CREATE INDEX IF NOT EXISTS idx_report_generations_created_at ON report_generations(created_at);