// データベースアクセス層 - マルチテナント対応

import { Env, Tenant, User, UserSession, IndustryTemplate, ContentGeneration, LegalCheckResult } from '../types';

export class Database {
  constructor(private db: D1Database) {}

  // テナント管理
  async getTenant(tenantId: string): Promise<Tenant | null> {
    const result = await this.db
      .prepare('SELECT * FROM tenants WHERE id = ? AND is_active = 1')
      .bind(tenantId)
      .first();
    return result as Tenant | null;
  }

  async getTenantByDomain(domain: string): Promise<Tenant | null> {
    const result = await this.db
      .prepare('SELECT * FROM tenants WHERE domain = ? AND is_active = 1')
      .bind(domain)
      .first();
    return result as Tenant | null;
  }

  // ユーザー管理（テナント分離）
  async getUser(userId: string, tenantId: string): Promise<User | null> {
    const result = await this.db
      .prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ? AND is_active = 1')
      .bind(userId, tenantId)
      .first();
    return result as User | null;
  }

  async getUserByEmail(email: string, tenantId: string): Promise<User | null> {
    const result = await this.db
      .prepare('SELECT * FROM users WHERE email = ? AND tenant_id = ? AND is_active = 1')
      .bind(email, tenantId)
      .first();
    return result as User | null;
  }

  async createUser(user: Omit<User, 'created_at' | 'updated_at'>): Promise<User> {
    const now = new Date().toISOString();
    const userWithTimestamps = {
      ...user,
      created_at: now,
      updated_at: now
    };

    await this.db
      .prepare(`
        INSERT INTO users (id, tenant_id, email, name, role_internal, role_client, role_saas, password_hash, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        userWithTimestamps.id,
        userWithTimestamps.tenant_id,
        userWithTimestamps.email,
        userWithTimestamps.name,
        userWithTimestamps.role_internal || null,
        userWithTimestamps.role_client || null,
        userWithTimestamps.role_saas || null,
        userWithTimestamps.password_hash || null,
        userWithTimestamps.is_active,
        userWithTimestamps.created_at,
        userWithTimestamps.updated_at
      )
      .run();

    return userWithTimestamps as User;
  }

  // セッション管理
  async createSession(session: Omit<UserSession, 'created_at'>): Promise<UserSession> {
    const now = new Date().toISOString();
    const sessionWithTimestamp = {
      ...session,
      created_at: now
    };

    await this.db
      .prepare(`
        INSERT INTO user_sessions (id, user_id, tenant_id, token_hash, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .bind(
        sessionWithTimestamp.id,
        sessionWithTimestamp.user_id,
        sessionWithTimestamp.tenant_id,
        sessionWithTimestamp.token_hash,
        sessionWithTimestamp.expires_at,
        sessionWithTimestamp.created_at
      )
      .run();

    return sessionWithTimestamp;
  }

  async getValidSession(tokenHash: string): Promise<UserSession | null> {
    const result = await this.db
      .prepare(`
        SELECT * FROM user_sessions 
        WHERE token_hash = ? AND expires_at > datetime('now')
      `)
      .bind(tokenHash)
      .first();
    return result as UserSession | null;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.db
      .prepare('DELETE FROM user_sessions WHERE id = ?')
      .bind(sessionId)
      .run();
  }

  // テンプレート管理
  async getIndustryTemplates(): Promise<IndustryTemplate[]> {
    const result = await this.db
      .prepare('SELECT * FROM industry_templates WHERE is_active = 1 ORDER BY category, name')
      .all();
    
    return result.results.map(row => ({
      ...row,
      locale_pack: JSON.parse(row.locale_pack as string)
    })) as IndustryTemplate[];
  }

  async getTemplatesByCategory(category: 'industry' | 'growth_stage' | 'channel'): Promise<IndustryTemplate[]> {
    const result = await this.db
      .prepare('SELECT * FROM industry_templates WHERE category = ? AND is_active = 1 ORDER BY name')
      .bind(category)
      .all();
    
    return result.results.map(row => ({
      ...row,
      locale_pack: JSON.parse(row.locale_pack as string)
    })) as IndustryTemplate[];
  }

  async getTemplateById(templateId: string): Promise<IndustryTemplate | null> {
    const result = await this.db
      .prepare('SELECT * FROM industry_templates WHERE id = ? AND is_active = 1')
      .bind(templateId)
      .first();
    
    if (!result) return null;
    
    return {
      ...result,
      locale_pack: JSON.parse(result.locale_pack as string)
    } as IndustryTemplate;
  }

  // コンテンツ生成履歴（テナント分離）
  async createContentGeneration(content: Omit<ContentGeneration, 'created_at' | 'updated_at'>): Promise<ContentGeneration> {
    const now = new Date().toISOString();
    const contentWithTimestamps = {
      ...content,
      created_at: now,
      updated_at: now
    };

    await this.db
      .prepare(`
        INSERT INTO content_generations (
          id, tenant_id, user_id, industry_id, growth_stage_id, channel_id,
          input_prompt, generated_content, locale_pack_data, quality_score,
          legal_check_status, legal_check_details, approval_status,
          approved_by, approved_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        contentWithTimestamps.id,
        contentWithTimestamps.tenant_id,
        contentWithTimestamps.user_id,
        contentWithTimestamps.industry_id || null,
        contentWithTimestamps.growth_stage_id || null,
        contentWithTimestamps.channel_id || null,
        contentWithTimestamps.input_prompt,
        contentWithTimestamps.generated_content,
        contentWithTimestamps.locale_pack_data ? JSON.stringify(contentWithTimestamps.locale_pack_data) : null,
        contentWithTimestamps.quality_score || 0,
        contentWithTimestamps.legal_check_status,
        contentWithTimestamps.legal_check_details ? JSON.stringify(contentWithTimestamps.legal_check_details) : null,
        contentWithTimestamps.approval_status,
        contentWithTimestamps.approved_by || null,
        contentWithTimestamps.approved_at || null,
        contentWithTimestamps.created_at,
        contentWithTimestamps.updated_at
      )
      .run();

    return contentWithTimestamps as ContentGeneration;
  }

  async getContentGenerations(tenantId: string, limit = 20, offset = 0): Promise<ContentGeneration[]> {
    const result = await this.db
      .prepare(`
        SELECT * FROM content_generations 
        WHERE tenant_id = ? 
        ORDER BY created_at DESC 
        LIMIT ? OFFSET ?
      `)
      .bind(tenantId, limit, offset)
      .all();
    
    return result.results.map(row => ({
      ...row,
      locale_pack_data: row.locale_pack_data ? JSON.parse(row.locale_pack_data as string) : null,
      legal_check_details: row.legal_check_details ? JSON.parse(row.legal_check_details as string) : null
    })) as ContentGeneration[];
  }

  async getContentGeneration(contentId: string, tenantId: string): Promise<ContentGeneration | null> {
    const result = await this.db
      .prepare('SELECT * FROM content_generations WHERE id = ? AND tenant_id = ?')
      .bind(contentId, tenantId)
      .first();
    
    if (!result) return null;
    
    return {
      ...result,
      locale_pack_data: result.locale_pack_data ? JSON.parse(result.locale_pack_data as string) : null,
      legal_check_details: result.legal_check_details ? JSON.parse(result.legal_check_details as string) : null
    } as ContentGeneration;
  }

  // 法令チェック結果
  async createLegalCheckResult(legalCheck: Omit<LegalCheckResult, 'created_at'>): Promise<LegalCheckResult> {
    const now = new Date().toISOString();
    const legalCheckWithTimestamp = {
      ...legalCheck,
      created_at: now
    };

    await this.db
      .prepare(`
        INSERT INTO legal_check_results (
          id, content_generation_id, law_type, check_status, risk_level,
          violation_details, legal_references, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        legalCheckWithTimestamp.id,
        legalCheckWithTimestamp.content_generation_id,
        legalCheckWithTimestamp.law_type,
        legalCheckWithTimestamp.check_status,
        legalCheckWithTimestamp.risk_level,
        legalCheckWithTimestamp.violation_details ? JSON.stringify(legalCheckWithTimestamp.violation_details) : null,
        legalCheckWithTimestamp.legal_references ? JSON.stringify(legalCheckWithTimestamp.legal_references) : null,
        legalCheckWithTimestamp.created_at
      )
      .run();

    return legalCheckWithTimestamp;
  }

  async getLegalCheckResults(contentGenerationId: string): Promise<LegalCheckResult[]> {
    const result = await this.db
      .prepare('SELECT * FROM legal_check_results WHERE content_generation_id = ? ORDER BY created_at DESC')
      .bind(contentGenerationId)
      .all();
    
    return result.results.map(row => ({
      ...row,
      violation_details: row.violation_details ? JSON.parse(row.violation_details as string) : null,
      legal_references: row.legal_references ? JSON.parse(row.legal_references as string) : null
    })) as LegalCheckResult[];
  }

  // ユーティリティ
  async updateUserLastLogin(userId: string, tenantId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare('UPDATE users SET last_login = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
      .bind(now, now, userId, tenantId)
      .run();
  }

  async updateContentGenerationStatus(
    contentId: string, 
    tenantId: string, 
    status: ContentGeneration['approval_status'],
    approvedBy?: string
  ): Promise<void> {
    const now = new Date().toISOString();
    const approvedAt = status === 'approved' ? now : null;
    
    await this.db
      .prepare(`
        UPDATE content_generations 
        SET approval_status = ?, approved_by = ?, approved_at = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ?
      `)
      .bind(status, approvedBy || null, approvedAt, now, contentId, tenantId)
      .run();
  }
}