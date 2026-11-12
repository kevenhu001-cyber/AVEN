import { useState } from 'react';
import { Link } from 'expo-router';
import { useSession } from './session';
import { SafetyScreen } from './safety-screen';
import { useOperation, useRemote } from './remote';
import { Action, Card, Copy, Field, Loading, Page, Problem, confirm } from './ui';

export function AccountScreen() {
  const { api, me, call, refresh, logout, invalidate } = useSession();
  const [safety, setSafety] = useState(false);
  const remote = useRemote((signal) => api.auth.sessions(call(signal)));
  const op = useOperation();
  const [name, setName] = useState(me.user.displayName);
  const [timezone, setTimezone] = useState(me.user.timezone);
  const [locale, setLocale] = useState(me.user.locale);
  const [code, setCode] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  if (safety) return <SafetyScreen onBack={() => setSafety(false)} />;
  return (
    <Page>
      <Copy title>我的账号</Copy>
      <Copy>{me.user.email}</Copy>
      <Copy muted>{me.user.emailVerified ? '邮箱已验证' : '邮箱尚未验证'}</Copy>
      <Problem message={op.problem || remote.problem} />
      {!me.user.emailVerified && (
        <Card>
          <Field
            label="邮箱验证码"
            value={code}
            onChangeText={setCode}
            maxLength={256}
            editable={!op.busy}
          />
          <Action
            disabled={op.busy || !code.trim()}
            onPress={() =>
              void op.run(async (signal) => {
                await api.auth.verifyEmail(code, signal);
                setCode('');
                refresh();
              })
            }
          >
            验证邮箱
          </Action>
        </Card>
      )}
      <Card>
        <Copy title>个人资料</Copy>
        <Field
          label="显示名"
          value={name}
          onChangeText={setName}
          maxLength={120}
          editable={!op.busy}
        />
        <Field
          label="时区（IANA）"
          value={timezone}
          onChangeText={setTimezone}
          maxLength={64}
          editable={!op.busy}
        />
        <Field
          label="语言区域"
          value={locale}
          onChangeText={setLocale}
          maxLength={35}
          editable={!op.busy}
        />
        <Action
          disabled={op.busy}
          onPress={() =>
            void op.run(async (signal) => {
              await api.auth.updateProfile({ displayName: name, timezone, locale }, call(signal));
              refresh();
            })
          }
        >
          保存资料
        </Action>
      </Card>
      <Copy title>设备与会话</Copy>
      <Action secondary disabled={op.busy || remote.busy} onPress={() => void remote.reload()}>
        刷新会话
      </Action>
      {remote.busy && <Loading />}
      {remote.data?.data.map((session) => (
        <Card key={session.id}>
          <Copy>
            {session.client === 'mobile' ? 'Android / 移动端' : 'Web'}
            {session.current ? ' · 当前会话' : ''}
          </Copy>
          <Copy muted>有效至 {new Date(session.expiresAt).toLocaleString('zh-CN')}</Copy>
          <Copy>{session.revokedAt ? '已撤销' : '有效'}</Copy>
          {!session.revokedAt && (
            <Action
              secondary
              disabled={op.busy}
              onPress={() =>
                confirm(
                  '撤销会话？',
                  session.current ? '当前设备将退出登录。' : '该设备需要重新登录。',
                  () =>
                    void op.run(async (signal) => {
                      await api.auth.revokeSession(session.id, call(signal));
                      if (session.current) invalidate();
                      else await remote.reload();
                    }),
                )
              }
            >
              撤销会话
            </Action>
          )}
        </Card>
      ))}
      <Card>
        <Copy title>修改密码</Copy>
        <Copy muted>修改后所有设备需要重新登录。</Copy>
        <Field
          label="当前密码"
          value={currentPassword}
          onChangeText={setCurrentPassword}
          secureTextEntry
          maxLength={128}
          editable={!op.busy}
        />
        <Field
          label="新密码（至少 12 个字符）"
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
          maxLength={128}
          editable={!op.busy}
        />
        <Action
          disabled={op.busy || !currentPassword || newPassword.length < 12}
          onPress={() =>
            confirm(
              '修改密码？',
              '将撤销所有设备的登录会话。',
              () =>
                void op.run(async (signal) => {
                  try {
                    await api.auth.changePassword({ currentPassword, newPassword }, call(signal));
                    invalidate();
                  } finally {
                    setCurrentPassword('');
                    setNewPassword('');
                  }
                }),
            )
          }
        >
          修改密码并退出所有设备
        </Action>
      </Card>
      <Action secondary disabled={op.busy} onPress={() => setSafety(true)}>
        安全与举报
      </Action>
      <Copy muted>
        AI 与连接器使用
        Mock。私人正文不写入设备持久存储，进入后台后重新验证会话。没有移动推送或真实外部账号连接。
      </Copy>
      <Link href="/diagnostics">工程诊断</Link>
      <Action secondary disabled={op.busy} onPress={() => void op.run(async () => logout())}>
        退出登录
      </Action>
    </Page>
  );
}
