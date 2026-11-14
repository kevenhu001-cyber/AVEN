'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useChat } from '../app-state';
import { useConnectors } from '../connectors';
import { Mascot } from '../mascot';
import { Icon } from '../icon';

type ProfileTab = 'activity' | 'library';

/** Non-modal desktop Bot panel that keeps the current conversation visible. */
export function BotInfoDrawer({
  open,
  onOpenChange,
  onOpenApps,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenApps: () => void;
}) {
  const router = useRouter();
  const chat = useChat();
  const connectors = useConnectors();
  const [tab, setTab] = useState<ProfileTab>('activity');
  const [suggestionsVisible, setSuggestionsVisible] = useState(true);
  const connectedCount = connectors.rows.filter((row) => row.status === 'connected').length;

  const close = () => onOpenChange(false);
  const startNewChat = () => {
    chat.newChat();
    close();
    router.replace('/chat');
  };
  const showApps = () => {
    close();
    onOpenApps();
  };

  return (
    <DialogPrimitive.Root open={open} modal={false} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          className="personal-app aven-theme-halo halo-bot-drawer"
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="sr-only">AVEN 资料</DialogPrimitive.Title>
          <header className="halo-bot-drawer-head">
            <DialogPrimitive.Close className="halo-round halo-round-dark halo-press" aria-label="关闭资料面板">
              <Icon name="x" size={22} />
            </DialogPrimitive.Close>
          </header>
          <div className="halo-bot-drawer-scroll">
            <div className="halo-bot-drawer-hero">
              <Mascot size={92} state={chat.busy ? 'thinking' : 'idle'} />
              <h1>AVEN</h1>
            </div>
            <div className="halo-bot-tabs" role="tablist" aria-label="AVEN 资料分类">
              <button
                id="bot-tab-activity"
                type="button"
                role="tab"
                aria-selected={tab === 'activity'}
                aria-controls="bot-panel-activity"
                onClick={() => setTab('activity')}
              >
                动态
              </button>
              <button
                id="bot-tab-library"
                type="button"
                role="tab"
                aria-selected={tab === 'library'}
                aria-controls="bot-panel-library"
                onClick={() => setTab('library')}
              >
                资料库
              </button>
            </div>
            {tab === 'activity' ? (
              <div
                id="bot-panel-activity"
                role="tabpanel"
                aria-labelledby="bot-tab-activity"
                className="halo-bot-panel"
              >
                {suggestionsVisible && (
                  <section className="halo-bot-section">
                    <div className="halo-bot-section-head">
                      <h2>建议</h2>
                      <button type="button" onClick={() => setSuggestionsVisible(false)}>
                        隐藏
                      </button>
                    </div>
                    <div className="halo-bot-suggestions">
                      <button type="button" onClick={startNewChat}>
                        <Icon name="new-chat" size={21} />
                        <span>开启新对话</span>
                        <Icon name="chevron" size={20} />
                      </button>
                      <button type="button" onClick={showApps}>
                        <Icon name="apps" size={21} />
                        <span>浏览连接应用</span>
                        <Icon name="chevron" size={20} />
                      </button>
                    </div>
                  </section>
                )}
                <section className="halo-bot-section">
                  <h2>电脑</h2>
                  <div className="halo-bot-status-card">
                    <span>
                      <strong>受控电脑</strong>
                      <small>电脑接入尚未开放</small>
                    </span>
                    <Icon name="computer" size={28} />
                  </div>
                </section>
                <section className="halo-bot-section">
                  <h2>语音聊天</h2>
                  <div className="halo-bot-status-card halo-bot-status-voice">
                    <span>
                      <strong>语音模式</strong>
                      <small>尚未开放 · 麦克风听写按浏览器支持情况提供</small>
                    </span>
                    <Icon name="wave" size={24} />
                  </div>
                </section>
                <section className="halo-bot-section">
                  <h2>连接应用</h2>
                  <button type="button" className="halo-bot-link-card" onClick={showApps}>
                    <span>管理已连接应用</span>
                    <span className="halo-bot-count">已连接 {connectedCount} 个</span>
                    <Icon name="chevron" size={20} />
                  </button>
                </section>
              </div>
            ) : (
              <div
                id="bot-panel-library"
                role="tabpanel"
                aria-labelledby="bot-tab-library"
                className="halo-bot-panel"
              >
                <section className="halo-bot-section">
                  <h2>个人资料库</h2>
                  <p className="halo-bot-description">
                    已确认信息和候选记忆都由你管理；不同用途的读取与共享授权彼此独立。
                  </p>
                  <Link className="halo-bot-link-card" href="/memory" onClick={close}>
                    <span>打开记忆与上下文</span>
                    <span className="halo-bot-count">已确认信息 · 候选复核</span>
                    <Icon name="chevron" size={20} />
                  </Link>
                </section>
                <section className="halo-bot-section">
                  <h2>连接应用</h2>
                  <button type="button" className="halo-bot-link-card" onClick={showApps}>
                    <span>查看已连接与可用应用</span>
                    <span className="halo-bot-count">已连接 {connectedCount} 个</span>
                    <Icon name="chevron" size={20} />
                  </button>
                </section>
              </div>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
