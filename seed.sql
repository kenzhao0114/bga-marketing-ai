-- シードデータ: Phase 0 社内MVP用初期データ

-- 社内テナント作成
INSERT OR IGNORE INTO tenants (id, name, domain, security_level, data_isolation, compliance_level, subscription_plan) VALUES 
  ('bga-internal', 'BGA株式会社', 'bga.co.jp', 'internal', 'complete', 'SOC2', 'internal');

-- 業界テンプレート定義（5業界×3成長ステージ×4チャネル）
-- 業界定義
INSERT OR IGNORE INTO industry_templates (id, name, category, locale_pack) VALUES 
  ('industry-it', 'IT・テクノロジー', 'industry', '{"formal_level": "semi_formal", "key_terms": ["デジタル変革", "イノベーション", "テクノロジー活用"], "seasonal_context": {"spring": "新年度システム導入", "summer": "業績向上施策", "fall": "年末予算獲得", "winter": "次年度企画"}}'),
  ('industry-consulting', 'コンサルティング', 'industry', '{"formal_level": "formal", "key_terms": ["経営課題解決", "戦略立案", "業務効率化"], "seasonal_context": {"spring": "新体制支援", "summer": "中間業績改善", "fall": "来期戦略", "winter": "年度総括"}}'),
  ('industry-manufacturing', '製造業', 'industry', '{"formal_level": "formal", "key_terms": ["品質向上", "生産性改善", "安全性確保"], "seasonal_context": {"spring": "新製品開発", "summer": "夏季需要対応", "fall": "効率化推進", "winter": "設備投資計画"}}'),
  ('industry-finance', '金融・保険', 'industry', '{"formal_level": "very_formal", "key_terms": ["リスク管理", "コンプライアンス", "顧客満足"], "seasonal_context": {"spring": "新規開拓", "summer": "中間決算", "fall": "決算対策", "winter": "来期計画"}}'),
  ('industry-healthcare', 'ヘルスケア・医療', 'industry', '{"formal_level": "very_formal", "key_terms": ["患者安全", "医療品質", "効率的運営"], "seasonal_context": {"spring": "新体制移行", "summer": "診療体制強化", "fall": "インフル対策", "winter": "年度予算"}}');

-- 成長ステージ定義
INSERT OR IGNORE INTO industry_templates (id, name, category, locale_pack) VALUES 
  ('stage-seed', 'シード・アーリー', 'growth_stage', '{"tone": "挑戦的", "focus": ["革新性", "成長性", "将来性"], "budget_context": "限定的予算での最大効果"}'),
  ('stage-series-a', 'シリーズA・B', 'growth_stage', '{"tone": "成長重視", "focus": ["拡張性", "実績構築", "市場シェア"], "budget_context": "成長投資での効率化"}'),
  ('stage-established', '上場企業・大手', 'growth_stage', '{"tone": "安定・信頼", "focus": ["安定性", "信頼性", "継続性"], "budget_context": "投資対効果での意思決定"}');

-- チャネル定義
INSERT OR IGNORE INTO industry_templates (id, name, category, locale_pack) VALUES 
  ('channel-pr', 'PR・プレスリリース', 'channel', '{"format": "press_release", "tone": "公式", "structure": ["見出し", "リード文", "本文", "企業情報"], "media_focus": "信頼性重視"}'),
  ('channel-sns', 'SNS・ソーシャル', 'channel', '{"format": "social_post", "tone": "親しみやすい", "structure": ["フック", "価値提案", "行動喚起"], "engagement_focus": "エンゲージメント重視"}'),
  ('channel-ad', '広告・LP', 'channel', '{"format": "advertisement", "tone": "説得力", "structure": ["キャッチコピー", "ベネフィット", "CTA"], "conversion_focus": "コンバージョン重視"}'),
  ('channel-email', 'メール・DM', 'channel', '{"format": "email", "tone": "パーソナル", "structure": ["件名", "挨拶", "本文", "署名"], "relationship_focus": "関係構築重視"}');

-- 社内ユーザー作成
INSERT OR IGNORE INTO users (id, tenant_id, email, name, role_internal) VALUES 
  ('user-admin', 'bga-internal', 'admin@bga.co.jp', '管理者', 'admin'),
  ('user-director', 'bga-internal', 'director@bga.co.jp', 'ディレクター', 'director'),
  ('user-producer', 'bga-internal', 'producer@bga.co.jp', 'プロデューサー', 'producer'),
  ('user-member', 'bga-internal', 'member@bga.co.jp', 'メンバー', 'member');

-- サンプルコンテンツ生成履歴
INSERT OR IGNORE INTO content_generations (
  id, tenant_id, user_id, industry_id, growth_stage_id, channel_id,
  input_prompt, generated_content, quality_score, legal_check_status, approval_status
) VALUES 
  ('content-sample-1', 'bga-internal', 'user-director', 'industry-it', 'stage-series-a', 'channel-pr',
   'AI活用マーケティング自動化サービスのプレスリリース作成',
   '【プレスリリース】AI活用で企業のマーケティング業務を最大70%効率化する新サービス「BGA Marketing AI」を正式リリース

   BGA株式会社（本社：東京都、代表取締役：趙 権益）は本日、生成AI技術を活用したB2Bデジタルマーケティング自動化SaaS「BGA Marketing AI」の正式提供を開始したことを発表いたします。

   ■サービス概要
   「BGA Marketing AI」は、企業のマーケティング担当者が「誰でも90秒で効果把握」「3クリックで実施」を実現できる革新的なマーケティング自動化プラットフォームです。景表法・薬機法等の法令チェック機能を内蔵し、コンプライアンスリスクを大幅に軽減します。

   ■主な特徴
   1. 生産性向上：マーケティング業務工数を最大70%削減
   2. リスク軽減：景表法・薬機法等の法令違反を自動検知
   3. ROI向上：データ駆動によるマーケティング効果最大化

   本サービスにより、新規事業立ち上げ企業や中小企業における圧倒的な生産性改善とリスク低減を実現します。',
   8.5, 'passed', 'approved');

-- サンプル法令チェック結果  
INSERT OR IGNORE INTO legal_check_results (
  id, content_generation_id, law_type, check_status, risk_level, violation_details
) VALUES 
  ('legal-check-1', 'content-sample-1', '景表法', 'passed', 1, '{"result": "適合", "details": "誇大表現なし、客観的数値根拠あり"}'),
  ('legal-check-2', 'content-sample-1', '薬機法', 'passed', 1, '{"result": "適合", "details": "医療機器・医薬品に関する表現なし"}');