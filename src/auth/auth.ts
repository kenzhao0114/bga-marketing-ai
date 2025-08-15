// テナントベース認証システム - セキュリティファースト設計

import { Env, User, Tenant, UserSession, AuthContext } from '../types';
import { Database } from '../db/database';

export class AuthService {
  constructor(
    private db: Database,
    private jwtSecret: string = 'your-jwt-secret-key'
  ) {}

  // 簡易認証実装（Phase 0用）
  async authenticateUser(email: string, tenantId: string): Promise<AuthContext | null> {
    // テナント確認
    const tenant = await this.db.getTenant(tenantId);
    if (!tenant) {
      throw new Error('Invalid tenant');
    }

    // ユーザー確認
    const user = await this.db.getUserByEmail(email, tenantId);
    if (!user) {
      throw new Error('User not found');
    }

    // セッション作成
    const sessionId = this.generateId();
    const tokenHash = this.generateTokenHash();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24時間後

    const session = await this.db.createSession({
      id: sessionId,
      user_id: user.id,
      tenant_id: tenantId,
      token_hash: tokenHash,
      expires_at: expiresAt
    });

    // 最終ログイン時刻更新
    await this.db.updateUserLastLogin(user.id, tenantId);

    // 権限設定
    const permissions = this.getUserPermissions(user, tenant);

    return {
      user,
      tenant,
      session,
      permissions
    };
  }

  // セッション検証
  async validateSession(tokenHash: string): Promise<AuthContext | null> {
    const session = await this.db.getValidSession(tokenHash);
    if (!session) {
      return null;
    }

    const user = await this.db.getUser(session.user_id, session.tenant_id);
    const tenant = await this.db.getTenant(session.tenant_id);

    if (!user || !tenant) {
      return null;
    }

    const permissions = this.getUserPermissions(user, tenant);

    return {
      user,
      tenant,
      session,
      permissions
    };
  }

  // ログアウト
  async logout(sessionId: string): Promise<void> {
    await this.db.deleteSession(sessionId);
  }

  // テナント識別（ドメインベース）
  async identifyTenant(host: string): Promise<Tenant | null> {
    // サブドメインまたはカスタムドメインからテナント識別
    const domain = this.extractDomain(host);
    
    // ドメインでテナント検索
    let tenant = await this.db.getTenantByDomain(domain);
    
    // デフォルトテナント（開発用）
    if (!tenant && (host.includes('localhost') || host.includes('127.0.0.1') || host.includes('.pages.dev'))) {
      tenant = await this.db.getTenant('bga-internal');
    }

    return tenant;
  }

  // ユーザー権限取得
  private getUserPermissions(user: User, tenant: Tenant): string[] {
    const permissions: string[] = [];

    // 基本権限
    permissions.push('read:own_content', 'create:content');

    // テナント別権限
    switch (tenant.security_level) {
      case 'internal':
        if (user.role_internal) {
          permissions.push(...this.getInternalPermissions(user.role_internal));
        }
        break;
      case 'client':
        if (user.role_client) {
          permissions.push(...this.getClientPermissions(user.role_client));
        }
        break;
      case 'saas':
        if (user.role_saas) {
          permissions.push(...this.getSaasPermissions(user.role_saas));
        }
        break;
    }

    return permissions;
  }

  private getInternalPermissions(role: 'admin' | 'director' | 'producer' | 'member'): string[] {
    const basePermissions = ['read:content', 'create:content', 'read:templates'];
    
    switch (role) {
      case 'admin':
        return [
          ...basePermissions,
          'manage:users',
          'manage:tenants',
          'manage:templates',
          'read:all_content',
          'approve:content',
          'manage:legal_checks',
          'read:analytics',
          'manage:api_integrations'
        ];
      case 'director':
        return [
          ...basePermissions,
          'read:all_content',
          'approve:content',
          'read:legal_checks',
          'read:analytics',
          'manage:api_integrations'
        ];
      case 'producer':
        return [
          ...basePermissions,
          'read:team_content',
          'review:content',
          'read:legal_checks',
          'read:analytics'
        ];
      case 'member':
        return basePermissions;
      default:
        return basePermissions;
    }
  }

  private getClientPermissions(role: 'stakeholder' | 'approver' | 'viewer'): string[] {
    const basePermissions = ['read:own_content'];
    
    switch (role) {
      case 'stakeholder':
        return [
          ...basePermissions,
          'read:all_content',
          'approve:content',
          'read:analytics',
          'create:content'
        ];
      case 'approver':
        return [
          ...basePermissions,
          'read:pending_content',
          'approve:content',
          'create:content'
        ];
      case 'viewer':
        return [
          ...basePermissions,
          'read:approved_content'
        ];
      default:
        return basePermissions;
    }
  }

  private getSaasPermissions(role: 'owner' | 'admin' | 'editor' | 'viewer'): string[] {
    const basePermissions = ['read:own_content'];
    
    switch (role) {
      case 'owner':
        return [
          ...basePermissions,
          'manage:tenant',
          'manage:users',
          'manage:billing',
          'read:all_content',
          'create:content',
          'approve:content',
          'read:analytics',
          'manage:api_integrations'
        ];
      case 'admin':
        return [
          ...basePermissions,
          'manage:users',
          'read:all_content',
          'create:content',
          'approve:content',
          'read:analytics',
          'manage:api_integrations'
        ];
      case 'editor':
        return [
          ...basePermissions,
          'create:content',
          'read:team_content',
          'read:analytics'
        ];
      case 'viewer':
        return [
          ...basePermissions,
          'read:approved_content',
          'read:analytics'
        ];
      default:
        return basePermissions;
    }
  }

  // ユーティリティメソッド
  private extractDomain(host: string): string {
    // ポート番号を除去
    const hostname = host.split(':')[0];
    
    // サブドメインを考慮したドメイン抽出
    const parts = hostname.split('.');
    if (parts.length >= 2) {
      return parts.slice(-2).join('.');
    }
    return hostname;
  }

  private generateId(): string {
    return crypto.randomUUID();
  }

  private generateTokenHash(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  // 権限チェック
  hasPermission(permissions: string[], requiredPermission: string): boolean {
    return permissions.includes(requiredPermission);
  }

  // セキュリティレベルチェック
  checkSecurityLevel(tenant: Tenant, requiredLevel: 'internal' | 'client' | 'saas'): boolean {
    const levels = ['internal', 'client', 'saas'];
    const currentLevelIndex = levels.indexOf(tenant.security_level);
    const requiredLevelIndex = levels.indexOf(requiredLevel);
    
    return currentLevelIndex >= requiredLevelIndex;
  }
}