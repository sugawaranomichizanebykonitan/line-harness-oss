import type { Metadata } from 'next'
import './globals.css'
import AppShell from '@/components/app-shell'

export const metadata: Metadata = {
  title: '公式LINE 統合管理',
  description: '複数の公式LINEアカウントをまとめて管理する画面',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja">
      <body className="bg-gray-50 text-gray-900 antialiased" style={{ fontFamily: "'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic', system-ui, sans-serif" }}>
        <AppShell>
          {children}
        </AppShell>
      </body>
    </html>
  )
}
