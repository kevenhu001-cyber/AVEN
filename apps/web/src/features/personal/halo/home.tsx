'use client';

import { useState } from 'react';
import { Icon } from '../icon';
import { Mascot, type MascotState } from '../mascot';
import { RoundButton } from './primitives';

/** Halo home: avatar + new chat on top, the round mascot centred, apps + search at the bottom. */
export function HomeScreen({
  displayName,
  botName,
  mascotState,
  busy,
  onAccount: _onAccount,
  onNewChat,
  onOpenChat,
  onOpenProfile,
  onOpenApps,
  onSearch,
  providerLabel,
}: {
  displayName: string;
  botName: string;
  mascotState: MascotState;
  busy: boolean;
  onAccount: () => void;
  onNewChat: () => void;
  onOpenChat: () => void;
  onOpenProfile: () => void;
  onOpenApps: () => void;
  onSearch: (query: string) => void;
  providerLabel: string;
}) {
  const [query, setQuery] = useState('');
  return (
    <section className="halo-home" aria-label="AVEN 首页">
      <div className="halo-home-hero">
        <p className="halo-home-greeting">你好，{displayName}</p>
        <button
          type="button"
          className="halo-home-bot halo-press-soft"
          aria-label={`与 ${botName} 对话`}
          onClick={onOpenChat}
        >
          <Mascot size={92} state={mascotState} />
          <span className="halo-home-name">{botName}</span>
        </button>
        <button type="button" className="halo-home-mode" onClick={onOpenProfile}>
          {providerLabel}
        </button>
        <button
          type="button"
          className="halo-pill halo-pill-light halo-press halo-home-new"
          onClick={onNewChat}
          disabled={busy}
        >
          <Icon name="plus" size={18} />
          新对话
        </button>
      </div>
      <form
        className="halo-home-bottom"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch(query.trim());
          setQuery('');
        }}
      >
        <RoundButton icon="apps" label="连接应用" onClick={onOpenApps} />
        <label className="halo-search">
          <Icon name="search" size={22} />
          <span className="sr-only">在当前对话中搜索</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索"
            enterKeyHint="search"
          />
        </label>
      </form>
    </section>
  );
}
