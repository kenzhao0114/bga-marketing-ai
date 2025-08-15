/**
 * 自動コンテンツ生成システム
 * 夜間に実行され、各種コンテンツを自動生成してキューに保存
 */

import { Database } from '../db/database';
import { ContentGenerationService } from './content-generator';

export interface AutomationSchedule {
  id: number;
  user_id: number;
  tenant_id: number;
  content_type: 'seo_article' | 'press_release' | 'recruitment' | 'sns';
  frequency: 'daily' | 'weekly' | 'monthly';
  frequency_count: number;
  schedule_time: string;
  is_active: boolean;
  last_generated_at?: string;
  next_generation_at?: string;
}

export interface ContentQueueItem {
  id?: number;
  user_id: number;
  tenant_id: number;
  schedule_id: number;
  content_type: string;
  title: string;
  content: string;
  metadata?: string;
  status: 'pending' | 'delivered' | 'failed';
  quality_score?: number;
  generated_at?: string;
  delivered_at?: string;
  delivery_method?: string;
}

export class ContentAutomationService {
  constructor(
    private db: Database,
    private contentGenerator: ContentGenerationService
  ) {}

  /**
   * メインの自動化実行ロジック - cron jobから呼び出される
   */
  async runAutomation(): Promise<void> {
    console.log('[ContentAutomation] Starting automated content generation...');
    
    try {
      // 現在時刻で実行予定のスケジュールを取得
      const schedules = await this.getSchedulesToRun();
      console.log(`[ContentAutomation] Found ${schedules.length} schedules to run`);

      for (const schedule of schedules) {
        await this.processSchedule(schedule);
      }

      console.log('[ContentAutomation] Automated content generation completed');
    } catch (error) {
      console.error('[ContentAutomation] Error during automation:', error);
      throw error;
    }
  }

  /**
   * 実行予定のスケジュールを取得
   */
  private async getSchedulesToRun(): Promise<AutomationSchedule[]> {
    const currentTime = new Date().toTimeString().substring(0, 5); // HH:MM format
    const currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

    const query = `
      SELECT * FROM content_automation_schedules 
      WHERE is_active = true 
      AND schedule_time <= ? 
      AND (next_generation_at IS NULL OR next_generation_at <= datetime('now'))
      ORDER BY schedule_time ASC
    `;

    const result = await this.db.query(query, [currentTime]);
    return result.results as AutomationSchedule[];
  }

  /**
   * 個別のスケジュールを処理
   */
  private async processSchedule(schedule: AutomationSchedule): Promise<void> {
    console.log(`[ContentAutomation] Processing schedule ID ${schedule.id} for content type: ${schedule.content_type}`);

    try {
      // ユーザー情報を取得
      const userQuery = `
        SELECT u.*, t.name as tenant_name, t.industry as tenant_industry 
        FROM users u 
        JOIN tenants t ON u.tenant_id = t.id 
        WHERE u.id = ? AND u.tenant_id = ?
      `;
      const userResult = await this.db.query(userQuery, [schedule.user_id, schedule.tenant_id]);
      const user = userResult.results[0] as any;

      if (!user) {
        console.warn(`[ContentAutomation] User not found for schedule ${schedule.id}`);
        return;
      }

      // コンテンツタイプに応じて生成数を決定
      const contentCount = this.getContentCountForSchedule(schedule);
      
      // 指定された数のコンテンツを生成
      for (let i = 0; i < contentCount; i++) {
        const content = await this.generateContentForSchedule(schedule, user, i + 1);
        if (content) {
          await this.addToContentQueue(content);
        }
      }

      // 次回実行時刻を更新
      await this.updateNextGenerationTime(schedule);

      console.log(`[ContentAutomation] Successfully processed schedule ${schedule.id}, generated ${contentCount} items`);
    } catch (error) {
      console.error(`[ContentAutomation] Error processing schedule ${schedule.id}:`, error);
    }
  }

  /**
   * スケジュールに基づくコンテンツ生成数を決定
   */
  private getContentCountForSchedule(schedule: AutomationSchedule): number {
    switch (schedule.content_type) {
      case 'seo_article':
        return schedule.frequency === 'monthly' ? Math.ceil(schedule.frequency_count / 30) : schedule.frequency_count;
      case 'press_release':
        return schedule.frequency === 'monthly' ? Math.ceil(schedule.frequency_count / 30) : schedule.frequency_count;
      case 'recruitment':
        return schedule.frequency === 'weekly' ? Math.ceil(schedule.frequency_count / 7) : schedule.frequency_count;
      case 'sns':
        return schedule.frequency_count; // 通常は日2本
      default:
        return 1;
    }
  }

  /**
   * スケジュールに基づいてコンテンツを生成
   */
  private async generateContentForSchedule(
    schedule: AutomationSchedule, 
    user: any, 
    sequenceNumber: number
  ): Promise<ContentQueueItem | null> {
    try {
      const contentPrompt = this.buildContentPrompt(schedule.content_type, user, sequenceNumber);
      const templateName = this.getTemplateForContentType(schedule.content_type);

      // コンテンツ生成を実行
      const generatedContent = await this.contentGenerator.generateContent({
        user_id: schedule.user_id,
        tenant_id: schedule.tenant_id,
        industry: user.industry || 'technology',
        company_stage: user.company_stage || 'growth',
        template_name: templateName,
        custom_prompt: contentPrompt,
        target_channel: this.getChannelForContentType(schedule.content_type)
      });

      if (!generatedContent.success) {
        console.error(`[ContentAutomation] Failed to generate content: ${generatedContent.error}`);
        return null;
      }

      const content = generatedContent.data;
      
      return {
        user_id: schedule.user_id,
        tenant_id: schedule.tenant_id,
        schedule_id: schedule.id,
        content_type: schedule.content_type,
        title: content.title || this.generateDefaultTitle(schedule.content_type, sequenceNumber),
        content: content.content,
        metadata: JSON.stringify({
          template_name: templateName,
          sequence_number: sequenceNumber,
          generated_at: new Date().toISOString(),
          industry: user.industry,
          plan: user.plan
        }),
        status: 'pending',
        quality_score: content.quality_score || 0.8
      };
    } catch (error) {
      console.error(`[ContentAutomation] Error generating content for schedule ${schedule.id}:`, error);
      return null;
    }
  }

  /**
   * コンテンツタイプに基づいてプロンプトを構築
   */
  private buildContentPrompt(contentType: string, user: any, sequenceNumber: number): string {
    const industry = user.industry || 'technology';
    const companyName = user.tenant_name || 'Your Company';
    const currentDate = new Date().toLocaleDateString('ja-JP');

    switch (contentType) {
      case 'seo_article':
        return `${industry}業界向けのSEO最適化された記事を作成してください。
                企業名: ${companyName}
                対象業界: ${industry}
                記事番号: ${sequenceNumber}
                作成日: ${currentDate}
                
                以下の要素を含めてください：
                - 業界のトレンドや課題
                - 実践的なソリューション
                - 具体的な事例や数値
                - 検索キーワードを自然に含める
                - 読者にとって価値のある情報`;

      case 'press_release':
        return `${companyName}の${industry}業界でのプレスリリースを作成してください。
                企業名: ${companyName}
                業界: ${industry}
                発行日: ${currentDate}
                
                以下の内容を含めてください：
                - 新サービス・製品の発表
                - 業界への貢献や革新性
                - 具体的な効果や成果
                - 今後の展望
                - メディア向けの魅力的な内容`;

      case 'recruitment':
        return `${companyName}の採用コンテンツを作成してください。
                企業名: ${companyName}
                業界: ${industry}
                コンテンツ番号: ${sequenceNumber}
                
                以下の要素を含めてください：
                - 働きがいや企業文化
                - キャリア成長の機会
                - 業界での位置づけと将来性
                - 具体的な職種や求める人材像
                - 応募者にとって魅力的な内容`;

      case 'sns':
        return `${companyName}のSNS投稿用コンテンツを作成してください。
                企業名: ${companyName}
                業界: ${industry}
                投稿番号: ${sequenceNumber}
                日付: ${currentDate}
                
                以下の特徴を持たせてください：
                - エンゲージメントを促進する内容
                - 業界の専門性をアピール
                - フォロワーにとって有益な情報
                - 適切なハッシュタグの提案
                - 簡潔で分かりやすい表現`;

      default:
        return `${industry}業界向けのマーケティングコンテンツを作成してください。`;
    }
  }

  /**
   * コンテンツタイプに基づいてテンプレートを選択
   */
  private getTemplateForContentType(contentType: string): string {
    switch (contentType) {
      case 'seo_article':
        return 'blog_article';
      case 'press_release':
        return 'press_release';
      case 'recruitment':
        return 'recruitment_content';
      case 'sns':
        return 'social_media_post';
      default:
        return 'general_content';
    }
  }

  /**
   * コンテンツタイプに基づいてチャネルを決定
   */
  private getChannelForContentType(contentType: string): string {
    switch (contentType) {
      case 'seo_article':
        return 'blog';
      case 'press_release':
        return 'press';
      case 'recruitment':
        return 'recruitment';
      case 'sns':
        return 'social_media';
      default:
        return 'web';
    }
  }

  /**
   * デフォルトタイトルを生成
   */
  private generateDefaultTitle(contentType: string, sequenceNumber: number): string {
    const currentDate = new Date().toLocaleDateString('ja-JP');
    
    switch (contentType) {
      case 'seo_article':
        return `SEO記事 #${sequenceNumber} - ${currentDate}`;
      case 'press_release':
        return `プレスリリース - ${currentDate}`;
      case 'recruitment':
        return `採用コンテンツ #${sequenceNumber} - ${currentDate}`;
      case 'sns':
        return `SNS投稿 #${sequenceNumber} - ${currentDate}`;
      default:
        return `自動生成コンテンツ #${sequenceNumber} - ${currentDate}`;
    }
  }

  /**
   * コンテンツをキューに追加
   */
  private async addToContentQueue(content: ContentQueueItem): Promise<void> {
    const query = `
      INSERT INTO automated_content_queue 
      (user_id, tenant_id, schedule_id, content_type, title, content, metadata, status, quality_score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await this.db.execute(query, [
      content.user_id,
      content.tenant_id,
      content.schedule_id,
      content.content_type,
      content.title,
      content.content,
      content.metadata,
      content.status,
      content.quality_score
    ]);
  }

  /**
   * 次回実行時刻を更新
   */
  private async updateNextGenerationTime(schedule: AutomationSchedule): Promise<void> {
    const nextGeneration = this.calculateNextGenerationTime(schedule);
    
    const query = `
      UPDATE content_automation_schedules 
      SET last_generated_at = datetime('now'), 
          next_generation_at = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `;

    await this.db.execute(query, [nextGeneration, schedule.id]);
  }

  /**
   * 次回実行時刻を計算
   */
  private calculateNextGenerationTime(schedule: AutomationSchedule): string {
    const now = new Date();
    let nextTime = new Date();

    switch (schedule.frequency) {
      case 'daily':
        nextTime.setDate(now.getDate() + 1);
        break;
      case 'weekly':
        nextTime.setDate(now.getDate() + 7);
        break;
      case 'monthly':
        nextTime.setMonth(now.getMonth() + 1);
        break;
    }

    // スケジュール時刻を設定
    const [hours, minutes] = schedule.schedule_time.split(':');
    nextTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);

    return nextTime.toISOString();
  }

  /**
   * 生成されたコンテンツを取得（配信システム用）
   */
  async getPendingContentForDelivery(userId: number, tenantId: number): Promise<ContentQueueItem[]> {
    const query = `
      SELECT * FROM automated_content_queue 
      WHERE user_id = ? AND tenant_id = ? AND status = 'pending'
      ORDER BY generated_at ASC
    `;

    const result = await this.db.query(query, [userId, tenantId]);
    return result.results as ContentQueueItem[];
  }

  /**
   * コンテンツを配信済みにマーク
   */
  async markContentAsDelivered(contentId: number, deliveryMethod: string): Promise<void> {
    const query = `
      UPDATE automated_content_queue 
      SET status = 'delivered', 
          delivered_at = datetime('now'),
          delivery_method = ?
      WHERE id = ?
    `;

    await this.db.execute(query, [deliveryMethod, contentId]);
  }

  /**
   * ユーザーの自動化設定を取得
   */
  async getUserAutomationSchedules(userId: number, tenantId: number): Promise<AutomationSchedule[]> {
    const query = `
      SELECT * FROM content_automation_schedules 
      WHERE user_id = ? AND tenant_id = ?
      ORDER BY content_type, schedule_time
    `;

    const result = await this.db.query(query, [userId, tenantId]);
    return result.results as AutomationSchedule[];
  }

  /**
   * 自動化設定を更新
   */
  async updateAutomationSchedule(scheduleId: number, updates: Partial<AutomationSchedule>): Promise<void> {
    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = Object.values(updates);

    const query = `
      UPDATE content_automation_schedules 
      SET ${fields}, updated_at = datetime('now')
      WHERE id = ?
    `;

    await this.db.execute(query, [...values, scheduleId]);
  }
}