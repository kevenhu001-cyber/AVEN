'use client';

import type { PluginManifest } from '@aven/contracts';
import { Icon } from '../icon';
import { authStatusText, credentialLabel, type AuthState } from './catalog';
import { PluginLogo } from './plugin-logo';

/**
 * Inline connector authorization card (Halo style). Authorization is Mock only: 授权 opens
 * an inline scope confirmation; confirming flips a page-session flag after a short simulated
 * wait. No OAuth redirect, token or external request happens (ADR-017/018).
 */
export function ConnectorAuthCard({
  plugin,
  state,
  botName,
  onRequest,
  onCancel,
  onConfirm,
  onDisconnect,
  onRunAction,
}: {
  plugin: PluginManifest;
  state: AuthState;
  botName: string;
  onRequest: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  onDisconnect: () => void;
  onRunAction: (actionName: string) => void;
}) {
  return (
    <div className="halo-auth" data-state={state} data-plugin={plugin.id}>
      <div className="halo-auth-card">
        <div className="halo-auth-head">
          <PluginLogo id={plugin.id} category={plugin.category} size="lg" />
          <div className="halo-auth-text">
            <p className="halo-auth-name">
              {plugin.name}
              <span className="halo-auth-verified" title="AVEN 服务端内置目录中的连接器">
                <Icon name="verified" size={18} />
                <span className="sr-only">内置目录</span>
              </span>
            </p>
            <p className="halo-auth-desc">{plugin.description}</p>
          </div>
        </div>
        {state === 'confirming' && (
          <div className="halo-auth-scope" role="group" aria-label={`${plugin.name} 授权范围`}>
            <p className="halo-auth-scope-title">确认授权范围（Mock）</p>
            <ul>
              {plugin.actions.map((action) => (
                <li key={action.name}>{action.title}</li>
              ))}
            </ul>
            <p className="halo-auth-scope-note">
              {plugin.readOnly ? '只读' : '可写入，写入前仍需逐次确认'} · 凭据：
              {credentialLabel(plugin.credentialStatus)} ·
              只在本页模拟连接状态，不会跳转第三方或读取真实账号。
            </p>
            <div className="halo-auth-scope-actions">
              <button
                type="button"
                className="halo-pill halo-pill-neutral halo-press"
                onClick={onCancel}
              >
                取消
              </button>
              <button
                type="button"
                className="halo-pill halo-pill-light halo-press"
                onClick={onConfirm}
              >
                确认授权（Mock）
              </button>
            </div>
          </div>
        )}
        <div className="halo-auth-foot">
          <span className="halo-auth-status" role="status">
            {state === 'connected' && <Icon name="check" size={16} className="halo-auth-check" />}
            {authStatusText(state)}
          </span>
          {state === 'idle' && (
            <button
              type="button"
              className="halo-pill halo-pill-light halo-press"
              onClick={onRequest}
            >
              授权
            </button>
          )}
          {state === 'confirming' && (
            <button type="button" className="halo-pill halo-pill-light halo-press" disabled>
              授权
            </button>
          )}
          {state === 'authorizing' && (
            <button type="button" className="halo-pill halo-pill-light" disabled aria-busy="true">
              <Icon name="spinner" size={16} className="halo-spin" />
              授权中
            </button>
          )}
          {state === 'connected' && (
            <button
              type="button"
              className="halo-pill halo-pill-done halo-pill-pop"
              onClick={onDisconnect}
            >
              <Icon name="check" size={16} />
              已连接
              <span className="sr-only">，点击断开（Mock）</span>
            </button>
          )}
        </div>
        {state === 'connected' && (
          <div className="halo-auth-actions">
            {plugin.actions.map((action) => (
              <button
                key={action.name}
                type="button"
                className="halo-chip halo-press"
                onClick={() => onRunAction(action.name)}
              >
                {action.title}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="halo-auth-disclaimer">
        {botName} 在做出更改前总会先征求你的同意。你可以随时断开连接。当前为 Mock
        授权，不会访问真实账号。
      </p>
    </div>
  );
}
