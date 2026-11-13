'use client';

import type { PluginManifest } from '@aven/contracts';
import { Icon } from '../icon';
import { connectorServiceFor, connectorStatusLabel } from '../connectors';
import { credentialLabel } from './catalog';
import { PluginLogo } from './plugin-logo';

/**
 * Inline connector card. It reflects the real Open Connector gateway state; a service
 * without a gateway mapping is shown as not yet integrated instead of a simulated
 * authorization.
 */
export function ConnectorAuthCard({
  plugin,
  status,
  botName,
  onAuthorize,
  onRunAction,
}: {
  plugin: PluginManifest;
  status: string | undefined;
  botName: string;
  onAuthorize: () => void;
  onRunAction: (actionName: string) => void;
}) {
  const service = connectorServiceFor(plugin.id);
  const connected = status === 'connected';
  const pending = status === 'pending';
  const live = plugin.credentialStatus === 'configured';
  return (
    <div
      className="halo-auth"
      data-state={connected ? 'connected' : 'idle'}
      data-plugin={plugin.id}
    >
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
        <div className="halo-auth-foot">
          <span className="halo-auth-status" role="status">
            {connected && <Icon name="check" size={16} className="halo-auth-check" />}
            {service ? connectorStatusLabel(status) : '尚未接入真实账号'}
          </span>
          {service ? (
            <button
              type="button"
              className="halo-pill halo-pill-light halo-press"
              onClick={onAuthorize}
            >
              {connected ? '管理授权' : pending ? '继续授权' : '前往授权'}
            </button>
          ) : (
            <button type="button" className="halo-pill halo-pill-neutral" disabled>
              尚未开放
            </button>
          )}
        </div>
        {connected && live && (
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
        {botName} 在做出更改前总会先征求你的同意。授权由 Open Connector 网关完成，AVEN
        不保存第三方账号密码。凭据状态：{credentialLabel(plugin.credentialStatus)}。
      </p>
    </div>
  );
}
