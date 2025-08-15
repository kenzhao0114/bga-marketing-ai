import { jsxRenderer } from 'hono/jsx-renderer'

export const renderer = jsxRenderer(({ children }) => {
  return (
    <html lang="ja">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>BGA Marketing AI - B2Bデジタルマーケティング自動化SaaS</title>
        <meta name="description" content="生成AI活用のB2Bデジタルマーケティング自動化SaaS。誰でも90秒で効果把握、3クリックで実施。景表法・薬機法の法令チェック機能付き。" />
        
        {/* Tailwind CSS */}
        <script src="https://cdn.tailwindcss.com"></script>
        
        {/* Font Awesome */}
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
        
        {/* カスタムCSS */}
        <link href="/static/styles.css" rel="stylesheet" />
      </head>
      <body className="antialiased" style="background: var(--bg-primary); color: var(--text-primary);">
        {children}
        
        {/* JavaScript ライブラリ */}
        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        
        {/* アプリケーションJS */}
        <script src="/static/app.js"></script>
      </body>
    </html>
  )
})
