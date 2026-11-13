'use client';

import { useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Chat } from '../chat';
import { useCatalog, useChat } from '../app-state';
import { connectorServiceFor, useConnectors } from '../connectors';
import { useToast } from '../halo/primitives';
import { templateFromConversation } from '../halo/text';

export function ChatPageClient() {
  const router = useRouter();
  const params = useSearchParams();
  const chat = useChat();
  const catalog = useCatalog();
  const connectors = useConnectors();
  const [toast, showToast] = useToast();
  const query = params.get('q') ?? '';

  const searchRequest = useMemo(() => (query ? { query, seq: 1 } : null), [query]);

  const connectorStatus = useCallback(
    (pluginId: string) => {
      const service = connectorServiceFor(pluginId);
      return service ? connectors.statusFor(service) : undefined;
    },
    [connectors],
  );

  const shareTemplate = useCallback(async () => {
    const text = templateFromConversation(
      'AVEN',
      chat.turns.map((turn) => turn.input),
    );
    try {
      await navigator.clipboard.writeText(text);
      showToast('已复制对话模板（仅你的提问，未公开分享）。');
    } catch {
      showToast('无法访问剪贴板，请手动选择文本。');
    }
  }, [chat.turns, showToast]);

  return (
    <div className="page-app">
      <Chat
        chat={{ ...chat, send: (text?: string) => chat.sendMessage(text ?? chat.draft) }}
        suspended={false}
        active
        botName="AVEN"
        extras={chat.extras}
        plugins={catalog.plugins}
        connectorStatus={connectorStatus}
        celebrate={chat.celebrate}
        searchRequest={searchRequest}
        onBack={() => router.push('/')}
        onOpenProfile={() => router.push('/profile')}
        onOpenApps={() => {
          if (!catalog.loaded) void catalog.load();
          router.push('/apps');
        }}
        onOpenConnector={() => router.push('/connectors')}
        onNewChat={() => chat.newChat()}
        onShareTemplate={() => void shareTemplate()}
        onRunAction={(plugin, actionName) =>
          router.push(
            `/apps/${encodeURIComponent(plugin.id)}?action=${encodeURIComponent(actionName)}`,
          )
        }
        onUnavailable={showToast}
      />
      {toast}
    </div>
  );
}
