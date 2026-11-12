import { useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import type { PeerMessage } from '@aven/contracts';
import { useSession } from './session';
import { useOperation, useRemote } from './remote';
import { uncertain } from './api';
import { Action, Card, Copy, Field, Loading, Page, Problem, confirm } from './ui';

export function PeerChatScreen({
  connectionId,
  onBack,
}: {
  connectionId: string;
  onBack: () => void;
}) {
  const { api, call, me } = useSession();
  const remote = useRemote((signal) =>
    api.connections.listMessages(connectionId, {}, call(signal)),
  );
  const op = useOperation();
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<{ content: string; clientMessageId: string } | null>(null);
  const [older, setOlder] = useState<PeerMessage[]>([]);
  const [cursor, setCursor] = useState<{ createdAt: string; id: string } | null | undefined>(
    undefined,
  );
  const next = cursor === undefined ? remote.data?.nextCursor : cursor;
  const key = useRef(Crypto.randomUUID());
  async function send() {
    const input = pending ?? { content: draft.trim(), clientMessageId: key.current };
    if (!input.content) return;
    await op.run(async (signal) => {
      try {
        await api.connections.sendMessage(connectionId, input, call(signal));
        setDraft('');
        setPending(null);
        key.current = Crypto.randomUUID();
        setOlder([]);
        setCursor(undefined);
        await remote.reload();
      } catch (error) {
        if (uncertain(error)) setPending(input);
        else {
          setPending(null);
          key.current = Crypto.randomUUID();
        }
        throw error;
      }
    });
  }
  return (
    <Page>
      <Action secondary onPress={onBack} disabled={op.busy || !!pending}>
        返回连接
      </Action>
      <Copy title>连接消息</Copy>
      <Copy muted>消息按需读取，没有即时推送。</Copy>
      <Problem message={op.problem || remote.problem} />
      <Action
        secondary
        disabled={op.busy || remote.busy}
        onPress={() => {
          setOlder([]);
          setCursor(undefined);
          void remote.reload();
        }}
      >
        刷新消息
      </Action>
      {remote.busy && <Loading />}
      {remote.data?.messages.length === 0 && <Copy muted>还没有消息。</Copy>}
      {[...(remote.data?.messages ?? []), ...older].map((item) => (
        <Card key={item.id}>
          <Copy muted>
            {item.senderUserId === me.user.id ? '我' : '对方'} ·{' '}
            {new Date(item.createdAt).toLocaleString('zh-CN')}
          </Copy>
          <Copy>{item.content}</Copy>
          <Action
            secondary
            disabled={op.busy}
            onPress={() =>
              confirm(
                '从我的视图删除消息？',
                '单方删除只对本人隐藏，不会删除对方已收到的副本。',
                () =>
                  void op.run(async (signal) => {
                    await api.connections.deleteMessage(connectionId, item.id, call(signal));
                    setOlder([]);
                    setCursor(undefined);
                    await remote.reload();
                  }),
              )
            }
          >
            删除此条消息
          </Action>
        </Card>
      ))}
      {next && (
        <Action
          secondary
          disabled={op.busy}
          onPress={() =>
            void op.run(async (signal) => {
              const result = await api.connections.listMessages(
                connectionId,
                { cursorCreatedAt: next.createdAt, cursorId: next.id },
                call(signal),
              );
              setOlder((old) => [...old, ...result.messages]);
              setCursor(result.nextCursor);
            })
          }
        >
          更早的消息
        </Action>
      )}
      <Field
        label="发送给对方"
        value={draft}
        onChangeText={setDraft}
        multiline
        maxLength={4000}
        editable={!op.busy && !pending}
      />
      {pending && <Copy muted>结果未确认，核对会沿用相同消息 ID，不创建新消息。</Copy>}
      <Action disabled={op.busy || (!pending && !draft.trim())} onPress={() => void send()}>
        {pending ? '核对本次发送结果' : '发送消息'}
      </Action>
    </Page>
  );
}
