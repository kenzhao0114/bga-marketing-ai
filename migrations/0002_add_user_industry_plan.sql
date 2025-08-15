-- Add industry and plan fields to users table
-- 0002_add_user_industry_plan.sql

-- Add industry field to users table
ALTER TABLE users ADD COLUMN industry TEXT DEFAULT 'technology';

-- Add plan field to users table (basic, professional, enterprise)
ALTER TABLE users ADD COLUMN plan TEXT DEFAULT 'basic';

-- Create content_automation_schedules table for automated content generation
CREATE TABLE IF NOT EXISTS content_automation_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  tenant_id INTEGER NOT NULL,
  content_type TEXT NOT NULL, -- 'seo_article', 'press_release', 'recruitment', 'sns'
  frequency TEXT NOT NULL, -- 'daily', 'weekly', 'monthly'
  frequency_count INTEGER NOT NULL DEFAULT 1, -- How many per frequency period
  schedule_time TEXT NOT NULL DEFAULT '02:00', -- When to run the generation (24h format)
  is_active BOOLEAN DEFAULT true,
  last_generated_at DATETIME,
  next_generation_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Create content_delivery_schedules table for content delivery/notification
CREATE TABLE IF NOT EXISTS content_delivery_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  tenant_id INTEGER NOT NULL,
  delivery_type TEXT NOT NULL, -- 'email', 'dashboard', 'api_webhook'
  delivery_time TEXT NOT NULL DEFAULT '07:30', -- When to deliver (24h format)
  is_active BOOLEAN DEFAULT true,
  delivery_channels TEXT, -- JSON array of channels/topics
  last_delivered_at DATETIME,
  next_delivery_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Create automated_content_queue table for queuing generated content
CREATE TABLE IF NOT EXISTS automated_content_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  tenant_id INTEGER NOT NULL,
  schedule_id INTEGER NOT NULL, -- References content_automation_schedules
  content_type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT, -- JSON with additional content metadata
  status TEXT DEFAULT 'pending', -- 'pending', 'delivered', 'failed'
  quality_score REAL,
  generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  delivered_at DATETIME,
  delivery_method TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (schedule_id) REFERENCES content_automation_schedules(id)
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_content_automation_schedules_user_tenant ON content_automation_schedules(user_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_content_automation_schedules_next_generation ON content_automation_schedules(next_generation_at, is_active);
CREATE INDEX IF NOT EXISTS idx_content_delivery_schedules_user_tenant ON content_delivery_schedules(user_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_content_delivery_schedules_next_delivery ON content_delivery_schedules(next_delivery_at, is_active);
CREATE INDEX IF NOT EXISTS idx_automated_content_queue_user_tenant ON automated_content_queue(user_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_automated_content_queue_status ON automated_content_queue(status, generated_at);

-- Insert default automation schedules for existing users
INSERT INTO content_automation_schedules (user_id, tenant_id, content_type, frequency, frequency_count, schedule_time)
SELECT 
  u.id,
  u.tenant_id,
  'seo_article',
  'monthly',
  10,
  '02:00'
FROM users u;

INSERT INTO content_automation_schedules (user_id, tenant_id, content_type, frequency, frequency_count, schedule_time)
SELECT 
  u.id,
  u.tenant_id,
  'press_release',
  'monthly',
  1,
  '02:15'
FROM users u;

INSERT INTO content_automation_schedules (user_id, tenant_id, content_type, frequency, frequency_count, schedule_time)
SELECT 
  u.id,
  u.tenant_id,
  'recruitment',
  'weekly',
  1,
  '02:30'
FROM users u;

INSERT INTO content_automation_schedules (user_id, tenant_id, content_type, frequency, frequency_count, schedule_time)
SELECT 
  u.id,
  u.tenant_id,
  'sns',
  'daily',
  2,
  '02:45'
FROM users u;

-- Insert default delivery schedules for existing users
INSERT INTO content_delivery_schedules (user_id, tenant_id, delivery_type, delivery_time)
SELECT 
  u.id,
  u.tenant_id,
  'dashboard',
  '07:30'
FROM users u;

-- Update users with default industry based on company name or set to technology
UPDATE users SET industry = 
  CASE 
    WHEN LOWER(name) LIKE '%tech%' OR LOWER(name) LIKE '%it%' OR LOWER(name) LIKE '%software%' THEN 'technology'
    WHEN LOWER(name) LIKE '%health%' OR LOWER(name) LIKE '%medical%' OR LOWER(name) LIKE '%pharma%' THEN 'healthcare'
    WHEN LOWER(name) LIKE '%finance%' OR LOWER(name) LIKE '%bank%' OR LOWER(name) LIKE '%invest%' THEN 'finance'
    WHEN LOWER(name) LIKE '%edu%' OR LOWER(name) LIKE '%school%' OR LOWER(name) LIKE '%univ%' THEN 'education'
    WHEN LOWER(name) LIKE '%retail%' OR LOWER(name) LIKE '%shop%' OR LOWER(name) LIKE '%store%' THEN 'retail'
    ELSE 'technology'
  END;

-- Update users with default plan (basic for now, can be upgraded)
UPDATE users SET plan = 'basic';