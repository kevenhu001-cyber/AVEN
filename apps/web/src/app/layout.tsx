import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { colors } from '@aven/design-tokens';
import './globals.css';

export const metadata: Metadata = {
  title: 'AVEN · 工程基础',
  description: 'AVEN M0 工程诊断，不是已完成产品。',
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
