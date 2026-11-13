'use client';

import { useRouter } from 'next/navigation';
import { useCatalog, useChat } from '@/features/personal/app-state';
import { ProfileScreen } from '@/features/personal/halo/profile';
import { useToast } from '@/features/personal/halo/primitives';
import { useConnectors } from '@/features/personal/connectors';
import { useSession } from '@/features/personal/session';

export default function ProfilePage() {
  const router = useRouter();
  const { invalidate } = useSession();
  const chat = useChat();
  const catalog = useCatalog();
  const connectors = useConnectors();
  const [toast, showToast] = useToast();
  const connectedCount = connectors.rows.filter((row) => row.status === 'connected').length;

  return (
    <div className="page">
      <ProfileScreen
        botName="AVEN"
        active
        mascotState={chat.busy ? 'thinking' : 'idle'}
        connectedCount={connectedCount}
        onBack={() => router.push('/')}
        onLibrary={() => router.push('/memory')}
        onConnections={() => router.push('/connections')}
        onNotifications={() => router.push('/notifications')}
        onApps={() => {
          if (!catalog.loaded) void catalog.load();
          router.push('/apps');
        }}
        onAccount={() => router.push('/account')}
        onNewChat={() => {
          chat.newChat();
          router.push('/chat');
        }}
        onPlaceholder={(title) => showToast(`${title}尚未开放。`)}
        onExpired={invalidate}
      />
      {toast}
    </div>
  );
}
