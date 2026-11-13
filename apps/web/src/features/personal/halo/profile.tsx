'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { api, authExpired, errorText, webCall } from '../api';
import { Mascot, type MascotState } from '../mascot';
import {
  applyMasterNotification,
  masterNotificationState,
  type NotificationFlags,
} from './catalog';
import { ListRow, Menu, RoundButton, Switch } from './primitives';

type Preferences = NotificationFlags & { version: number };

/**
 * Bot profile & settings. 资料库 → existing 记忆与上下文 panel; 通知 → the four existing
 * notification preferences as one master switch (expectedVersion, conflict re-read). 电脑,
 * 添加到 Slack and 定时任务 are labelled placeholders: none of them exists in ADR-017 scope.
 */
export function ProfileScreen({
  botName,
  active,
  mascotState,
  connectedCount,
  onBack,
  onLibrary,
  onConnections,
  onNotifications,
  onApps,
  onAccount,
  onNewChat,
  onPlaceholder,
  onExpired,
}: {
  botName: string;
  active: boolean;
  mascotState: MascotState;
  connectedCount: number;
  onBack: () => void;
  onLibrary: () => void;
  onConnections: () => void;
  onNotifications: () => void;
  onApps: () => void;
  onAccount: () => void;
  onNewChat: () => void;
  onPlaceholder: (title: string, body: string) => void;
  onExpired: () => void;
}) {
  const labelId = useId();
  const helpId = useId();
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    return api.notifications
      .getPreferences(webCall())
      .then((result) => setPreferences(result))
      .catch((cause) => {
        if (authExpired(cause)) onExpired();
        else setNotice(errorText(cause));
      });
  }, [onExpired]);

  const [requested, setRequested] = useState(false);
  if (active && !requested) setRequested(true);
  useEffect(() => {
    if (requested) void load();
  }, [requested, load]);

  async function toggle(next: boolean) {
    if (!preferences || saving) return;
    setSaving(true);
    setNotice('');
    const flags = applyMasterNotification(next);
    setPreferences({ ...preferences, ...flags });
    try {
      const result = await api.notifications.updatePreferences(
        { ...flags, expectedVersion: preferences.version },
        webCall(),
      );
      setPreferences(result);
      setNotice('通知偏好已保存。');
    } catch (cause) {
      if (authExpired(cause)) onExpired();
      else {
        setNotice(`${errorText(cause)} 已重新读取当前偏好。`);
        void load();
      }
    } finally {
      setSaving(false);
    }
  }

  const master = preferences ? masterNotificationState(preferences) : 'off';

  return (
    <section className="halo-profile" aria-label={`${botName} 资料`}>
      <header className="halo-topbar">
        <RoundButton icon="back" label="返回" onClick={onBack} />
        <div className="halo-topbar-end">
          <RoundButton
            icon="share"
            label="分享"
            onClick={() =>
              onPlaceholder(
                '分享 Bot',
                '分享 Bot 尚未开放。连接他人请使用「我的连接」中的连接码与共享预览。',
              )
            }
          />
          <Menu
            label="资料页更多"
            items={[
              { id: 'new', label: '新对话', icon: 'new-chat', onSelect: onNewChat },
              { id: 'account', label: '我的账号', icon: 'profile', onSelect: onAccount },
              { id: 'inbox', label: '通知中心', icon: 'inbox', onSelect: onNotifications },
            ]}
          />
        </div>
      </header>
      <div className="halo-profile-hero">
        <Mascot size={92} state={mascotState} badge />
        <h1 className="halo-profile-name">{botName}</h1>
        <button
          type="button"
          className="halo-pill halo-pill-neutral halo-press"
          onClick={() =>
            onPlaceholder('编辑 Bot', 'Bot 名称、头像与指令编辑尚未开放；当前角色与回复均为 Mock。')
          }
        >
          编辑
        </button>
      </div>
      <div className="halo-group">
        <ListRow icon="library" label="资料库" onClick={onLibrary} />
        <ListRow
          icon="computer"
          label="电脑"
          value="空闲"
          onClick={() =>
            onPlaceholder(
              '电脑',
              '电脑代理尚未开放：AVEN 当前不会在任何设备上执行操作。「空闲」只是占位状态。',
            )
          }
        />
      </div>
      <p className="halo-group-label">配置 Bot</p>
      <div className="halo-group">
        <ListRow
          icon="plug"
          label="连接应用"
          value={`已连接 ${connectedCount} 个`}
          onClick={onApps}
        />
        <ListRow icon="link" label="我的连接" onClick={onConnections} />
        <ListRow
          icon="slack"
          label="添加到 Slack"
          onClick={() =>
            onPlaceholder(
              '添加到 Slack',
              'Slack 集成尚未开放（不在当前个人 Web 范围内），不会请求任何 Slack 授权。',
            )
          }
        />
        <ListRow
          icon="clock"
          label="定时任务"
          value="0 已开启"
          onClick={() =>
            onPlaceholder('定时任务', '定时任务尚未开放；当前没有任何定时运行的 Bot 任务。')
          }
        />
      </div>
      <div className="halo-group halo-group-pad">
        <div className="halo-toggle-row">
          <span id={labelId}>通知</span>
          <Switch
            labelledBy={labelId}
            describedBy={helpId}
            checked={master === 'on'}
            mixed={master === 'mixed'}
            disabled={!preferences || saving}
            onChange={(next) => void toggle(next)}
          />
        </div>
      </div>
      <p id={helpId} className="halo-group-help">
        {master === 'mixed'
          ? '部分通知已关闭；打开后将开启全部站内通知。'
          : 'Bot 完成任务或等你处理时通知你'}
        <span className="halo-group-help-sub">站内通知，需手动刷新；没有移动推送。</span>
      </p>
      {notice && (
        <p className="halo-group-help" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
