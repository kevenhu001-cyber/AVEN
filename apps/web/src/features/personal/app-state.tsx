'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ConversationSummary, PluginManifest } from '@aven/contracts';
import { api, authExpired, errorText, webCall } from './api';
import { detectConnectorIntent } from './halo/catalog';
import type { CatalogState, ChatExtra, ConnectorResult } from './halo/types';
import { useAgentChat } from './use-agent-chat';
import { useSession } from './session';

const INTENT_HINT = /(连接|连上|接入|授权|绑定|添加|connect|authorize)/i;

type ConversationsStatus = 'idle' | 'loading' | 'ready' | 'error';

type ChatState = ReturnType<typeof useAgentChat> & {
  extras: ChatExtra[];
  celebrate: boolean;
  sendMessage: (text: string) => void;
  addAuthCard: (plugin: PluginManifest, source: 'sheet' | 'intent') => void;
  addResult: (result: ConnectorResult) => void;
  clearExtras: () => void;
  newChat: () => void;
  conversations: ConversationSummary[];
  conversationsStatus: ConversationsStatus;
  reloadConversations: () => void;
};

const ChatContext = createContext<ChatState | null>(null);
const CatalogContext = createContext<CatalogState | null>(null);

function useCatalogState(onExpired: () => void): CatalogState {
  const [plugins, setPlugins] = useState<PluginManifest[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<Promise<PluginManifest[]> | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const load = useCallback(() => {
    if (pending.current) return pending.current;
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    setError('');
    const request = api.plugins
      .listCatalog(webCall(abort.signal))
      .then((result) => {
        setPlugins(result.plugins);
        setLoaded(true);
        return result.plugins;
      })
      .catch((cause) => {
        if (abort.signal.aborted) return [];
        if (authExpired(cause)) onExpired();
        else setError(errorText(cause));
        return [];
      })
      .finally(() => {
        pending.current = null;
        if (!abort.signal.aborted) setLoading(false);
      });
    pending.current = request;
    return request;
  }, [onExpired]);
  return { plugins, loading, loaded, error, load };
}

/** Sidebar recent-conversation feed; the first load is visible, later refreshes are silent. */
function useConversationsState(onExpired: () => void) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [status, setStatus] = useState<ConversationsStatus>('loading');
  const generation = useRef(0);
  const reload = useCallback(() => {
    const seq = ++generation.current;
    api.agent
      .listConversations({ limit: 20 }, webCall())
      .then((result) => {
        if (seq !== generation.current) return;
        setConversations(result.data);
        setStatus('ready');
      })
      .catch((cause) => {
        if (seq !== generation.current) return;
        if (authExpired(cause)) {
          onExpired();
          return;
        }
        setStatus('error');
      });
  }, [onExpired]);
  useEffect(() => {
    reload();
    return () => {
      generation.current += 1;
    };
  }, [reload]);
  return { conversations, status, reload };
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const { suspended, invalidate } = useSession();
  const chat = useAgentChat(suspended, invalidate);
  const catalog = useCatalogState(invalidate);
  const conversations = useConversationsState(invalidate);
  const [extras, setExtras] = useState<ChatExtra[]>([]);
  const celebrate = false;
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);

  const addAuthCard = useCallback((plugin: PluginManifest, source: 'sheet' | 'intent') => {
    setExtras((items) =>
      items.some((item) => item.kind === 'auth' && item.pluginId === plugin.id)
        ? items
        : [
            ...items,
            {
              kind: 'auth',
              key: `auth-${plugin.id}-${Date.now()}`,
              pluginId: plugin.id,
              createdAt: Date.now(),
              source,
            },
          ],
    );
  }, []);

  const addResult = useCallback((result: ConnectorResult) => {
    setExtras((items) => [...items, { kind: 'result', createdAt: Date.now(), ...result }]);
  }, []);

  const clearExtras = useCallback(() => setExtras([]), []);

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      chat.send(trimmed);
      if (!INTENT_HINT.test(trimmed)) return;
      void (catalog.loaded ? Promise.resolve(catalog.plugins) : catalog.load()).then((plugins) => {
        const plugin = detectConnectorIntent(trimmed, plugins);
        if (plugin) addAuthCard(plugin, 'intent');
      });
    },
    [addAuthCard, catalog, chat],
  );

  const newChat = useCallback(() => {
    if (chat.busy) return;
    chat.reset();
    setExtras([]);
  }, [chat]);

  // A finished turn is durable on the server; refresh the sidebar feed silently so the
  // conversation shows up (or its title updates) without a manual reload.
  const terminalKeys = chat.turns
    .filter((turn) => ['completed', 'failed', 'cancelled'].includes(turn.status))
    .map((turn) => turn.key)
    .join('|');
  const seenTerminal = useRef('');
  useEffect(() => {
    const previous = seenTerminal.current;
    seenTerminal.current = terminalKeys;
    if (previous && terminalKeys.length > previous.length) conversations.reload();
  }, [terminalKeys, conversations]);

  return (
    <CatalogContext.Provider value={catalog}>
      <ChatContext.Provider
        value={{
          ...chat,
          extras,
          celebrate,
          sendMessage,
          addAuthCard,
          addResult,
          clearExtras,
          newChat,
          conversations: conversations.conversations,
          conversationsStatus: conversations.status,
          reloadConversations: conversations.reload,
        }}
      >
        {children}
      </ChatContext.Provider>
    </CatalogContext.Provider>
  );
}

export function useChat(): ChatState {
  const value = useContext(ChatContext);
  if (!value) throw new Error('useChat must be used inside AppStateProvider');
  return value;
}

export function useCatalog(): CatalogState {
  const value = useContext(CatalogContext);
  if (!value) throw new Error('useCatalog must be used inside AppStateProvider');
  return value;
}
