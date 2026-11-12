import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { colors } from '@aven/design-tokens';
import './globals.css';

export const metadata: Metadata = {
  title: 'AVEN · 对话与连接',
  description: 'AVEN 个人 Web 开发验证版：对话、记忆与经授权的连接。',
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: colors.light.background },
    { media: '(prefers-color-scheme: dark)', color: colors.dark.background },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
