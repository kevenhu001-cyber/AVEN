import { useRef, useState } from 'react';
import { type MobileApi, problemText } from './api';
import { Action, Card, Copy, Field, Mascot, Page, Problem } from './ui';

export function AuthScreen({
  api,
  onLogin,
}: {
  api: MobileApi;
  onLogin: (token: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<'login' | 'register' | 'request' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  async function submit() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      if (mode === 'register') {
        await api.auth.register({ email, password, displayName: name });
        setMode('login');
        setMessage('注册成功，请登录。验证邮件目前保存在开发机本地。');
      } else if (mode === 'request') {
        await api.auth.requestPasswordReset(email);
        setMode('reset');
        setMessage('若账号存在，已生成重置指引。开发邮件保存在开发机本地。');
      } else if (mode === 'reset') {
        await api.auth.resetPassword(code, password);
        setCode('');
        setMode('login');
        setMessage('密码已重置，所有旧会话已失效。');
      } else {
        const result = await api.auth.loginMobile({ email, password });
        await onLogin(result.sessionToken);
      }
    } catch (error) {
      setMessage(problemText(error));
    } finally {
      setPassword('');
      setBusy(false);
      lock.current = false;
    }
  }
  return (
    <Page>
      <Mascot />
      <Copy title>
        {mode === 'login' ? '回到你的 AVEN' : mode === 'register' ? '从一次对话开始' : '找回密码'}
      </Copy>
      <Copy muted>聊聊想法，认识合适的人。每次分享，由你决定。</Copy>
      <Card>
        {mode === 'register' && (
          <Field
            label="怎么称呼你"
            value={name}
            onChangeText={setName}
            maxLength={120}
            editable={!busy}
          />
        )}
        {mode !== 'reset' && (
          <Field
            label="邮箱"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoComplete="email"
            maxLength={320}
            editable={!busy}
          />
        )}
        {mode === 'reset' && (
          <Field
            label="重置码"
            value={code}
            onChangeText={setCode}
            maxLength={256}
            editable={!busy}
          />
        )}
        {mode !== 'request' && (
          <Field
            label={mode === 'login' ? '密码' : '新密码（至少 12 个字符）'}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            maxLength={128}
            editable={!busy}
          />
        )}
        <Problem message={message} />
        <Action testID="auth-submit" onPress={() => void submit()} disabled={busy}>
          {busy
            ? '正在验证…'
            : { login: '登录', register: '创建账号', request: '获取重置指引', reset: '重置密码' }[
                mode
              ]}
        </Action>
        <Action
          secondary
          disabled={busy}
          onPress={() => {
            setPassword('');
            setMessage('');
            setMode(mode === 'login' ? 'register' : 'login');
          }}
        >
          {mode === 'login' ? '注册账号' : '返回登录'}
        </Action>
        {mode === 'login' && (
          <Action
            secondary
            disabled={busy}
            onPress={() => {
              setPassword('');
              setMessage('');
              setMode('request');
            }}
          >
            忘记密码
          </Action>
        )}
      </Card>
      <Copy muted>开发验证版 · AI 与连接器使用 Mock 服务。</Copy>
    </Page>
  );
}
