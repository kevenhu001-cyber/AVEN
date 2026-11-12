'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { NotificationCursor, Notification } from '@aven/contracts';
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
    <section>
      <div className="section-heading">
        <p>未读 {unread} 条</p>
        <button
          className="text-button"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            setItems([]);
            setError('');
            void load();
          }}
        >
          刷新通知
        </button>
      </div>
      <p className="small muted">站内通知通过队列投递，当前需要手动刷新。</p>
      {error && (
        <p className="notice" role="status">
          {error}
        </p>
      )}
      {!loading && !items.length && <p className="muted">暂时没有通知。</p>}
      {items.map((item) => (
        <article className="notification-row" key={item.id}>
          <h3>{labels[item.kind]}</h3>
          <p className="small muted">
            {new Date(item.createdAt).toLocaleString('zh-CN')} · {item.readAt ? '已读' : '未读'}
          </p>
          <div className="button-row">
            {!item.readAt && (
              <button className="secondary" onClick={() => void read(item.id)}>
                标为已读
              </button>
            )}
            {item.target.type === 'connection_invitation' && (
              <button className="text-button" onClick={onConnections}>
                查看连接邀请
              </button>
            )}
          </div>
        </article>
      ))}
      {loading && <p role="status">正在读取通知…</p>}
      {cursor && (
        <button className="secondary" onClick={() => void load(cursor)} disabled={loading}>
          更早通知
        </button>
      )}
    </section>
  );
}
