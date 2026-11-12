import { useState } from 'react';
import { KeyboardAvoidingView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link } from 'expo-router';
import { createMobileApi } from './api';
import { SessionProvider } from './session';
import { AuthScreen } from './auth-screen';
import { ChatScreen } from './chat-screen';
import { MemoryScreen } from './memory-screen';
import { ConnectionsScreen } from './connections-screen';
import { NotificationsScreen } from './notifications-screen';
import { AccountScreen } from './account-screen';
import { Action, Copy, Page, useTheme } from './ui';

function configuration() {
  try {
    return createMobileApi();
  } catch {
    return null;
  }
}
const config = configuration();
export function MobileApp() {
  const theme = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      {config ? (
        <SessionProvider
          api={config.api}
          origin={config.origin}
          renderAuth={(onLogin) => <AuthScreen api={config.api} onLogin={onLogin} />}
        >
          <Workspace />
        </SessionProvider>
      ) : (
        <Page>
          <Copy title>连接你的 AVEN</Copy>
          <Copy>
            请在构建环境配置 EXPO_PUBLIC_API_URL。Android 模拟器使用
            http://10.0.2.2:3001，真机使用开发机局域网地址；正式构建必须使用 HTTPS。
          </Copy>
          <Link href="/diagnostics">打开工程诊断</Link>
        </Page>
      )}
    </SafeAreaView>
  );
}
function Workspace() {
  const [panel, setPanel] = useState<
    'chat' | 'memory' | 'connections' | 'notifications' | 'account'
  >('chat');
  const [menu, setMenu] = useState(false);
  return (
    <KeyboardAvoidingView behavior="height" style={{ flex: 1 }}>
      <View
        style={{
          paddingHorizontal: 20,
          paddingVertical: 10,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Copy title>AVEN</Copy>
        <Action secondary onPress={() => setMenu((value) => !value)}>
          {menu ? '关闭导航' : '打开导航'}
        </Action>
      </View>
      {menu && (
        <View accessibilityLabel="个人导航" style={{ padding: 16, gap: 8 }}>
          {(['chat', 'memory', 'connections', 'notifications', 'account'] as const).map((key) => (
            <Action
              key={key}
              secondary={panel !== key}
              onPress={() => {
                setPanel(key);
                setMenu(false);
              }}
            >
              {
                {
                  chat: '对话',
                  memory: '记忆与上下文',
                  connections: '我的连接',
                  notifications: '通知',
                  account: '我的账号',
                }[key]
              }
            </Action>
          ))}
        </View>
      )}
      <View style={{ flex: 1 }} key={panel}>
        {panel === 'chat' ? (
          <ChatScreen />
        ) : panel === 'memory' ? (
          <MemoryScreen />
        ) : panel === 'connections' ? (
          <ConnectionsScreen />
        ) : panel === 'notifications' ? (
          <NotificationsScreen />
        ) : (
          <AccountScreen />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
