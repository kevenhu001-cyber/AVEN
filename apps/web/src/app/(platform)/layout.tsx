import type { ReactNode } from 'react';
import type { Viewport } from 'next';
import { colors } from '@aven/design-tokens';
import { PlatformShell } from '@/features/personal/platform-shell';

export const dynamic = 'force-dynamic';
export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: colors.halo.background,
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function PlatformLayout({ children }: { children: ReactNode }) {
  return <PlatformShell>{children}</PlatformShell>;
}
