'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Notification, NotificationCursor } from '@aven/contracts';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { api, authExpired, errorText, webCall, type PrivateProps } from './api';

const labels = {
  sent: '收到连接邀请',
  accepted: '连接邀请已接受',
  declined: '连接邀请未被接受',
  withdrawn: '邀请已撤回',
  revoked: '共享授权已撤销',
  proposed: '收到活动提案',
  confirmed: '活动已确认',
  cancelled: '活动已取消',
};

export function NotificationsPanel({
  onExpired,
  onConnections,
}: PrivateProps & { onConnections: () => void }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [cursor, setCursor] = useState<NotificationCursor | null>(null);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [preferences, setPreferences] = useState<{
    connectionInvitations: boolean;
    connectionUpdates: boolean;
    eventInvitations: boolean;
    eventUpdates: boolean;
    version: number;
  } | null>(null);
  const [preferenceNotice, setPreferenceNotice] = useState('');
  const [savingPreferences, setSavingPreferences] = useState(false);
  const loader = useRef<AbortController | null>(null);
  const lock = useRef(false);

  const load = useCallback(
    (older?: NotificationCursor) => {
      loader.current?.abort();
      const controller = new AbortController();
      loader.current = controller;
      return api.notifications
        .list(
          older ? { cursorCreatedAt: older.createdAt, cursorId: older.id } : {},
          webCall(controller.signal),
        )
        .then((result) => {
          if (!controller.signal.aborted) {
            setItems((current) =>
              [...(older ? current : []), ...result.data].filter(
                (item, index, array) => array.findIndex((other) => other.id === item.id) === index,
              ),
            );
            setCursor(result.nextCursor);
            setUnread(result.unreadCount);
          }
        })
        .catch((cause) => {
          if (controller.signal.aborted) return;
          if (authExpired(cause)) onExpired();
          else setError(errorText(cause));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    },
    [onExpired],
  );

  useEffect(() => {
    void load();
    return () => loader.current?.abort();
  }, [load]);

  const loadPreferences = useCallback(() => {
    return api.notifications
      .getPreferences(webCall())
      .then((result) => {
        setPreferences(result);
        return result;
      })
      .catch((cause) => {
        if (authExpired(cause)) onExpired();
        else setError(errorText(cause));
        return null;
      });
  }, [onExpired]);

  useEffect(() => {
    void loadPreferences();
  }, [loadPreferences]);

  async function savePreferences(next: {
    connectionInvitations: boolean;
    connectionUpdates: boolean;
    eventInvitations: boolean;
    eventUpdates: boolean;
  }) {
    if (!preferences || savingPreferences) return;
    setSavingPreferences(true);
    setPreferenceNotice('');
    setError('');
    setPreferences({ ...preferences, ...next });
    try {
      const result = await api.notifications.updatePreferences(
        {
          connectionInvitations: next.connectionInvitations,
          connectionUpdates: next.connectionUpdates,
          eventInvitations: next.eventInvitations,
          eventUpdates: next.eventUpdates,
          expectedVersion: preferences.version,
        },
        webCall(),
      );
      setPreferences(result);
      setPreferenceNotice('通知偏好已保存。');
    } catch (cause) {
      if (authExpired(cause)) onExpired();
      else {
        setError(errorText(cause));
        setPreferenceNotice('保存未完成，请重新读取偏好后再试。');
        void loadPreferences();
      }
    } finally {
      setSavingPreferences(false);
    }
  }

  async function read(id: string) {
    if (lock.current) return;
    lock.current = true;
    try {
      await api.notifications.read(id, webCall());
      await load();
    } catch (cause) {
      if (authExpired(cause)) onExpired();
      else setError(errorText(cause));
    } finally {
      lock.current = false;
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="section-heading">
        <p className="m-0">未读 {unread} 条</p>
        <Button
          variant="ghost"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            setItems([]);
            setError('');
            void load();
          }}
        >
          刷新通知
        </Button>
      </div>
      <p className="small muted m-0">站内通知通过队列投递，当前需要手动刷新。</p>
      {error && <Alert variant="warning">{error}</Alert>}
      {!loading && !items.length && <p className="muted">暂时没有通知。</p>}
      <div className="flex flex-col gap-3">
        {items.map((item) => (
          <Card key={item.id}>
            <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle>{labels[item.kind]}</CardTitle>
              <Badge variant={item.readAt ? 'outline' : 'accent'}>
                {item.readAt ? '已读' : '未读'}
              </Badge>
            </CardHeader>
            <CardContent>
              <p className="small muted m-0">{new Date(item.createdAt).toLocaleString('zh-CN')}</p>
            </CardContent>
            {(!item.readAt || item.target.type === 'connection_invitation') && (
              <CardFooter>
                {!item.readAt && (
                  <Button variant="secondary" onClick={() => void read(item.id)}>
                    标为已读
                  </Button>
                )}
                {item.target.type === 'connection_invitation' && (
                  <Button variant="ghost" onClick={onConnections}>
                    查看连接邀请
                  </Button>
                )}
              </CardFooter>
            )}
          </Card>
        ))}
      </div>
      {loading && <p role="status">正在读取通知…</p>}
      {cursor && (
        <Button variant="secondary" onClick={() => void load(cursor)} disabled={loading}>
          更早通知
        </Button>
      )}
      <Separator />
      <Card>
        <CardHeader>
          <CardTitle>通知偏好</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {!preferences ? (
            <p role="status">正在读取通知偏好…</p>
          ) : (
            <>
              {(
                [
                  ['connectionInvitations', '收到连接邀请时通知我'],
                  ['connectionUpdates', '连接状态变化时通知我'],
                  ['eventInvitations', '收到活动提案时通知我'],
                  ['eventUpdates', '活动确认或取消时通知我'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="check-row">
                  <input
                    type="checkbox"
                    checked={preferences[key]}
                    disabled={savingPreferences}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      const next = {
                        connectionInvitations:
                          key === 'connectionInvitations'
                            ? checked
                            : preferences.connectionInvitations,
                        connectionUpdates:
                          key === 'connectionUpdates' ? checked : preferences.connectionUpdates,
                        eventInvitations:
                          key === 'eventInvitations' ? checked : preferences.eventInvitations,
                        eventUpdates: key === 'eventUpdates' ? checked : preferences.eventUpdates,
                      };
                      setPreferences({ ...preferences, ...next });
                      void savePreferences(next);
                    }}
                  />
                  {label}
                </label>
              ))}
              <p className="small muted m-0">
                关闭后不再产生新的站内通知；已经送达的通知仍会保留在收件箱。
              </p>
            </>
          )}
        </CardContent>
        {preferenceNotice && (
          <CardFooter>
            <p className="small muted m-0" role="status">
              {preferenceNotice}
            </p>
          </CardFooter>
        )}
      </Card>
    </section>
  );
}
