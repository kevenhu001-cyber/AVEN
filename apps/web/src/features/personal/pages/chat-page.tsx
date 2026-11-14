'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useShellApps, useShellProfile } from '@/components/shell/navigation-context';
import { Chat } from '../chat';
import { useCatalog, useChat } from '../app-state';
import { errorText } from '../api';
import { connectorServiceFor, useConnectors } from '../connectors';
import { useToast } from '../halo/primitives';
import { templateFromConversation } from '../halo/text';

export function ChatPageClient() {
  const router = useRouter();
  const openApps = useShellApps();
  const openProfile = useShellProfile();
  const params = useSearchParams();
  const chat = useChat();
  const catalog = useCatalog();
  const connectors = useConnectors();
  const [toast, showToast] = useToast();
  const query = params.get('q') ?? '';
  const conversationParam = params.get('c');
  const { activeConversationId, busy, restoreConversation, clearExtras } = chat;

  const searchRequest = useMemo(() => (query ? { query, seq: 1 } : null), [query]);

  const connectorStatus = useCallback(
    (pluginId: string) => {
      const service = connectorServiceFor(pluginId);
      return service ? connectors.statusFor(service) : undefined;
    },
    [connectors],
  );

  // `?c=` restores a stored conversation from the durable messages feed. The restore
  // is owned by the chat hook; the URL parameter, the active conversation and the busy
  // flag decide when it runs, and a failed restore retries on the next dependency change.
  useEffect(() => {
    if (!conversationParam) return;
    if (conversationParam === activeConversationId) return;
    if (busy) return;
    const controller = new AbortController();
    void (async () => {
      try {
        await restoreConversation(conversationParam, controller.signal);
        clearExtras();
      } catch (cause) {
        if (!controller.signal.aborted) showToast(errorText(cause));
      }
    })();
    return () => controller.abort();
  }, [conversationParam, activeConversationId, busy, restoreConversation, clearExtras, showToast]);

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
        onOpenProfile={openProfile ?? (() => router.push('/profile'))}
        onOpenApps={openApps ?? (() => router.push('/apps'))}
        onOpenConnector={() => router.push('/connectors')}
        onNewChat={() => {
          chat.newChat();
          // Drop a stale ?c= so leaving and re-selecting the same conversation works.
          router.replace('/chat');
        }}
        onShareTemplate={() => void shareTemplate()}
        onRunAction={(plugin, actionName) =>
          router.push(
            `/apps/${encodeURIComponent(plugin.id)}?action=${encodeURIComponent(actionName)}`,
          )
        }
        onVoicePlaceholder={() => showToast('语音输入与语音模式尚未开放。')}
        onVoiceError={(message) => showToast(message)}
        onUnavailable={showToast}
      />
      {toast}
    </div>
  );
}
