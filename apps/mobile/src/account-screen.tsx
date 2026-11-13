import { useState } from 'react';
import { View, Text } from 'react-native';
import { Link } from 'expo-router';
import { useSession } from './session';
import { SafetyScreen } from './safety-screen';
import { useOperation, useRemote } from './remote';
import {
  Action,
  Card,
  Copy,
  Field,
  GrokDivider,
  GrokRow,
  Loading,
  Page,
  Problem,
  Toggle,
  confirm,
  usePalette,
  useTheme,
} from './ui';

/* 设备时区：仅用于“自动设置时区”开关，取不到时保持禁用而不是写死值。 */
function deviceTimezoneValue(): string | null {
  try {
    const value = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function AccountScreen({ onOpenConnectors }: { onOpenConnectors?: () => void }) {
  const { api, me, call, refresh, logout, invalidate } = useSession();
  const theme = useTheme();
  const palette = usePalette();
  const [safety, setSafety] = useState(false);
  const remote = useRemote((signal) => api.auth.sessions(call(signal)));
  const preferences = useRemote((signal) => api.notifications.getPreferences(call(signal)));
  const op = useOperation();
  const [name, setName] = useState(me.user.displayName);
  const [timezone, setTimezone] = useState(me.user.timezone);
  const [locale, setLocale] = useState(me.user.locale);
  const [code, setCode] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [autoTimezone, setAutoTimezone] = useState(false);
  const deviceTimezone = deviceTimezoneValue();

  if (safety) return <SafetyScreen onBack={() => setSafety(false)} />;
  return (
    <Page>
      {/* Grok Bot Profile Card Group */}
      <Card>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingVertical: 10,
            paddingHorizontal: 16,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: palette['surface-hover'],
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: palette.text, fontSize: 18, fontWeight: '600' }}>
                {Array.from(me.user.displayName)[0]}
              </Text>
            </View>
            <View style={{ gap: 2 }}>
              <Text style={{ color: theme.foreground, fontSize: 16, fontWeight: '600' }}>
                {me.user.displayName}
              </Text>
              <Text style={{ color: theme['foreground-secondary'], fontSize: 13 }}>
                {me.user.email}
              </Text>
            </View>
          </View>
          <Text style={{ color: theme['foreground-tertiary'], fontSize: 16 }}>›</Text>
        </View>
        <GrokDivider />
        <GrokRow title="用量" subtitle="计量统计尚未接入，不展示估算数字" value="未统计" />
      </Card>

      {/* Connected Apps Card Group */}
      <Card>
        <GrokRow
          title="连接应用"
          subtitle="搜索插件并按用途调用，当前为 Mock 样例"
          onPress={onOpenConnectors}
        />
      </Card>

      {/* Bot Section Group */}
      <Text
        style={{
          color: theme['foreground-secondary'],
          fontSize: 13,
          fontWeight: '600',
          letterSpacing: 0.5,
          marginTop: 6,
          marginLeft: 4,
          textTransform: 'uppercase',
        }}
      >
        Bot
      </Text>
      <Card>
        <GrokRow
          title="自动审查"
          subtitle="AVEN 会检查每个操作，并在需要你同意时询问你"
          value="不可用"
        />
        <GrokDivider />
        <GrokRow title="自动设置时区" subtitle="Bot 的电脑跟随此设备的时区。">
          <Toggle
            label=""
            accessibilityLabel="自动设置时区"
            value={autoTimezone}
            disabled={op.busy || !deviceTimezone}
            onChange={(value) => {
              setAutoTimezone(value);
              if (!value || !deviceTimezone) return;
              setTimezone(deviceTimezone);
              void op.run(async (signal) => {
                await api.auth.updateProfile(
                  { displayName: name, timezone: deviceTimezone, locale },
                  call(signal),
                );
                refresh();
              });
            }}
          />
        </GrokRow>
        <GrokDivider />
        <GrokRow title="时区" value={timezone || 'Asia/Shanghai'} />
        <GrokDivider />
        <GrokRow title="Bot 电脑" value="查看环境" />
      </Card>

      {/* Preferences Group */}
      <Card>
        <GrokRow title="通知" subtitle="连接与活动通知偏好">
          <Toggle
            label=""
            accessibilityLabel="通知"
            value={
              preferences.data
                ? preferences.data.connectionInvitations || preferences.data.eventInvitations
                : false
            }
            disabled={op.busy || !preferences.data}
            onChange={(value) =>
              void op.run(async (signal) => {
                const current = preferences.data;
                if (!current) return;
                await api.notifications.updatePreferences(
                  {
                    connectionInvitations: value,
                    eventInvitations: value,
                    expectedVersion: current.version,
                  },
                  call(signal),
                );
                await preferences.reload();
              })
            }
          />
        </GrokRow>
        <GrokDivider />
        <GrokRow title="外观" value="跟随系统" />
        <GrokDivider />
        <GrokRow title="语言" value={locale || 'zh-CN'} />
      </Card>

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
