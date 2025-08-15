// PM2 設定ファイル - BGA Marketing AI

module.exports = {
  apps: [
    {
      name: 'bga-marketing-ai',
      script: 'npx',
      args: 'wrangler pages dev dist --d1=webapp-production --local --ip 0.0.0.0 --port 3000',
      cwd: '/home/user/webapp',
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
        // 開発環境用の環境変数
        JWT_SECRET: 'dev-jwt-secret-key-change-in-production',
        OPENAI_API_KEY: '', // 必要に応じて設定
      },
      // プロセス管理設定
      instances: 1, // 開発環境では1インスタンス
      exec_mode: 'fork',
      watch: false, // PM2のファイル監視は無効（wranglerが監視）
      
      // ログ設定
      log_file: 'logs/app.log',
      out_file: 'logs/out.log',
      error_file: 'logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // 自動再起動設定
      max_restarts: 10,
      min_uptime: '10s',
      
      // メモリ・CPU制限
      max_memory_restart: '1G',
      
      // 環境固有設定
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
        JWT_SECRET: process.env.JWT_SECRET || 'change-me-in-production',
        OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
      }
    }
  ],
  
  // デプロイ設定（将来的な本番環境用）
  deploy: {
    production: {
      user: 'deploy',
      host: 'your-server.com',
      ref: 'origin/main',
      repo: 'git@github.com:your-org/bga-marketing-ai.git',
      path: '/var/www/bga-marketing-ai',
      'pre-deploy-local': '',
      'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.cjs --env production',
      'pre-setup': ''
    }
  }
};