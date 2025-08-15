/**
 * コンテンツ配信システム
 * 朝7:30にコンテンツを配信・通知する
 */

import { Database } from '../db/database';
import { ContentAutomationService, ContentQueueItem } from './content-automation';

export interface DeliverySchedule {
  id: number;
  user_id: number;
  tenant_id: number;
  delivery_type: 'email' | 'dashboard' | 'api_webhook';
  delivery_time: string;
  is_active: boolean;
  delivery_channels?: string;
  last_delivered_at?: string;
  next_delivery_at?: string;
}

export interface DeliveryNotification {
  user_id: number;
  tenant_id: number;
  content_summary: {
    total_items: number;
    seo_articles: number;
    press_releases: number;
    recruitment_content: number;
    sns_posts: number;
  };
  content_items: ContentQueueItem[];
  delivery_time: string;
  delivery_method: string;
}

export class ContentDeliveryService {
  constructor(
    private db: Database,
    private contentAutomation: ContentAutomationService
  ) {}

  /**
   * メインの配信実行ロジック - cron jobから呼び出される
   */
  async runDelivery(): Promise<void> {
    console.log('[ContentDelivery] Starting content delivery process...');
    
    try {
      // 現在時刻で配信予定のスケジュールを取得
      const schedules = await this.getSchedulesToDeliver();
      console.log(`[ContentDelivery] Found ${schedules.length} delivery schedules to run`);

      for (const schedule of schedules) {
        await this.processDeliverySchedule(schedule);
      }

      console.log('[ContentDelivery] Content delivery process completed');
    } catch (error) {
      console.error('[ContentDelivery] Error during delivery:', error);
      throw error;
    }
  }

  /**
   * 配信予定のスケジュールを取得
   */
  private async getSchedulesToDeliver(): Promise<DeliverySchedule[]> {
    const currentTime = new Date().toTimeString().substring(0, 5); // HH:MM format
    
    const query = `
      SELECT * FROM content_delivery_schedules 
      WHERE is_active = true 
      AND delivery_time <= ?
      AND (next_delivery_at IS NULL OR next_delivery_at <= datetime('now'))
      ORDER BY delivery_time ASC
    `;

    const result = await this.db.query(query, [currentTime]);
    return result.results as DeliverySchedule[];
  }

  /**
   * 個別の配信スケジュールを処理
   */
  private async processDeliverySchedule(schedule: DeliverySchedule): Promise<void> {
    console.log(`[ContentDelivery] Processing delivery schedule ID ${schedule.id} for user ${schedule.user_id}`);

    try {
      // ユーザーの未配信コンテンツを取得
      const pendingContent = await this.contentAutomation.getPendingContentForDelivery(
        schedule.user_id, 
        schedule.tenant_id
      );

      if (pendingContent.length === 0) {
        console.log(`[ContentDelivery] No pending content found for user ${schedule.user_id}`);
        await this.updateNextDeliveryTime(schedule);
        return;
      }

      // ユーザー情報を取得
      const userQuery = `
        SELECT u.*, t.name as tenant_name, t.email as tenant_email 
        FROM users u 
        JOIN tenants t ON u.tenant_id = t.id 
        WHERE u.id = ? AND u.tenant_id = ?
      `;
      const userResult = await this.db.query(userQuery, [schedule.user_id, schedule.tenant_id]);
      const user = userResult.results[0] as any;

      if (!user) {
        console.warn(`[ContentDelivery] User not found for delivery schedule ${schedule.id}`);
        return;
      }

      // 配信通知を作成
      const notification = this.createDeliveryNotification(schedule, user, pendingContent);

      // 配信タイプに応じて配信を実行
      switch (schedule.delivery_type) {
        case 'dashboard':
          await this.deliverToDashboard(notification);
          break;
        case 'email':
          await this.deliverToEmail(notification);
          break;
        case 'api_webhook':
          await this.deliverToWebhook(notification);
          break;
        default:
          console.warn(`[ContentDelivery] Unknown delivery type: ${schedule.delivery_type}`);
      }

      // コンテンツを配信済みにマーク
      for (const content of pendingContent) {
        if (content.id) {
          await this.contentAutomation.markContentAsDelivered(content.id, schedule.delivery_type);
        }
      }

      // 次回配信時刻を更新
      await this.updateNextDeliveryTime(schedule);

      console.log(`[ContentDelivery] Successfully delivered ${pendingContent.length} items to user ${schedule.user_id}`);
    } catch (error) {
      console.error(`[ContentDelivery] Error processing delivery schedule ${schedule.id}:`, error);
    }
  }

  /**
   * 配信通知を作成
   */
  private createDeliveryNotification(
    schedule: DeliverySchedule, 
    user: any, 
    contentItems: ContentQueueItem[]
  ): DeliveryNotification {
    const summary = {
      total_items: contentItems.length,
      seo_articles: contentItems.filter(item => item.content_type === 'seo_article').length,
      press_releases: contentItems.filter(item => item.content_type === 'press_release').length,
      recruitment_content: contentItems.filter(item => item.content_type === 'recruitment').length,
      sns_posts: contentItems.filter(item => item.content_type === 'sns').length
    };

    return {
      user_id: schedule.user_id,
      tenant_id: schedule.tenant_id,
      content_summary: summary,
      content_items: contentItems,
      delivery_time: new Date().toISOString(),
      delivery_method: schedule.delivery_type
    };
  }

  /**
   * ダッシュボードに配信
   */
  private async deliverToDashboard(notification: DeliveryNotification): Promise<void> {
    console.log(`[ContentDelivery] Delivering to dashboard for user ${notification.user_id}`);
    
    // ダッシュボード通知テーブルに保存
    const query = `
      INSERT INTO dashboard_notifications 
      (user_id, tenant_id, notification_type, title, content, data, created_at)
      VALUES (?, ?, 'content_delivery', ?, ?, ?, datetime('now'))
    `;

    const title = `新しいコンテンツが準備できました (${notification.content_summary.total_items}件)`;
    const content = this.formatNotificationContent(notification);
    const data = JSON.stringify(notification);

    try {
      await this.db.execute(query, [
        notification.user_id,
        notification.tenant_id,
        title,
        content,
        data
      ]);
    } catch (error) {
      // テーブルが存在しない場合は作成
      if (error.message?.includes('no such table')) {
        await this.createNotificationsTable();
        await this.db.execute(query, [
          notification.user_id,
          notification.tenant_id,
          title,
          content,
          data
        ]);
      } else {
        throw error;
      }
    }
  }

  /**
   * 通知テーブルを作成
   */
  private async createNotificationsTable(): Promise<void> {
    const query = `
      CREATE TABLE IF NOT EXISTS dashboard_notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        tenant_id INTEGER NOT NULL,
        notification_type TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        data TEXT,
        is_read BOOLEAN DEFAULT false,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        read_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
      )
    `;
    
    await this.db.execute(query, []);
    
    // インデックスを作成
    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS idx_dashboard_notifications_user_tenant 
      ON dashboard_notifications(user_id, tenant_id)
    `, []);
  }

  /**
   * 通知コンテンツをフォーマット
   */
  private formatNotificationContent(notification: DeliveryNotification): string {
    const { content_summary } = notification;
    const parts = [];

    if (content_summary.seo_articles > 0) {
      parts.push(`SEO記事: ${content_summary.seo_articles}件`);
    }
    if (content_summary.press_releases > 0) {
      parts.push(`プレスリリース: ${content_summary.press_releases}件`);
    }
    if (content_summary.recruitment_content > 0) {
      parts.push(`採用コンテンツ: ${content_summary.recruitment_content}件`);
    }
    if (content_summary.sns_posts > 0) {
      parts.push(`SNS投稿: ${content_summary.sns_posts}件`);
    }

    return `自動生成されたコンテンツをご確認ください：${parts.join('、')}`;
  }

  /**
   * メール配信 (将来の実装用)
   */
  private async deliverToEmail(notification: DeliveryNotification): Promise<void> {
    console.log(`[ContentDelivery] Email delivery not implemented yet for user ${notification.user_id}`);
    // TODO: メール配信システムとの連携を実装
  }

  /**
   * Webhook配信 (将来の実装用)
   */
  private async deliverToWebhook(notification: DeliveryNotification): Promise<void> {
    console.log(`[ContentDelivery] Webhook delivery not implemented yet for user ${notification.user_id}`);
    // TODO: Webhook配信システムとの連携を実装
  }

  /**
   * 次回配信時刻を更新
   */
  private async updateNextDeliveryTime(schedule: DeliverySchedule): Promise<void> {
    const nextDelivery = this.calculateNextDeliveryTime(schedule);
    
    const query = `
      UPDATE content_delivery_schedules 
      SET last_delivered_at = datetime('now'), 
          next_delivery_at = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `;

    await this.db.execute(query, [nextDelivery, schedule.id]);
  }

  /**
   * 次回配信時刻を計算
   */
  private calculateNextDeliveryTime(schedule: DeliverySchedule): string {
    const now = new Date();
    const nextTime = new Date();
    
    // 翌日の同時刻に設定
    nextTime.setDate(now.getDate() + 1);
    
    // 配信時刻を設定
    const [hours, minutes] = schedule.delivery_time.split(':');
    nextTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);

    return nextTime.toISOString();
  }

  /**
   * ユーザーの配信設定を取得
   */
  async getUserDeliverySchedules(userId: number, tenantId: number): Promise<DeliverySchedule[]> {
    const query = `
      SELECT * FROM content_delivery_schedules 
      WHERE user_id = ? AND tenant_id = ?
      ORDER BY delivery_time
    `;

    const result = await this.db.query(query, [userId, tenantId]);
    return result.results as DeliverySchedule[];
  }

  /**
   * 配信設定を更新
   */
  async updateDeliverySchedule(scheduleId: number, updates: Partial<DeliverySchedule>): Promise<void> {
    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = Object.values(updates);

    const query = `
      UPDATE content_delivery_schedules 
      SET ${fields}, updated_at = datetime('now')
      WHERE id = ?
    `;

    await this.db.execute(query, [...values, scheduleId]);
  }

  /**
   * ダッシュボード通知を取得
   */
  async getDashboardNotifications(userId: number, tenantId: number, limit: number = 20): Promise<any[]> {
    const query = `
      SELECT * FROM dashboard_notifications 
      WHERE user_id = ? AND tenant_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `;

    try {
      const result = await this.db.query(query, [userId, tenantId, limit]);
      return result.results as any[];
    } catch (error) {
      if (error.message?.includes('no such table')) {
        await this.createNotificationsTable();
        return [];
      }
      throw error;
    }
  }

  /**
   * 通知を既読にマーク
   */
  async markNotificationAsRead(notificationId: number): Promise<void> {
    const query = `
      UPDATE dashboard_notifications 
      SET is_read = true, read_at = datetime('now')
      WHERE id = ?
    `;

    await this.db.execute(query, [notificationId]);
  }

  /**
   * 即座にテスト配信を実行 (開発・テスト用)
   */
  async runTestDelivery(userId: number, tenantId: number): Promise<void> {
    console.log(`[ContentDelivery] Running test delivery for user ${userId}`);
    
    // ユーザーの配信設定を取得
    const schedules = await this.getUserDeliverySchedules(userId, tenantId);
    
    if (schedules.length === 0) {
      throw new Error('No delivery schedules found for user');
    }

    // 最初の配信設定を使用してテスト配信を実行
    await this.processDeliverySchedule(schedules[0]);
  }
}