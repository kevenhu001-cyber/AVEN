import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { colors } from '@aven/design-tokens';
import './globals.css';

export const metadata: Metadata = {
  title: 'AVEN · 对话与连接',
  description: 'AVEN：对话、记忆与经授权的智能协作平台。',
  icons: { icon: '/mascot/aven-static.svg' },
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: colors.light.background },
    { media: '(prefers-color-scheme: dark)', color: colors.dark.background },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  // The in-app mock layer (apps/web/src/mocks) is dev-only; label every page so the
  // simulated data can never be mistaken for the real product.
  const webMock = process.env.AVEN_WEB_MOCK === '1';
  return (
    <html lang="zh-CN">
      <body>
        {children}
        {webMock && (
          <p
            className="mock-banner"
            role="status"
            aria-label="当前页面使用本地模拟数据，不连接真实服务"
          >
            模拟数据 · 非真实服务
          </p>
        )}
      </body>
    </html>
  );
}
