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
  interactiveWidget: 'resizes-content',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: colors.light.background },
    { media: '(prefers-color-scheme: dark)', color: colors.dark.background },
  ],
};

// Applies the stored/system theme before first paint to avoid a flash of the wrong palette.
const themeBootstrap = `(function(){try{var s=localStorage.getItem('aven-theme');var t=(s==='light'||s==='dark')?s:(window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');var e=document.documentElement;e.dataset.avenTheme=t;e.style.colorScheme=t;}catch(_){}})();`;

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
