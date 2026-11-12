import { useState } from 'react';
import type { ReportReason } from '@aven/contracts';
import { useSession } from './session';
import { useOperation, useRemote } from './remote';
import { Action, Card, Copy, Field, Loading, Page, Problem, confirm } from './ui';
const reasons: Record<ReportReason, string> = {
  spam: '垃圾信息',
  harassment: '骚扰',
  inappropriate_content: '不当内容',
  privacy_violation: '隐私侵害',
  other: '其他',
};
export function SafetyScreen({ onBack }: { onBack: () => void }) {
  const { api, call } = useSession();
  const options = (signal?: AbortSignal) => {
    const auth = call(signal).auth;
    if (auth.kind !== 'mobile') throw new Error('Mobile auth required.');
    return { bearerToken: auth.bearerToken, ...(signal ? { signal } : {}) };
  };
  const remote = useRemote((signal) =>
    Promise.all([
      api.moderation.listBlocks(options(signal)),
      api.moderation.listReports(options(signal)),
    ]),
  );
  const op = useOperation();
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState<ReportReason>('spam');
  const [details, setDetails] = useState('');
  const [submitted, setSubmitted] = useState(false);
  return (
    <Page>
      <Action secondary disabled={op.busy} onPress={onBack}>
        返回账号
      </Action>
      <Copy title>安全与举报</Copy>
      <Copy muted>拉黑将阻断双方的新邀请与消息。举报只提交记录，不表示已完成人工审核。</Copy>
      <Problem message={remote.problem || op.problem} />
      <Field
        label="对方完整连接码"
        value={target}
        onChangeText={(value) => {
          setTarget(value);
          setSubmitted(false);
        }}
        maxLength={50}
        editable={!op.busy}
      />
      <Field
        label="举报补充说明（可选）"
        value={details}
        onChangeText={setDetails}
        maxLength={1000}
        multiline
        editable={!op.busy}
      />
      <Copy>举报原因：{reasons[reason]}</Copy>
      {(Object.keys(reasons) as ReportReason[]).map((key) => (
        <Action
          secondary={reason !== key}
          key={key}
          disabled={op.busy}
          onPress={() => setReason(key)}
        >
          {reasons[key]}
        </Action>
      ))}
      <Action
        disabled={op.busy || !target.trim()}
        onPress={() =>
          confirm(
            '拉黑此用户？',
            '将阻断双方的新邀请与消息。',
            () =>
              void op.run(async (signal) => {
                await api.moderation.blockUser(
                  { blockedUserId: target.trim().replace(/^aven:/i, '') },
                  options(signal),
                );
                await remote.reload();
              }),
          )
        }
      >
        拉黑用户
      </Action>
      <Action
        secondary
        disabled={op.busy || submitted || !target.trim()}
        onPress={() =>
          confirm(
            '提交举报？',
            '请确认目标和原因。',
            () =>
              void op.run(async (signal) => {
                setSubmitted(true);
                await api.moderation.submitReport(
                  {
                    targetType: 'user',
                    targetId: target.trim().replace(/^aven:/i, ''),
                    reason,
                    details,
                  },
                  options(signal),
                );
                await remote.reload();
              }),
          )
        }
      >
        提交举报
      </Action>
      <Action secondary disabled={op.busy || remote.busy} onPress={() => void remote.reload()}>
        刷新安全记录
      </Action>
      {remote.busy && <Loading />}
      <Copy title>已拉黑用户</Copy>
      {remote.data?.[0].blocks.length === 0 && <Copy muted>没有拉黑记录。</Copy>}
      {remote.data?.[0].blocks.map((item) => (
        <Card key={item.id}>
          <Copy>aven:{item.blockedUserId}</Copy>
          <Action
            secondary
            disabled={op.busy}
            onPress={() =>
              confirm(
                '解除拉黑？',
                '将允许双方再次发送邀请和消息。',
                () =>
                  void op.run(async (signal) => {
                    await api.moderation.unblockUser(item.blockedUserId, options(signal));
                    await remote.reload();
                  }),
              )
            }
          >
            解除拉黑
          </Action>
        </Card>
      ))}
      <Copy title>我的举报</Copy>
      {remote.data?.[1].reports.length === 0 && <Copy muted>没有举报记录。</Copy>}
      {remote.data?.[1].reports.map((item) => (
        <Card key={item.id}>
          <Copy>
            {reasons[item.reason]} · {item.status}
          </Copy>
          <Copy muted>{item.targetId}</Copy>
        </Card>
      ))}
    </Page>
  );
}
