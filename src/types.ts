// マルチテナント・セキュリティファースト設計の型定義

// Cloudflare Workers環境の型定義
export interface Env {
  DB: D1Database;
  AI: Ai;
  OPENAI_API_KEY?: string;
  JWT_SECRET?: string;
}

// テナント管理
export interface TenantContext {
  tenantId: string;
  securityLevel: 'internal' | 'client' | 'saas';
  dataIsolation: 'complete' | 'partial';
  complianceLevel: 'SOC2' | 'ISO27001' | 'GDPR';
}

// ユーザーロール管理
export interface UserRole {
  internal?: 'admin' | 'director' | 'producer' | 'member';
  client?: 'stakeholder' | 'approver' | 'viewer';
  saas?: 'owner' | 'admin' | 'editor' | 'viewer';
}

// データベーススキーマ型定義
export interface Tenant {
  id: string;
  name: string;
  domain?: string;
  security_level: 'internal' | 'client' | 'saas';
  data_isolation: 'complete' | 'partial';
  compliance_level: 'SOC2' | 'ISO27001' | 'GDPR';
  subscription_plan: 'internal' | 'startup' | 'growth' | 'scale' | 'enterprise';
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  tenant_id: string;
  email: string;
  name: string;
  role_internal?: 'admin' | 'director' | 'producer' | 'member';
  role_client?: 'stakeholder' | 'approver' | 'viewer';
  role_saas?: 'owner' | 'admin' | 'editor' | 'viewer';
  password_hash?: string;
  last_login?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserSession {
  id: string;
  user_id: string;
  tenant_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
}

// LocalePack システム
export interface LocalePack {
  formal_level?: 'casual' | 'semi_formal' | 'formal' | 'very_formal';
  key_terms?: string[];
  seasonal_context?: {
    spring?: string;
    summer?: string;
    fall?: string;
    winter?: string;
  };
  tone?: string;
  focus?: string[];
  budget_context?: string;
  format?: string;
  structure?: string[];
  [key: string]: any;
}

export interface IndustryTemplate {
  id: string;
  name: string;
  category: 'industry' | 'growth_stage' | 'channel';
  locale_pack: LocalePack;
  is_active: boolean;
  created_at: string;
}

// コンテンツ生成
export interface ContentGeneration {
  id: string;
  tenant_id: string;
  user_id: string;
  industry_id?: string;
  growth_stage_id?: string;
  channel_id?: string;
  input_prompt: string;
  generated_content: string;
  locale_pack_data?: LocalePack;
  quality_score?: number;
  legal_check_status: 'pending' | 'passed' | 'failed' | 'needs_review';
  legal_check_details?: any;
  approval_status: 'draft' | 'pending_approval' | 'approved' | 'rejected';
  approved_by?: string;
  approved_at?: string;
  created_at: string;
  updated_at: string;
}

// 法令チェック
export interface LegalCheckResult {
  id: string;
  content_generation_id: string;
  law_type: string; // '景表法', '薬機法', '金商法', etc.
  check_status: 'passed' | 'warning' | 'violation';
  risk_level: 1 | 2 | 3 | 4 | 5; // 1:低リスク, 5:高リスク
  violation_details?: any;
  legal_references?: any;
  created_at: string;
}

// API連携
export interface ApiIntegration {
  id: string;
  tenant_id: string;
  platform: 'GA4' | 'Meta' | 'LinkedIn' | 'PR_TIMES';
  account_id: string;
  api_credentials: string; // 暗号化されたクレデンシャル
  is_active: boolean;
  last_sync?: string;
  created_at: string;
  updated_at: string;
}

export interface MarketingMetrics {
  id: string;
  tenant_id: string;
  api_integration_id: string;
  metric_type: 'impressions' | 'clicks' | 'conversions' | 'cost' | 'roi';
  platform: string;
  campaign_id?: string;
  metric_value: number;
  currency: string;
  date_recorded: string;
  data_source: any;
  created_at: string;
}

// レポート生成
export interface ReportGeneration {
  id: string;
  tenant_id: string;
  user_id: string;
  report_type: '90sec_summary' | '3_action_proposal' | 'roi_analysis';
  date_range_start: string;
  date_range_end: string;
  report_data: any;
  insights?: any;
  action_recommendations?: any;
  created_at: string;
}

// AIコンテンツ生成リクエスト
export interface ContentGenerationRequest {
  industry_id?: string;
  growth_stage_id?: string;
  channel_id?: string;
  prompt: string;
  custom_context?: any;
}

// AIコンテンツ生成レスポンス
export interface ContentGenerationResponse {
  id: string;
  generated_content: string;
  quality_score: number;
  legal_check_status: 'pending' | 'passed' | 'failed' | 'needs_review';
  legal_issues?: LegalCheckResult[];
  suggestions?: string[];
}

// 90秒要約レポート
export interface QuickSummaryReport {
  summary: string;
  key_metrics: {
    total_impressions: number;
    total_clicks: number;
    total_conversions: number;
    total_cost: number;
    roi: number;
  };
  trend_analysis: string;
  performance_comparison: string;
  generated_at: string;
}

// 3アクション提案
export interface ActionRecommendations {
  priority_actions: {
    action: string;
    impact: 'high' | 'medium' | 'low';
    effort: 'high' | 'medium' | 'low';
    timeline: string;
    expected_outcome: string;
  }[];
  supporting_data: any;
  generated_at: string;
}

// APIレスポンス標準型
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  metadata?: {
    total_count?: number;
    page?: number;
    per_page?: number;
    tenant_id?: string;
  };
}

// 認証コンテキスト
export interface AuthContext {
  user: User;
  tenant: Tenant;
  session: UserSession;
  permissions: string[];
}