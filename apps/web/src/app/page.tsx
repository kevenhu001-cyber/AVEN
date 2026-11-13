import type { Viewport } from 'next';
import { colors } from '@aven/design-tokens';
import { PersonalApp } from '../features/personal/personal-app';
export const dynamic = 'force-dynamic';
// The personal app always renders the Halo near-black theme (ADR-018).
export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: colors.halo.background,
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};
export default function PersonalPage() {
  return <PersonalApp />;
}
