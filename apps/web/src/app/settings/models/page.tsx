import type { Metadata, Viewport } from 'next';
import { PersonalApp } from '../../../features/personal/personal-app';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '模型与渠道 · AVEN' };
export const viewport: Viewport = { themeColor: '#ffffff', colorScheme: 'light dark' };
export default function ModelSettingsPage() {
  return <PersonalApp initialPage="provider" />;
}
