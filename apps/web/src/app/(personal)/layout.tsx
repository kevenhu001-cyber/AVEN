import type { ReactNode } from 'react';
import type { Viewport } from 'next';
import { colors } from '@aven/design-tokens';
import { PersonalShell } from '@/features/personal/personal-shell';

export const dynamic = 'force-dynamic';
export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: colors.halo.background,
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function PersonalLayout({ children }: { children: ReactNode }) {
  return <PersonalShell>{children}</PersonalShell>;
}
