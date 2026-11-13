import type { Viewport } from 'next';
import { PersonalApp } from '../features/personal/personal-app';
export const viewport: Viewport = { themeColor: '#ffffff', colorScheme: 'light dark' };
export const dynamic = 'force-dynamic';
export default function PersonalPage() {
  return <PersonalApp />;
}
