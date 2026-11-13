'use client';

import { useRouter } from 'next/navigation';
import { HomeScreen } from '@/features/personal/halo/home';
import { useCatalog, useChat } from '@/features/personal/app-state';
import { useProviderStatus } from '@/features/personal/use-provider-status';
import { useSession } from '@/features/personal/session';

export default function HomePage() {
  const router = useRouter();
  const { me } = useSession();
  const chat = useChat();
  const catalog = useCatalog();
  const provider = useProviderStatus();
  const providerLabel = provider.status
    ? provider.status.configured
      ? provider.status.model
      : '未配置真实模型'
    : '正在读取模型状态';

  if (!me) return null;

  return (
    <div className="page-app">
      <HomeScreen
        displayName={me.user.displayName}
        botName="AVEN"
        mascotState={chat.busy ? 'thinking' : 'idle'}
        busy={chat.busy}
        providerLabel={providerLabel}
        onAccount={() => router.push('/account')}
        onNewChat={() => {
          chat.newChat();
          router.push('/chat');
        }}
        onOpenChat={() => router.push('/chat')}
        onOpenProfile={() => router.push('/profile')}
        onOpenApps={() => {
          if (!catalog.loaded) void catalog.load();
          router.push('/apps');
        }}
        onSearch={(query) => {
          router.push(query ? `/chat?q=${encodeURIComponent(query)}` : '/chat');
        }}
      />
    </div>
  );
}
