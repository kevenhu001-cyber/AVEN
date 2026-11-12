import { useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import type { ConnectionInvitation } from '@aven/contracts';
import { useSession } from './session';
import { useOperation, useRemote } from './remote';
import { Action, Card, Copy, Field, Loading, Page, Problem, Toggle, confirm } from './ui';
import { uncertain } from './api';
import { PeerChatScreen } from './peer-chat-screen';

const labels = {
  pending: '等待回应',
  accepted: '已接受',
  declined: '未接受',
  withdrawn: '已撤回',
  expired: '已过期',
};
export function ConnectionsScreen() {
  const { api, call, me } = useSession();
  const remote = useRemote((signal) =>
    Promise.all([
      api.connections.listConnections(call(signal)),
      api.connections.listInvitations(call(signal)),
    ]),
  );
  const [creating, setCreating] = useState(false);
  const [invitation, setInvitation] = useState<ConnectionInvitation | null>(null);
  const [peer, setPeer] = useState<string | null>(null);
  const back = () => {
    setCreating(false);
    setInvitation(null);
    setPeer(null);
    void remote.reload();
  };
  if (peer) return <PeerChatScreen key={peer} connectionId={peer} onBack={back} />;
  if (creating) return <NewInvitation onBack={back} />;
  if (invitation)
    return <InvitationDetail key={invitation.id} invitation={invitation} onBack={back} />;
  return (
    <Page>
      <Copy title>我的连接</Copy>
      <Copy muted>请对方主动分享连接码。双方确认后才建立连接，连接不扩大资料用途。</Copy>
      <Card>
        <Copy>我的连接码</Copy>
        <Copy>aven:{me.user.id}</Copy>
        <Copy muted>长按复制并主动分享；连接码不授予登录或读取私人资料的权限。</Copy>
      </Card>
      <Action onPress={() => setCreating(true)}>发起连接邀请</Action>
      <Action secondary disabled={remote.busy} onPress={() => void remote.reload()}>
        刷新连接
      </Action>
      <Problem message={remote.problem} />
      {remote.busy && <Loading />}
      <Copy title>已建立的连接</Copy>
      {remote.data?.[0].data.length === 0 && <Copy muted>尚未建立连接。</Copy>}
      {remote.data?.[0].data.map((item) => (
        <Card key={item.id}>
          <Copy>{item.userLow === me.user.id ? item.userHigh : item.userLow}</Copy>
          <Copy muted>{new Date(item.establishedAt).toLocaleString('zh-CN')}</Copy>
          <Action secondary onPress={() => setPeer(item.id)}>
            开始聊天
          </Action>
        </Card>
      ))}
      <Copy title>邀请记录</Copy>
      {remote.data?.[1].data.length === 0 && <Copy muted>暂时没有邀请。</Copy>}
      {remote.data?.[1].data.map((item) => (
        <Card key={item.id}>
          <Copy>
            {item.senderUserId === me.user.id ? '我发出的邀请' : '收到的邀请'} ·{' '}
            {labels[item.status]}
          </Copy>
          <Action secondary onPress={() => setInvitation(item)}>
            读取邀请详情
          </Action>
        </Card>
      ))}
    </Page>
  );
}
function NewInvitation({ onBack }: { onBack: () => void }) {
  const { api, call } = useSession();
  const remote = useRemote((signal) => api.memories.list(call(signal), 'sharing'));
  const op = useOperation();
  const [recipient, setRecipient] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [days, setDays] = useState('3');
  const [preview, setPreview] = useState<Awaited<
    ReturnType<typeof api.connections.preview>
  > | null>(null);
  const [unknown, setUnknown] = useState(false);
  const key = useRef(Crypto.randomUUID());
  return (
    <Page>
      <Action secondary onPress={onBack} disabled={op.busy || unknown}>
        返回连接
      </Action>
      <Copy title>向对方介绍你自己</Copy>
      <Problem message={op.problem || remote.problem} />
      {preview ? (
        <>
          <Copy>接收方：aven:{preview.recipientUserId}</Copy>
          <Copy>用途：本次个人连接邀请</Copy>
          <Copy>共享截止：{new Date(preview.grantExpiresAt).toLocaleString('zh-CN')}</Copy>
          {preview.snapshot.map((item) => (
            <Card key={item.sourceId}>
              <Copy>{item.value}</Copy>
            </Card>
          ))}
          <Copy muted>
            只共享以上实际内容，不包含私人对话、未选信息或日历。预览有效至{' '}
            {new Date(preview.expiresAt).toLocaleString('zh-CN')}。
          </Copy>
          <Action
            disabled={op.busy}
            onPress={() =>
              void op.run(async (signal) => {
                try {
                  await api.connections.send(preview.id, key.current, call(signal));
                  setUnknown(false);
                  onBack();
                } catch (error) {
                  setUnknown(uncertain(error));
                  if (!uncertain(error)) setPreview(null);
                  throw error;
                }
              })
            }
          >
            {unknown ? '沿用本次预览核对发送结果' : '确认并发送邀请'}
          </Action>
          <Action secondary disabled={op.busy || unknown} onPress={() => setPreview(null)}>
            重新选择
          </Action>
        </>
      ) : (
        <>
          <Field
            label="对方完整连接码"
            value={recipient}
            onChangeText={setRecipient}
            maxLength={50}
            editable={!op.busy}
          />
          <Field
            label="共享期限（1–30 天）"
            value={days}
            onChangeText={setDays}
            keyboardType="number-pad"
            maxLength={2}
            editable={!op.busy}
          />
          <Copy>选择 1–10 条允许共享的信息</Copy>
          {remote.busy && <Loading />}
          {remote.data?.data.length === 0 && (
            <Copy muted>没有可用的信息，请先在记忆中明确允许进入共享预览。</Copy>
          )}
          {remote.data?.data.map((item) => (
            <Card key={item.id}>
              <Toggle
                label={item.title}
                value={selected.includes(item.id)}
                disabled={op.busy || (!selected.includes(item.id) && selected.length >= 10)}
                onChange={(value) =>
                  setSelected((old) =>
                    value ? [...old, item.id] : old.filter((id) => id !== item.id),
                  )
                }
              />
              <Copy>{item.content}</Copy>
            </Card>
          ))}
          <Action
            disabled={op.busy || !selected.length || !recipient.trim()}
            onPress={() =>
              void op.run(async (signal) => {
                const result = await api.connections.preview(
                  {
                    recipientUserId: recipient.trim().replace(/^aven:/i, ''),
                    memoryItemIds: selected,
                    expiresInDays: Number(days),
                  },
                  call(signal),
                );
                setPreview(result);
                key.current = Crypto.randomUUID();
              })
            }
          >
            查看共享预览
          </Action>
        </>
      )}
    </Page>
  );
}
function InvitationDetail({
  invitation,
  onBack,
}: {
  invitation: ConnectionInvitation;
  onBack: () => void;
}) {
  const { api, call } = useSession();
  const remote = useRemote((signal) => api.connections.getWidget(invitation.id, call(signal)));
  const op = useOperation();
  const widget = remote.data;
  function act(action: 'accepted' | 'declined' | 'withdraw' | 'revoke') {
    if (!widget) return;
    void op.run(async (signal) => {
      try {
        if (action === 'withdraw')
          await api.connections.withdraw(invitation.id, widget!.invitation.version, call(signal));
        else if (action === 'revoke') await api.connections.revoke(invitation.id, call(signal));
        else
          await api.connections.decide(
            invitation.id,
            { decision: action, expectedVersion: widget!.invitation.version },
            call(signal),
          );
        onBack();
      } catch (error) {
        remote.setData(null);
        throw error;
      }
    });
  }
  return (
    <Page>
      <Action secondary onPress={onBack} disabled={op.busy}>
        返回连接
      </Action>
      <Copy title>邀请详情</Copy>
      <Problem message={remote.problem || op.problem} />
      {remote.busy && <Loading />}
      <Action secondary disabled={remote.busy || op.busy} onPress={() => void remote.reload()}>
        重新验证并读取
      </Action>
      {widget && (
        <>
          <Copy>
            {labels[widget.invitation.status]} · {widget.invitation.grantStatus}
          </Copy>
          <Copy muted>
            本次连接邀请用途，截止 {new Date(widget.invitation.expiresAt).toLocaleString('zh-CN')}
          </Copy>
          {widget.snapshot.items.map((item) => (
            <Card key={item.sourceId}>
              <Copy>{item.value}</Copy>
            </Card>
          ))}
          {widget.role === 'recipient' &&
            widget.invitation.status === 'pending' &&
            widget.invitation.grantStatus === 'active' && (
              <>
                <Action disabled={op.busy} onPress={() => act('accepted')}>
                  接受连接
                </Action>
                <Action secondary disabled={op.busy} onPress={() => act('declined')}>
                  暂时不连接
                </Action>
              </>
            )}
          {widget.role === 'sender' && widget.invitation.status === 'pending' && (
            <Action
              secondary
              disabled={op.busy}
              onPress={() =>
                confirm('撤回邀请？', '对方将不能再接受本次邀请。', () => act('withdraw'))
              }
            >
              撤回邀请
            </Action>
          )}
          {widget.role === 'sender' && widget.invitation.grantStatus === 'active' && (
            <Action
              secondary
              disabled={op.busy}
              onPress={() =>
                confirm(
                  '撤销本次共享？',
                  '新的授权读取将被阻断。已送达或系统外保存的副本无法收回，其他独立授权不受影响。',
                  () => act('revoke'),
                )
              }
            >
              撤销共享
            </Action>
          )}
        </>
      )}
    </Page>
  );
}
