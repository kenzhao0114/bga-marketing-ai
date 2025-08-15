// 法令チェックシステム - 景表法・薬機法対応

import { Env, LegalCheckResult } from '../types';
import { Database } from '../db/database';

export class LegalCheckService {
  constructor(private db: Database) {}

  // メイン法令チェック
  async checkContent(contentId: string, content: string): Promise<LegalCheckResult[]> {
    const results: LegalCheckResult[] = [];

    try {
      // 景表法チェック
      const keikyohyoResult = await this.checkKeikyohyo(contentId, content);
      results.push(keikyohyoResult);

      // 薬機法チェック
      const yakukihoResult = await this.checkYakukiho(contentId, content);
      results.push(yakukihoResult);

      // 金商法チェック（基本版）
      const kinshohoResult = await this.checkKinshoho(contentId, content);
      results.push(kinshohoResult);

      // データベースに保存
      for (const result of results) {
        await this.db.createLegalCheckResult(result);
      }

      return results;
    } catch (error) {
      console.error('Legal check error:', error);
      throw new Error('法令チェックの実行に失敗しました');
    }
  }

  // 景表法（不当景品類及び不当表示防止法）チェック
  private async checkKeikyohyo(contentId: string, content: string): Promise<LegalCheckResult> {
    const violations: string[] = [];
    let riskLevel: 1 | 2 | 3 | 4 | 5 = 1;
    let checkStatus: 'passed' | 'warning' | 'violation' = 'passed';

    // 優良誤認表示のチェック
    const excellencePatterns = [
      /[一番最もNo\.?1]/gi,
      /[業界初世界初日本初]/gi,
      /[100%完全完璧絶対]/gi,
      /[効果抜群驚異的]/gi,
      /[必ず確実間違いなく]/gi,
      /[史上最高最強最速]/gi
    ];

    for (const pattern of excellencePatterns) {
      if (pattern.test(content)) {
        violations.push(`優良誤認の可能性: "${content.match(pattern)?.[0]}" のような表現は根拠が必要です`);
        riskLevel = Math.max(riskLevel, 3) as 1 | 2 | 3 | 4 | 5;
        checkStatus = 'warning';
      }
    }

    // 有利誤認表示のチェック
    const advantagePatterns = [
      /[無料タダ0円]/gi,
      /[今だけ限定特別]/gi,
      /[大幅値下げ破格]/gi,
      /[通常価格.*円.*が.*円]/gi
    ];

    for (const pattern of advantagePatterns) {
      if (pattern.test(content)) {
        violations.push(`有利誤認の可能性: "${content.match(pattern)?.[0]}" の条件や期限を明確にしてください`);
        riskLevel = Math.max(riskLevel, 2) as 1 | 2 | 3 | 4 | 5;
        checkStatus = checkStatus === 'passed' ? 'warning' : checkStatus;
      }
    }

    // 誇大表現のチェック
    const exaggerationPatterns = [
      /[誰でも簡単すぐに即効]/gi,
      /[劇的革命的画期的]/gi,
      /[魔法的奇跡的]/gi
    ];

    for (const pattern of exaggerationPatterns) {
      if (pattern.test(content)) {
        violations.push(`誇大表現の可能性: "${content.match(pattern)?.[0]}" はより具体的な表現に変更を推奨`);
        riskLevel = Math.max(riskLevel, 2) as 1 | 2 | 3 | 4 | 5;
        checkStatus = checkStatus === 'passed' ? 'warning' : checkStatus;
      }
    }

    // 重大な違反パターン
    const severePatterns = [
      /[絶対に痩せる確実に儲かる]/gi,
      /[副作用なし100%安全]/gi
    ];

    for (const pattern of severePatterns) {
      if (pattern.test(content)) {
        violations.push(`重大な景表法違反の可能性: "${content.match(pattern)?.[0]}" は削除が必要です`);
        riskLevel = 5;
        checkStatus = 'violation';
      }
    }

    return {
      id: crypto.randomUUID(),
      content_generation_id: contentId,
      law_type: '景表法',
      check_status: checkStatus,
      risk_level: riskLevel,
      violation_details: {
        violations,
        total_issues: violations.length,
        recommendations: this.getKeikyohyoRecommendations(violations)
      },
      legal_references: {
        law_name: '不当景品類及び不当表示防止法',
        relevant_articles: ['第5条（優良誤認）', '第5条（有利誤認）'],
        reference_url: 'https://www.caa.go.jp/policies/policy/representation/'
      },
      created_at: new Date().toISOString()
    };
  }

  // 薬機法（医薬品、医療機器等の品質、有効性及び安全性の確保等に関する法律）チェック
  private async checkYakukiho(contentId: string, content: string): Promise<LegalCheckResult> {
    const violations: string[] = [];
    let riskLevel: 1 | 2 | 3 | 4 | 5 = 1;
    let checkStatus: 'passed' | 'warning' | 'violation' = 'passed';

    // 医療機器関連表現
    const medicalDevicePatterns = [
      /[治療治る病気が治る]/gi,
      /[診断診察検査結果]/gi,
      /[医療用医療機器医療器具]/gi
    ];

    for (const pattern of medicalDevicePatterns) {
      if (pattern.test(content)) {
        violations.push(`薬機法違反の可能性: "${content.match(pattern)?.[0]}" は医療機器としての承認が必要です`);
        riskLevel = Math.max(riskLevel, 4) as 1 | 2 | 3 | 4 | 5;
        checkStatus = 'violation';
      }
    }

    // 薬事効果標榜
    const pharmaceuticalPatterns = [
      /[効く効果がある薬用]/gi,
      /[予防防ぐ改善する]/gi,
      /[症状が.*する病状が]/gi
    ];

    for (const pattern of pharmaceuticalPatterns) {
      if (pattern.test(content)) {
        violations.push(`薬事効果標榜の可能性: "${content.match(pattern)?.[0]}" は医薬品以外では使用できません`);
        riskLevel = Math.max(riskLevel, 3) as 1 | 2 | 3 | 4 | 5;
        checkStatus = checkStatus === 'passed' ? 'warning' : checkStatus;
      }
    }

    // 身体部位への効果標榜
    const bodyPartPatterns = [
      /[肌が.*髪が.*歯が.*]/gi,
      /[血行血流血圧]/gi,
      /[筋肉関節骨]/gi
    ];

    for (const pattern of bodyPartPatterns) {
      if (pattern.test(content)) {
        violations.push(`身体への効果標榜: "${content.match(pattern)?.[0]}" は薬機法に抵触する可能性があります`);
        riskLevel = Math.max(riskLevel, 2) as 1 | 2 | 3 | 4 | 5;
        checkStatus = checkStatus === 'passed' ? 'warning' : checkStatus;
      }
    }

    return {
      id: crypto.randomUUID(),
      content_generation_id: contentId,
      law_type: '薬機法',
      check_status: checkStatus,
      risk_level: riskLevel,
      violation_details: {
        violations,
        total_issues: violations.length,
        recommendations: this.getYakukihoRecommendations(violations)
      },
      legal_references: {
        law_name: '医薬品、医療機器等の品質、有効性及び安全性の確保等に関する法律',
        relevant_articles: ['第66条（誇大広告の禁止）', '第68条（承認前の広告禁止）'],
        reference_url: 'https://www.pmda.go.jp/'
      },
      created_at: new Date().toISOString()
    };
  }

  // 金商法（金融商品取引法）チェック
  private async checkKinshoho(contentId: string, content: string): Promise<LegalCheckResult> {
    const violations: string[] = [];
    let riskLevel: 1 | 2 | 3 | 4 | 5 = 1;
    let checkStatus: 'passed' | 'warning' | 'violation' = 'passed';

    // 投資勧誘表現
    const investmentPatterns = [
      /[必ず儲かる確実に利益]/gi,
      /[元本保証リスクなし]/gi,
      /[高利回り高配当]/gi,
      /[投資.*勧誘]/gi
    ];

    for (const pattern of investmentPatterns) {
      if (pattern.test(content)) {
        violations.push(`金商法違反の可能性: "${content.match(pattern)?.[0]}" は投資勧誘規制に抵触します`);
        riskLevel = Math.max(riskLevel, 4) as 1 | 2 | 3 | 4 | 5;
        checkStatus = 'violation';
      }
    }

    // 金融商品関連表現
    const financialPatterns = [
      /[株式FX仮想通貨]/gi,
      /[投資信託債券]/gi,
      /[資産運用ファンド]/gi
    ];

    let hasFinancialTerms = false;
    for (const pattern of financialPatterns) {
      if (pattern.test(content)) {
        hasFinancialTerms = true;
        break;
      }
    }

    if (hasFinancialTerms) {
      if (!content.includes('リスク') && !content.includes('注意')) {
        violations.push('金融商品に関する表現では、リスクについての記載が必要です');
        riskLevel = Math.max(riskLevel, 2) as 1 | 2 | 3 | 4 | 5;
        checkStatus = checkStatus === 'passed' ? 'warning' : checkStatus;
      }
    }

    return {
      id: crypto.randomUUID(),
      content_generation_id: contentId,
      law_type: '金商法',
      check_status: checkStatus,
      risk_level: riskLevel,
      violation_details: {
        violations,
        total_issues: violations.length,
        recommendations: this.getKinshohoRecommendations(violations)
      },
      legal_references: {
        law_name: '金融商品取引法',
        relevant_articles: ['第37条（誇大広告の禁止）', '第38条（不適正な勧誘の禁止）'],
        reference_url: 'https://www.jsa.or.jp/'
      },
      created_at: new Date().toISOString()
    };
  }

  // 景表法の改善提案
  private getKeikyohyoRecommendations(violations: string[]): string[] {
    const recommendations: string[] = [];
    
    violations.forEach(violation => {
      if (violation.includes('優良誤認')) {
        recommendations.push('客観的な根拠やデータを併記してください');
        recommendations.push('「当社調べ」「○○調査機関による」等の出典を明記してください');
      }
      if (violation.includes('有利誤認')) {
        recommendations.push('価格比較の条件や期限を明確に記載してください');
        recommendations.push('「通常価格との比較」「期間限定」等の詳細を追加してください');
      }
      if (violation.includes('誇大表現')) {
        recommendations.push('より具体的で測定可能な表現に変更してください');
        recommendations.push('実績や事例を基にした表現を使用してください');
      }
    });

    if (recommendations.length === 0) {
      recommendations.push('表現に問題は見つかりませんでした');
    }

    return [...new Set(recommendations)];
  }

  // 薬機法の改善提案
  private getYakukihoRecommendations(violations: string[]): string[] {
    const recommendations: string[] = [];
    
    violations.forEach(violation => {
      if (violation.includes('医療機器')) {
        recommendations.push('医療機器として承認されていない製品では使用できません');
        recommendations.push('「健康維持」「快適な生活」等の表現に変更してください');
      }
      if (violation.includes('薬事効果')) {
        recommendations.push('医薬品以外では効果・効能の標榜はできません');
        recommendations.push('「サポート」「お手伝い」等の補助的表現に変更してください');
      }
      if (violation.includes('身体への効果')) {
        recommendations.push('身体部位への直接的な効果表現は避けてください');
        recommendations.push('「気分」「生活の質」等の表現を検討してください');
      }
    });

    if (recommendations.length === 0) {
      recommendations.push('薬機法上の問題は見つかりませんでした');
    }

    return [...new Set(recommendations)];
  }

  // 金商法の改善提案
  private getKinshohoRecommendations(violations: string[]): string[] {
    const recommendations: string[] = [];
    
    violations.forEach(violation => {
      if (violation.includes('投資勧誘')) {
        recommendations.push('「必ず」「確実に」等の断定表現は使用できません');
        recommendations.push('リスクについての記載を必ず含めてください');
      }
      if (violation.includes('リスク')) {
        recommendations.push('投資にはリスクが伴うことを明記してください');
        recommendations.push('過去の実績は将来を保証するものではない旨を記載してください');
      }
    });

    if (recommendations.length === 0) {
      recommendations.push('金商法上の問題は見つかりませんでした');
    }

    return [...new Set(recommendations)];
  }

  // 総合リスク評価
  async getOverallRisk(contentId: string): Promise<{
    overall_risk: 1 | 2 | 3 | 4 | 5;
    status: 'passed' | 'warning' | 'violation';
    summary: string;
  }> {
    const results = await this.db.getLegalCheckResults(contentId);
    
    if (results.length === 0) {
      return {
        overall_risk: 1,
        status: 'passed',
        summary: '法令チェックが実行されていません'
      };
    }

    const maxRisk = Math.max(...results.map(r => r.risk_level)) as 1 | 2 | 3 | 4 | 5;
    const hasViolation = results.some(r => r.check_status === 'violation');
    const hasWarning = results.some(r => r.check_status === 'warning');

    let status: 'passed' | 'warning' | 'violation' = 'passed';
    if (hasViolation) status = 'violation';
    else if (hasWarning) status = 'warning';

    const violationCount = results.filter(r => r.check_status === 'violation').length;
    const warningCount = results.filter(r => r.check_status === 'warning').length;

    let summary = '';
    if (violationCount > 0) {
      summary = `${violationCount}件の法令違反の可能性が検出されました。修正が必要です。`;
    } else if (warningCount > 0) {
      summary = `${warningCount}件の注意事項が検出されました。確認をお勧めします。`;
    } else {
      summary = '法令チェックを通過しました。';
    }

    return {
      overall_risk: maxRisk,
      status,
      summary
    };
  }
}