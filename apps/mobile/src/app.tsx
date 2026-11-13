import { useEffect, useRef, useState } from 'react';
import {
  Appearance,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link } from 'expo-router';
import { createMobileApi } from './api';
import { SessionProvider, useSession } from './session';
import { AuthScreen } from './auth-screen';
import { ChatScreen, type ChatScreenHandle } from './chat-screen';
import { MemoryScreen } from './memory-screen';
import { ConnectionsScreen } from './connections-screen';
import { NotificationsScreen } from './notifications-screen';
import { AccountScreen } from './account-screen';
import { Action, Copy, Mascot, Page, usePalette } from './ui';

function configuration() {
  try {
    return createMobileApi();
  } catch {
    return null;
  }
}
const config = configuration();
export function MobileApp() {
  const palette = usePalette();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.canvas }}>
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
type Panel = 'chat' | 'memory' | 'connections' | 'notifications' | 'account';
const panelLabels: Record<Panel, string> = {
  chat: '对话',
  memory: '记忆与上下文',
  connections: '我的连接',
  notifications: '通知',
  account: '我的账号',
};
function Workspace() {
  const { me } = useSession();
  const palette = usePalette();
  const scheme = useColorScheme();
  const [panel, setPanel] = useState<Panel>('chat');
  const [menu, setMenu] = useState(false);
  const [pendingConnectors, setPendingConnectors] = useState(false);
  const chat = useRef<ChatScreenHandle>(null);
  useEffect(() => {
    if (panel === 'chat' && pendingConnectors) {
      setPendingConnectors(false);
      chat.current?.openConnectors();
    }
  }, [panel, pendingConnectors]);
  return (
    <KeyboardAvoidingView behavior="height" style={{ flex: 1, backgroundColor: palette.canvas }}>
      <View
        style={{
          paddingHorizontal: 16,
          paddingVertical: 10,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottomWidth: 1,
          borderBottomColor: palette.border,
          backgroundColor: palette.canvas,
        }}
      >
        <Pressable
          onPress={() => setPanel('account')}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: palette['surface-hover'],
            alignItems: 'center',
            justifyContent: 'center',
          }}
          accessibilityLabel="打开个人设置"
        >
          <Text style={{ color: palette.text, fontSize: 14, fontWeight: '600' }}>
            {Array.from(me.user.displayName)[0]}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setPanel('chat')}
          accessibilityLabel="返回对话"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: palette.border,
            backgroundColor: palette.surface,
          }}
        >
          <Mascot showStar={false} />
          <Text style={{ color: palette.text, fontSize: 16, fontWeight: '600' }}>AVEN</Text>
        </Pressable>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Pressable
            onPress={() => {
              const next = scheme === 'dark' ? 'light' : 'dark';
              Appearance.setColorScheme(next);
            }}
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: palette['surface-hover'],
              alignItems: 'center',
              justifyContent: 'center',
            }}
            accessibilityLabel={scheme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
          >
            <Text style={{ color: palette.text, fontSize: 15 }}>
              {scheme === 'dark' ? '☀' : '☾'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setMenu(true)}
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: palette['surface-hover'],
              alignItems: 'center',
              justifyContent: 'center',
            }}
            accessibilityLabel="打开菜单"
          >
            <Text style={{ color: palette.text, fontSize: 16, lineHeight: 18 }}>⋯</Text>
          </Pressable>
        </View>
      </View>
      <View style={{ flex: 1 }} key={panel}>
        {panel === 'chat' ? (
          <ChatScreen ref={chat} />
        ) : panel === 'memory' ? (
          <MemoryScreen />
        ) : panel === 'connections' ? (
          <ConnectionsScreen />
        ) : panel === 'notifications' ? (
          <NotificationsScreen />
        ) : (
          <AccountScreen
            onOpenConnectors={() => {
              setPanel('chat');
              setPendingConnectors(true);
            }}
          />
        )}
      </View>
      <Modal visible={menu} animationType="slide" transparent onRequestClose={() => setMenu(false)}>
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }}
          accessibilityLabel="关闭菜单"
          onPress={() => setMenu(false)}
        >
          <Pressable
            style={{
              marginTop: 'auto',
              backgroundColor: palette.surface,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              borderTopWidth: 1,
              borderColor: palette.border,
              paddingVertical: 18,
              paddingHorizontal: 16,
              gap: 10,
            }}
            onPress={() => undefined}
          >
            <View
              style={{
                alignSelf: 'center',
                width: 36,
                height: 4,
                borderRadius: 2,
                backgroundColor: palette['border-strong'],
                marginBottom: 6,
              }}
            />
            <Action
              secondary
              onPress={() => {
                chat.current?.newChat();
                setMenu(false);
              }}
            >
              新对话
            </Action>
            <Action
              secondary
              onPress={() => {
                chat.current?.openHistory();
                setMenu(false);
              }}
            >
              对话记录
            </Action>
            <Action
              secondary
              onPress={() => {
                chat.current?.openConnectors();
                setMenu(false);
              }}
            >
              连接器
            </Action>
            {(Object.keys(panelLabels) as Panel[])
              .filter((key) => key !== 'chat')
              .map((key) => (
                <Action
                  key={key}
                  secondary={panel !== key}
                  onPress={() => {
                    setPanel(key);
                    setMenu(false);
                  }}
                >
                  {panelLabels[key]}
                </Action>
              ))}
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}
