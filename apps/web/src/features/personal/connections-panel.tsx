'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CreateConnectionPreviewRequestSchema,
  type ConnectionInvitation,
  type ConnectionWidget,
  type MemoryItem,
} from '@aven/contracts';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, authExpired, errorText, webCall, writeUncertain, type PrivateProps } from './api';
import { PeerChat } from './peer-chat';

type Connection = Awaited<ReturnType<typeof api.connections.listConnections>>['data'][number];
type Preview = Awaited<ReturnType<typeof api.connections.preview>>;

function date(value: string) {
  return new Date(value).toLocaleString('zh-CN');
}

const statuses = {
  pending: '等待回应',
  accepted: '已接受',
  declined: '未建立连接',
  withdrawn: '已撤回',
  expired: '已过期',
};

export function ConnectionsPanel({ userId, onExpired }: PrivateProps & { userId: string }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [invitations, setInvitations] = useState<ConnectionInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [peer, setPeer] = useState<string | null>(null);
  const [selected, setSelected] = useState<ConnectionInvitation | null>(null);
  const loader = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    loader.current?.abort();
    const controller = new AbortController();
    loader.current = controller;
    return Promise.all([
      api.connections.listConnections(webCall(controller.signal)),
      api.connections.listInvitations(webCall(controller.signal)),
    ])
      .then(([links, invites]) => {
        if (!controller.signal.aborted) {
          setConnections(links.data);
          setInvitations(invites.data);
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
  }, [onExpired]);

  function reload() {
    setLoading(true);
    setError('');
    setConnections([]);
    setInvitations([]);
    setSelected(null);
    void load();
  }

  useEffect(() => {
    void load();
    return () => loader.current?.abort();
  }, [load]);

  if (peer)
    return (
      <PeerChat
        key={peer}
        connectionId={peer}
        userId={userId}
        onExpired={onExpired}
        onBack={() => {
          setPeer(null);
          reload();
        }}
      />
    );
  if (creating)
    return (
      <NewInvitation
        onExpired={onExpired}
        onDone={() => {
          setCreating(false);
          reload();
        }}
      />
    );
  if (selected)
    return (
      <InvitationDetail
        key={selected.id}
        invitation={selected}
        onExpired={onExpired}
        onDone={reload}
      />
    );

  return (
    <div className="flex flex-col gap-3">
      <p className="muted m-0">通过对方主动分享的连接码发起邀请。只有双方同意，才会建立连接。</p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="my-connection-code">我的连接码</Label>
        <Input
          id="my-connection-code"
          readOnly
          value={`aven:${userId}`}
          onFocus={(event) => event.target.select()}
        />
      </div>
      <p className="small muted m-0">
        可以主动分享给想认识的人。连接码不授予读取资料或登录的权限。
      </p>
      <div className="section-heading">
        <Button onClick={() => setCreating(true)}>发起连接邀请</Button>
        <Button variant="ghost" onClick={reload} disabled={loading}>
          刷新连接
        </Button>
      </div>
      {error && <Alert variant="warning">{error}</Alert>}
      {loading && <p role="status">正在读取连接…</p>}
      <h3>我的连接</h3>
      {!loading && !connections.length && <p className="muted">还没有双方确认的连接。</p>}
      {connections.map((connection) => (
        <Button
          variant="secondary"
          className="list-row h-auto justify-between px-4 py-3 font-normal"
          key={connection.id}
          onClick={() => setPeer(connection.id)}
        >
          <span>
            已建立的连接<small>{date(connection.establishedAt)}</small>
          </span>
          <span>开始聊天 →</span>
        </Button>
      ))}
      <h3>邀请记录</h3>
      {!loading && !invitations.length && <p className="muted">暂时没有邀请。</p>}
      {invitations.map((invitation) => (
        <Button
          variant="secondary"
          className="list-row h-auto justify-between px-4 py-3 font-normal"
          key={invitation.id}
          onClick={() => setSelected(invitation)}
        >
          <span>
            {invitation.senderUserId === userId ? '我发出的邀请' : '收到一份连接邀请'}
            <small>{date(invitation.createdAt)}</small>
          </span>
          <Badge variant={invitation.status === 'accepted' ? 'success' : 'outline'}>
            {statuses[invitation.status]}
          </Badge>
        </Button>
      ))}
    </div>
  );
}

function NewInvitation({ onExpired, onDone }: PrivateProps & { onDone: () => void }) {
  const [recipient, setRecipient] = useState('');
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [days, setDays] = useState(3);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [unknown, setUnknown] = useState(false);
  const lock = useRef(false);
  const key = useRef(crypto.randomUUID());

  useEffect(() => {
    const controller = new AbortController();
    void api.memories
      .list(webCall(controller.signal), 'sharing')
      .then((result) => {
        if (!controller.signal.aborted) setItems(result.data);
      })
      .catch((cause) => {
        if (authExpired(cause)) onExpired();
        else if (!controller.signal.aborted) setError(errorText(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [onExpired]);

  async function prepare() {
    const input = {
      recipientUserId: recipient.trim().replace(/^aven:/i, ''),
      memoryItemIds: selected,
      expiresInDays: days,
    };
    if (!CreateConnectionPreviewRequestSchema.safeParse(input).success) {
      setError('请填写对方完整的连接码，并选择 1–10 条介绍。');
      return;
    }
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      setPreview(await api.connections.preview(input, webCall()));
      key.current = crypto.randomUUID();
    } catch (cause) {
      if (authExpired(cause)) onExpired();
      else setError(errorText(cause));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function send() {
    if (!preview || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await api.connections.send(preview.id, key.current, webCall());
      setUnknown(false);
      onDone();
    } catch (cause) {
      if (authExpired(cause)) onExpired();
      else {
        setUnknown(writeUncertain(cause));
        if (!writeUncertain(cause)) setPreview(null);
        setError(
          errorText(cause) + (writeUncertain(cause) ? ' 结果未确认时，请沿用本次预览核对。' : ''),
        );
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button variant="ghost" onClick={onDone} disabled={busy || unknown}>
          返回连接
        </Button>
      </div>
      {error && <Alert variant="warning">{error}</Alert>}
      {preview ? (
        <section className="flex flex-col gap-3" aria-label="连接共享预览">
          <h3>发送前，看看共享什么</h3>
          <p className="small m-0">接收方连接码</p>
          <code className="wrap">aven:{preview.recipientUserId}</code>
          <p className="m-0">用途：本次个人连接邀请</p>
          <p className="m-0">共享截止：{date(preview.grantExpiresAt)}</p>
          {preview.snapshot.map((item) => (
            <Card key={item.sourceId}>
              <CardContent className="p-4">
                <p className="m-0">{item.value}</p>
              </CardContent>
            </Card>
          ))}
          <p className="small muted m-0">
            只分享上面列出的实际内容，不包含未选信息、私人对话或日历。接受连接不会扩大用途。
          </p>
          <p className="small muted m-0">
            本预览有效至 {date(preview.expiresAt)}。来源改变后需要重新预览。
          </p>
          <div className="button-row">
            <Button disabled={busy} onClick={() => void send()}>
              {busy ? '正在核对…' : unknown ? '核对本次发送结果' : '确认并发送邀请'}
            </Button>
            <Button
              variant="secondary"
              disabled={busy || unknown}
              onClick={() => {
                setPreview(null);
                setError('');
              }}
            >
              重新选择
            </Button>
          </div>
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          <h3>向对方介绍你自己</h3>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="recipient-code">对方的连接码</Label>
            <Input
              id="recipient-code"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="请对方分享完整连接码"
              maxLength={50}
              disabled={busy}
            />
          </div>
          <label className="stack-label">
            本次共享期限
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} disabled={busy}>
              <option value={1}>1 天</option>
              <option value={3}>3 天</option>
              <option value={7}>7 天</option>
            </select>
          </label>
          <h3>选择本次介绍</h3>
          {loading && <p role="status">正在读取允许共享的信息…</p>}
          {!loading && !items.length && (
            <p className="muted">
              没有可用的介绍。请先到“记忆与上下文”手工确认信息，并明确允许进入共享预览。
            </p>
          )}
          {items.map((item) => (
            <label className="check-row memory-card" key={item.id}>
              <input
                type="checkbox"
                checked={selected.includes(item.id)}
                disabled={busy || (!selected.includes(item.id) && selected.length >= 10)}
                onChange={(e) =>
                  setSelected((current) =>
                    e.target.checked
                      ? [...current, item.id]
                      : current.filter((id) => id !== item.id),
                  )
                }
              />
              <span>
                <strong>{item.title}</strong>
                <small>{item.content}</small>
              </span>
            </label>
          ))}
          <Button
            onClick={() => void prepare()}
            disabled={busy || !selected.length || !recipient.trim()}
          >
            {busy ? '正在生成预览…' : '查看共享预览'}
          </Button>
        </section>
      )}
    </div>
  );
}

function InvitationDetail({
  invitation,
  onExpired,
  onDone,
}: PrivateProps & { invitation: ConnectionInvitation; onDone: () => void }) {
  const [widget, setWidget] = useState<ConnectionWidget | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    void api.connections
      .getWidget(invitation.id, webCall(controller.signal))
      .then((result) => {
        if (!controller.signal.aborted) setWidget(result);
      })
      .catch((cause) => {
        if (authExpired(cause)) onExpired();
        else if (!controller.signal.aborted) {
          setWidget(null);
          setError(errorText(cause));
        }
      });
    return () => controller.abort();
  }, [invitation.id, onExpired]);

  async function act(action: 'accepted' | 'declined' | 'withdraw' | 'revoke') {
    if (!widget || lock.current) return;
    if (
      (action === 'revoke' || action === 'withdraw') &&
      !window.confirm(
        `确认${action === 'revoke' ? '撤销共享' : '撤回邀请'}？\n接收方连接码：aven:${widget.invitation.recipientUserId}\n用途：本次连接邀请\n涉及 ${widget.snapshot.items.length} 条介绍。新的授权读取将被拒绝；已送达或系统外副本无法收回，其他独立授权不受影响。`,
      )
    )
      return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      if (action === 'withdraw')
        await api.connections.withdraw(invitation.id, widget.invitation.version, webCall());
      else if (action === 'revoke') await api.connections.revoke(invitation.id, webCall());
      else
        await api.connections.decide(
          invitation.id,
          { decision: action, expectedVersion: widget.invitation.version },
          webCall(),
        );
      setWidget(null);
      onDone();
    } catch (cause) {
      setWidget(null);
      if (authExpired(cause)) onExpired();
      else setError(errorText(cause));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3" aria-label="邀请详情">
      <div>
        <Button variant="ghost" onClick={onDone} disabled={busy}>
          返回连接
        </Button>
      </div>
      <h3>{statuses[widget?.invitation.status ?? invitation.status]}</h3>
      {error && <Alert variant="warning">{error}</Alert>}
      {widget ? (
        <>
          <p className="m-0">用途：本次连接邀请 · 截止 {date(widget.invitation.expiresAt)}</p>
          {widget.snapshot.items.map((item) => (
            <Card key={item.sourceId}>
              <CardContent className="p-4">
                <p className="m-0">{item.value}</p>
              </CardContent>
            </Card>
          ))}
          <p className="small muted m-0">只显示对方明确共享的内容。建立连接不自动获得其他资料。</p>
          <div className="button-row">
            {widget.role === 'recipient' &&
              widget.invitation.status === 'pending' &&
              widget.invitation.grantStatus === 'active' && (
                <>
                  <Button disabled={busy} onClick={() => void act('accepted')}>
                    接受连接
                  </Button>
                  <Button variant="secondary" disabled={busy} onClick={() => void act('declined')}>
                    暂时不连接
                  </Button>
                </>
              )}
            {widget.role === 'sender' && widget.invitation.status === 'pending' && (
              <Button variant="secondary" disabled={busy} onClick={() => void act('withdraw')}>
                撤回邀请
              </Button>
            )}
            {widget.role === 'sender' && widget.invitation.grantStatus === 'active' && (
              <Button variant="secondary" disabled={busy} onClick={() => void act('revoke')}>
                撤销共享
              </Button>
            )}
          </div>
        </>
      ) : (
        !error && <p role="status">正在重新验证共享资料…</p>
      )}
    </section>
  );
}
