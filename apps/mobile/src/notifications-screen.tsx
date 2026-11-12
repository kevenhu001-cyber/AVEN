import { useState } from 'react';
import type { Notification } from '@aven/contracts';
import { useSession } from './session';
import { useOperation, useRemote } from './remote';
import { Action, Card, Copy, Loading, Page, Problem, Toggle } from './ui';

const labels = {
  sent: '收到连接邀请',
  accepted: '连接已接受',
  declined: '连接未接受',
  withdrawn: '邀请已撤回',
  revoked: '共享已撤销',
  proposed: '活动提案',
  confirmed: '活动已确认',
  cancelled: '活动已取消',
};
const preferenceLabels = {
  connectionInvitations: '连接邀请通知',
  connectionUpdates: '连接状态通知',
  eventInvitations: '活动提案通知',
  eventUpdates: '活动变更通知',
};
export function NotificationsScreen() {
  const { api, call } = useSession();
  const remote = useRemote((signal) =>
    Promise.all([
      api.notifications.list({}, call(signal)),
      api.notifications.getPreferences(call(signal)),
    ]),
  );
  const op = useOperation();
  const [older, setOlder] = useState<Notification[]>([]);
  const [cursor, setCursor] = useState<{ createdAt: string; id: string } | null | undefined>(
    undefined,
  );
  const next = cursor === undefined ? remote.data?.[0].nextCursor : cursor;
  return (
    <Page>
      <Copy title>通知</Copy>
      <Copy muted>站内通知，手动刷新；尚未接入移动推送。</Copy>
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
        刷新通知
      </Action>
      {remote.busy && <Loading />}
      {remote.data && (
        <Card>
          <Copy title>通知偏好</Copy>
          {(Object.keys(preferenceLabels) as (keyof typeof preferenceLabels)[]).map((key) => (
            <Toggle
              key={key}
              label={preferenceLabels[key]}
              value={remote.data![1][key]}
              disabled={op.busy}
              onChange={(value) =>
                void op.run(async (signal) => {
                  try {
                    await api.notifications.updatePreferences(
                      { [key]: value, expectedVersion: remote.data![1].version },
                      call(signal),
                    );
                  } finally {
                    setOlder([]);
                    setCursor(undefined);
                    await remote.reload();
                  }
                })
              }
            />
          ))}
        </Card>
      )}
      {remote.data?.[0].data.length === 0 && <Copy muted>暂时没有通知。</Copy>}
      {[...(remote.data?.[0].data ?? []), ...older].map((item) => (
        <Card key={item.id}>
          <Copy>
            {labels[item.kind]} · {item.readAt ? '已读' : '未读'}
          </Copy>
          <Copy muted>{new Date(item.createdAt).toLocaleString('zh-CN')}</Copy>
          <Copy muted>
            {item.target.type === 'event'
              ? '活动通知，完整活动页面尚未接入。'
              : '可到“我的连接”重新读取邀请详情。'}
          </Copy>
          {!item.readAt && (
            <Action
              secondary
              disabled={op.busy}
              onPress={() =>
                void op.run(async (signal) => {
                  const updated = await api.notifications.read(item.id, call(signal));
                  remote.setData((old) =>
                    old
                      ? [
                          {
                            ...old[0],
                            data: old[0].data.map((value) =>
                              value.id === item.id ? updated : value,
                            ),
                          },
                          old[1],
                        ]
                      : old,
                  );
                  setOlder((old) => old.map((value) => (value.id === item.id ? updated : value)));
                })
              }
            >
              标为已读
            </Action>
          )}
        </Card>
      ))}
      {next && (
        <Action
          secondary
          disabled={op.busy}
          onPress={() =>
            void op.run(async (signal) => {
              const result = await api.notifications.list(
                { cursorCreatedAt: next.createdAt, cursorId: next.id },
                call(signal),
              );
              setOlder((old) => [...old, ...result.data]);
              setCursor(result.nextCursor);
            })
          }
        >
          更早的通知
        </Action>
      )}
    </Page>
  );
}
