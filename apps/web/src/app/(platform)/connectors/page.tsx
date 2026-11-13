'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { PageHead, Panel } from '@/components/shell/page';
import {
  connectorServices,
  connectorStatusLabel,
  useConnectors,
} from '@/features/personal/connectors';
import { PluginLogo } from '@/features/personal/halo/plugin-logo';

export default function ConnectorsPage() {
  const connectors = useConnectors();
  const [authorizationUrl, setAuthorizationUrl] = useState('');

  async function connect(service: string) {
    setAuthorizationUrl('');
    const url = await connectors.connect(service);
    if (url) setAuthorizationUrl(url);
  }

  return (
    <div className="page">
      <PageHead
        title="第三方账号授权"
        description="管理 Gmail、Drive、GitHub、Calendar 与 Outlook 的真实账号授权。"
        actions={
          <button
            type="button"
            className="shell-link-button"
            onClick={() => void connectors.load()}
            disabled={connectors.busy}
          >
            刷新列表
          </button>
        }
      />
      <p role="status" className="muted">
        {connectors.message || '正在读取连接状态…'}
      </p>
      {authorizationUrl && (
        <Alert variant="warning">
          即将离开 AVEN。请在第三方授权页检查权限范围后决定是否授权，返回后点击“核对授权结果”。
          <span className="connector-url-actions">
            <a
              className="shell-link-button"
              data-tone="primary"
              href={authorizationUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              确认前往授权页面
            </a>
            <button
              type="button"
              className="shell-link-button"
              onClick={() => setAuthorizationUrl('')}
            >
              暂不前往
            </button>
          </span>
        </Alert>
      )}
      <div className="connector-grid">
        {Object.entries(connectorServices).map(([service, name]) => {
          const status = connectors.statusFor(service);
          const connected = status === 'connected';
          return (
            <Panel key={service}>
              <div className="connector-head">
                <PluginLogo id={service} category="productivity" />
                <div>
                  <h2>{name}</h2>
                  <Badge variant={connected ? 'success' : status ? 'warning' : 'outline'}>
                    {connectorStatusLabel(status)}
                  </Badge>
                </div>
              </div>
              <div className="connector-actions">
                <button
                  type="button"
                  className="shell-link-button"
                  data-tone={connected ? undefined : 'primary'}
                  disabled={connectors.busy}
                  onClick={() => void connect(service)}
                >
                  {connected ? '重新授权' : '发起授权'}
                </button>
                <button
                  type="button"
                  className="shell-link-button"
                  disabled={connectors.busy || !status}
                  onClick={() => void connectors.refresh(service)}
                >
                  核对授权结果
                </button>
                <button
                  type="button"
                  className="shell-link-button"
                  disabled={connectors.busy || !status}
                  onClick={() => {
                    if (
                      window.confirm(
                        '仅移除 AVEN 的本地关联，第三方平台授权仍需到提供方撤销。是否继续？',
                      )
                    )
                      void connectors.disconnect(service);
                  }}
                >
                  移除本地关联
                </button>
              </div>
            </Panel>
          );
        })}
      </div>
      <p className="small muted">
        网关未配置或授权服务不可用时，页面会显示不可用状态，不会回退为模拟授权。
      </p>
    </div>
  );
}
