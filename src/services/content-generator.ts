// AIコンテンツ生成エンジン - LocalePack対応

import { Env, IndustryTemplate, LocalePack, ContentGenerationRequest, ContentGenerationResponse } from '../types';
import { Database } from '../db/database';

export class ContentGenerationService {
  constructor(
    private db: Database,
    private ai?: Ai,
    private openaiApiKey?: string
  ) {}

  // メインのコンテンツ生成メソッド
  async generateContent(
    tenantId: string,
    userId: string,
    request: ContentGenerationRequest
  ): Promise<ContentGenerationResponse> {
    try {
      // テンプレート情報取得
      const industry = request.industry_id ? await this.db.getTemplateById(request.industry_id) : null;
      const growthStage = request.growth_stage_id ? await this.db.getTemplateById(request.growth_stage_id) : null;
      const channel = request.channel_id ? await this.db.getTemplateById(request.channel_id) : null;

      // LocalePack統合
      const localePack = this.combineLocalePacks(industry?.locale_pack, growthStage?.locale_pack, channel?.locale_pack);

      // プロンプト構築
      const enhancedPrompt = this.buildEnhancedPrompt(request.prompt, localePack, industry, growthStage, channel);

      // AI生成実行
      const generatedContent = await this.generateWithAI(enhancedPrompt);

      // 品質スコア計算
      const qualityScore = this.calculateQualityScore(generatedContent, localePack);

      // 生成履歴保存
      const contentId = crypto.randomUUID();
      const contentGeneration = await this.db.createContentGeneration({
        id: contentId,
        tenant_id: tenantId,
        user_id: userId,
        industry_id: request.industry_id,
        growth_stage_id: request.growth_stage_id,
        channel_id: request.channel_id,
        input_prompt: request.prompt,
        generated_content: generatedContent,
        locale_pack_data: localePack,
        quality_score: qualityScore,
        legal_check_status: 'pending',
        approval_status: 'draft'
      });

      return {
        id: contentId,
        generated_content: generatedContent,
        quality_score: qualityScore,
        legal_check_status: 'pending',
        suggestions: this.generateSuggestions(generatedContent, localePack)
      };
    } catch (error) {
      console.error('Content generation error:', error);
      throw new Error('Failed to generate content');
    }
  }

  // LocalePack統合ロジック
  private combineLocalePacks(...packs: (LocalePack | undefined)[]): LocalePack {
    const combined: LocalePack = {};
    
    for (const pack of packs) {
      if (pack) {
        // 基本プロパティのマージ
        Object.assign(combined, pack);
        
        // 配列のマージ
        if (pack.key_terms) {
          combined.key_terms = [...(combined.key_terms || []), ...pack.key_terms];
        }
        if (pack.focus) {
          combined.focus = [...(combined.focus || []), ...pack.focus];
        }
        if (pack.structure) {
          combined.structure = [...(combined.structure || []), ...pack.structure];
        }
        
        // 季節性コンテキストのマージ
        if (pack.seasonal_context) {
          combined.seasonal_context = {
            ...combined.seasonal_context,
            ...pack.seasonal_context
          };
        }
      }
    }

    return combined;
  }

  // 拡張プロンプト構築
  private buildEnhancedPrompt(
    originalPrompt: string,
    localePack: LocalePack,
    industry?: IndustryTemplate | null,
    growthStage?: IndustryTemplate | null,
    channel?: IndustryTemplate | null
  ): string {
    const currentSeason = this.getCurrentSeason();
    const currentMonth = new Date().toLocaleDateString('ja-JP', { month: 'long' });
    
    let enhancedPrompt = `【日本のB2Bマーケティング専門AI】として以下の要件でコンテンツを生成してください。

【基本要求】
${originalPrompt}

【コンテキスト情報】`;

    // 業界情報
    if (industry) {
      enhancedPrompt += `
・対象業界: ${industry.name}`;
    }

    // 成長ステージ情報
    if (growthStage) {
      enhancedPrompt += `
・企業ステージ: ${growthStage.name}`;
    }

    // チャネル情報
    if (channel) {
      enhancedPrompt += `
・配信チャネル: ${channel.name}`;
    }

    // LocalePack活用
    enhancedPrompt += `

【日本特化ガイドライン】`;

    if (localePack.formal_level) {
      const formalityMap = {
        'casual': 'カジュアルで親しみやすい',
        'semi_formal': '適度にフォーマルで親近感のある',
        'formal': 'フォーマルで信頼感のある',
        'very_formal': '非常にフォーマルで権威性の高い'
      };
      enhancedPrompt += `
・敬語レベル: ${formalityMap[localePack.formal_level]}文体`;
    }

    if (localePack.tone) {
      enhancedPrompt += `
・トーン: ${localePack.tone}`;
    }

    if (localePack.key_terms && localePack.key_terms.length > 0) {
      enhancedPrompt += `
・重要キーワード: ${localePack.key_terms.join('、')}`;
    }

    if (localePack.focus && localePack.focus.length > 0) {
      enhancedPrompt += `
・重点ポイント: ${localePack.focus.join('、')}`;
    }

    if (localePack.budget_context) {
      enhancedPrompt += `
・予算コンテキスト: ${localePack.budget_context}`;
    }

    // 季節性考慮
    if (localePack.seasonal_context) {
      const seasonalContext = localePack.seasonal_context[currentSeason];
      if (seasonalContext) {
        enhancedPrompt += `
・季節性考慮: ${currentMonth}の${seasonalContext}を意識`;
      }
    }

    // 構造ガイドライン
    if (localePack.structure && localePack.structure.length > 0) {
      enhancedPrompt += `

【構成要素】
${localePack.structure.map((item, index) => `${index + 1}. ${item}`).join('\n')}`;
    }

    // 出力形式指定
    enhancedPrompt += `

【出力要件】
・日本のビジネス慣習に沿った表現
・読みやすい適切な改行と構成
・具体的で説得力のある内容
・法令遵守を意識した表現（誇大広告の回避）
・ターゲットに響く価値提案`;

    return enhancedPrompt;
  }

  // AI生成実行
  private async generateWithAI(prompt: string): Promise<string> {
    try {
      // Cloudflare Workers AI使用
      if (this.ai) {
        const response = await this.ai.run('@cf/meta/llama-3.1-8b-instruct', {
          messages: [
            {
              role: 'system',
              content: '你是一个专业的日本B2B市场营销内容生成AI。请用日语生成高质量、符合日本商业文化的营销内容。'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          max_tokens: 2048,
          temperature: 0.7
        }) as any;

        return response.response || 'コンテンツ生成に失敗しました。';
      }

      // OpenAI APIフォールバック
      if (this.openaiApiKey) {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.openaiApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'gpt-3.5-turbo',
            messages: [
              {
                role: 'system',
                content: 'あなたは日本のB2Bマーケティング専門のプロフェッショナルです。日本のビジネス文化に精通し、効果的なマーケティングコンテンツを生成します。'
              },
              {
                role: 'user',
                content: prompt
              }
            ],
            max_tokens: 2048,
            temperature: 0.7
          })
        });

        const result = await response.json() as any;
        return result.choices?.[0]?.message?.content || 'コンテンツ生成に失敗しました。';
      }

      // フォールバック: テンプレートベース生成
      return this.generateTemplateContent(prompt);
    } catch (error) {
      console.error('AI generation error:', error);
      return this.generateTemplateContent(prompt);
    }
  }

  // テンプレートベース生成（フォールバック）
  private generateTemplateContent(prompt: string): string {
    const templates = [
      `【${this.extractTitle(prompt)}】

企業の皆様へ

平素よりお世話になっております。

この度、${this.extractKeyword(prompt)}に関する新たなソリューションをご提案させていただきたく、ご連絡いたします。

■概要
${this.extractKeyword(prompt)}の課題を解決し、企業様の生産性向上とコスト削減を実現いたします。

■主な特徴
・効率性の向上
・コストの最適化
・品質の確保

詳細につきましては、別途ご案内させていただきます。
ご不明な点がございましたら、お気軽にお問い合わせください。

今後ともよろしくお願いいたします。`,

      `🚀 ${this.extractTitle(prompt)}

${this.extractKeyword(prompt)}でお困りの企業様へ朗報です！

✅ 課題解決
✅ 効率向上  
✅ コスト削減

詳しくはお問い合わせください。
#${this.extractKeyword(prompt)} #効率化 #DX`
    ];

    return templates[Math.floor(Math.random() * templates.length)];
  }

  // 品質スコア計算
  private calculateQualityScore(content: string, localePack: LocalePack): number {
    let score = 5.0; // 基準点

    // 文字数チェック
    if (content.length < 50) score -= 2.0;
    else if (content.length < 100) score -= 1.0;
    else if (content.length > 2000) score -= 1.0;

    // キーワード含有チェック
    if (localePack.key_terms) {
      const keywordCount = localePack.key_terms.filter(term => 
        content.includes(term)
      ).length;
      score += (keywordCount / localePack.key_terms.length) * 2.0;
    }

    // 構造チェック
    if (localePack.structure) {
      let structureScore = 0;
      if (content.includes('■') || content.includes('●') || content.includes('・')) structureScore += 0.5;
      if (content.includes('\n\n')) structureScore += 0.5;
      score += structureScore;
    }

    // 日本語品質チェック（簡易）
    if (content.match(/[ですます]/g)) score += 0.5;
    if (content.match(/[。！？]/g)) score += 0.5;

    return Math.min(10.0, Math.max(0.0, score));
  }

  // 改善提案生成
  private generateSuggestions(content: string, localePack: LocalePack): string[] {
    const suggestions: string[] = [];

    if (content.length < 100) {
      suggestions.push('もう少し詳細な説明を追加することで、より説得力のあるコンテンツになります。');
    }

    if (localePack.key_terms) {
      const missingTerms = localePack.key_terms.filter(term => !content.includes(term));
      if (missingTerms.length > 0) {
        suggestions.push(`重要キーワード「${missingTerms.join('、')}」を含めることで、SEO効果が向上します。`);
      }
    }

    if (!content.includes('問い合わせ') && !content.includes('詳細') && !content.includes('お気軽に')) {
      suggestions.push('行動喚起（CTA）を追加することで、レスポンス率の向上が期待できます。');
    }

    if (localePack.format === 'press_release' && !content.includes('■')) {
      suggestions.push('プレスリリース形式では、見出しと箇条書きを活用すると読みやすくなります。');
    }

    return suggestions;
  }

  // ユーティリティメソッド
  private getCurrentSeason(): 'spring' | 'summer' | 'fall' | 'winter' {
    const month = new Date().getMonth() + 1;
    if (month >= 3 && month <= 5) return 'spring';
    if (month >= 6 && month <= 8) return 'summer';
    if (month >= 9 && month <= 11) return 'fall';
    return 'winter';
  }

  private extractTitle(prompt: string): string {
    const titleMatch = prompt.match(/([^。！？\n]+)/);
    return titleMatch ? titleMatch[1].slice(0, 50) : 'マーケティングコンテンツ';
  }

  private extractKeyword(prompt: string): string {
    const keywords = ['AI', 'DX', 'マーケティング', 'システム', 'サービス', 'ソリューション'];
    for (const keyword of keywords) {
      if (prompt.includes(keyword)) return keyword;
    }
    return 'ビジネス';
  }

  // バッチ生成（複数コンテンツ同時生成）
  async generateBatch(
    tenantId: string,
    userId: string,
    requests: ContentGenerationRequest[]
  ): Promise<ContentGenerationResponse[]> {
    const results: ContentGenerationResponse[] = [];
    
    for (const request of requests) {
      try {
        const result = await this.generateContent(tenantId, userId, request);
        results.push(result);
      } catch (error) {
        console.error(`Batch generation error for request:`, error);
        results.push({
          id: crypto.randomUUID(),
          generated_content: 'コンテンツ生成に失敗しました。',
          quality_score: 0,
          legal_check_status: 'failed',
          suggestions: ['生成処理でエラーが発生しました。再試行してください。']
        });
      }
    }
    
    return results;
  }
}