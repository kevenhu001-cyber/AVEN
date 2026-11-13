import type { Viewport } from 'next';
import { PersonalApp } from '../features/personal/personal-app';
export const viewport: Viewport = { themeColor: '#080808', colorScheme: 'dark' };
export const dynamic = 'force-dynamic';
export default function PersonalPage() {
  return <PersonalApp />;
}
