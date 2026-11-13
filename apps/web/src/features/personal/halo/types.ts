import type { ConversationWidget, PluginManifest } from '@aven/contracts';

export type ConnectorResult = {
  key: string;
  pluginId: string;
  pluginName: string;
  actionTitle: string;
  summary: string;
  providerMode: string;
  widgets: ConversationWidget[];
};

/** Items the page adds to the chat stream next to agent turns (all page-local, never persisted). */
export type ChatExtra =
  | ({ kind: 'result'; createdAt: number } & ConnectorResult)
  | { kind: 'auth'; key: string; pluginId: string; createdAt: number; source: 'sheet' | 'intent' };

export type CatalogState = {
  plugins: PluginManifest[];
  loading: boolean;
  loaded: boolean;
  error: string;
  load: () => Promise<PluginManifest[]>;
};
