import type { PropsWithChildren, ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useColorScheme,
  View,
  type TextInputProps,
} from 'react-native';
import { colors } from '@aven/design-tokens';

export type Palette = {
  canvas: string;
  surface: string;
  'surface-raised': string;
  'surface-hover': string;
  border: string;
  'border-strong': string;
  text: string;
  'text-secondary': string;
  'text-tertiary': string;
  'user-bubble': string;
  'user-bubble-text': string;
  accent: string;
  'accent-text': string;
  'send-bg': string;
  'send-text': string;
  'mascot-bg': string;
  'mascot-eye': string;
};

/* Grok Bot 参考：深色画布、无阴影、纯色表面、细边框、胶囊输入条。 */
export const dark: Palette = {
  canvas: '#000000',
  surface: '#141416',
  'surface-raised': '#1C1C1E',
  'surface-hover': '#252528',
  border: '#28282C',
  'border-strong': '#38383E',
  text: '#F5F5F7',
  'text-secondary': '#8E8E93',
  'text-tertiary': '#71717A',
  'user-bubble': '#2C2C30',
  'user-bubble-text': '#F5F5F7',
  accent: '#F5B544',
  'accent-text': '#FFFFFF',
  'send-bg': '#FFFFFF',
  'send-text': '#000000',
  'mascot-bg': '#FFFFFF',
  'mascot-eye': '#000000',
};

export const light: Palette = {
  canvas: '#FFFFFF',
  surface: '#FFFFFF',
  'surface-raised': '#F4F4F4',
  'surface-hover': '#ECECEC',
  border: '#E6E6E6',
  'border-strong': '#D4D4D4',
  text: '#0D0D0D',
  'text-secondary': '#5D5D5D',
  'text-tertiary': '#8F8F8F',
  'user-bubble': '#F0F0F0',
  'user-bubble-text': '#0D0D0D',
  accent: '#B45309',
  'accent-text': '#FFFFFF',
  'send-bg': '#202020',
  'send-text': '#FFFFFF',
  'mascot-bg': '#111111',
  'mascot-eye': '#FFFFFF',
};

/** Semantic palette for the active system theme. */
export function usePalette(): Palette {
  return useColorScheme() === 'light' ? light : dark;
}

export function useTheme() {
  return colors[useColorScheme() === 'dark' ? 'dark' : 'light'];
}

export function Copy({
  children,
  muted = false,
  title = false,
}: PropsWithChildren<{ muted?: boolean; title?: boolean }>) {
  const palette = usePalette();
  return (
    <Text
      selectable
      style={{
        color: muted ? palette['text-secondary'] : palette.text,
        fontSize: title ? 22 : 15,
        fontWeight: title ? '600' : '400',
        lineHeight: title ? 30 : 23,
      }}
    >
      {children}
    </Text>
  );
}

export function Card({ children }: PropsWithChildren) {
  const palette = usePalette();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: palette['surface-raised'], borderColor: palette.border },
      ]}
    >
      {children}
    </View>
  );
}

export function Page({ children }: PropsWithChildren) {
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
      {children}
    </ScrollView>
  );
}

export function Action({
  children,
  onPress,
  disabled = false,
  secondary = false,
  testID,
}: PropsWithChildren<{
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
  testID?: string;
}>) {
  const palette = usePalette();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: secondary ? palette['surface-raised'] : palette.text,
          borderWidth: secondary ? 1 : 0,
          borderColor: palette.border,
          opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text
        style={{
          color: secondary ? palette.text : palette.canvas,
          textAlign: 'center',
          fontSize: 15,
          fontWeight: '600',
        }}
      >
        {children}
      </Text>
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const palette = usePalette();
  return (
    <View style={{ gap: 6 }}>
      <Copy>{label}</Copy>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={palette['text-tertiary']}
        autoCapitalize="none"
        {...props}
        style={[
          styles.input,
          {
            color: palette.text,
            borderColor: palette['border-strong'],
            backgroundColor: palette.surface,
          },
          props.multiline && { minHeight: 96, textAlignVertical: 'top' },
          props.style,
        ]}
      />
    </View>
  );
}

export function Toggle({
  label,
  value,
  onChange,
  disabled = false,
  accessibilityLabel,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const palette = usePalette();
  return (
    <View style={styles.row}>
      {!!label && <Text style={{ flex: 1, color: palette.text, fontSize: 15 }}>{label}</Text>}
      <Switch
        accessibilityLabel={accessibilityLabel ?? label}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
      />
    </View>
  );
}

export function Problem({ message }: { message: string }) {
  const theme = useTheme();
  return message ? (
    <Text
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{ color: theme.warning, lineHeight: 23 }}
    >
      {message}
    </Text>
  ) : null;
}

export function Loading() {
  return <ActivityIndicator accessibilityLabel="正在读取" color={usePalette().text} />;
}

export function confirm(title: string, body: string, action: () => void) {
  Alert.alert(title, body, [
    { text: '取消', style: 'cancel' },
    { text: '确认', style: 'destructive', onPress: action },
  ]);
}

export function Mascot({
  large = false,
  showStar = true,
}: {
  large?: boolean;
  showStar?: boolean;
}) {
  const palette = usePalette();
  const size = large ? 96 : 56;
  const radius = size / 2;
  const eyeWidth = large ? 10 : 6;
  const eyeHeight = large ? 26 : 16;
  return (
    <View style={{ alignSelf: 'center', position: 'relative' }}>
      <View
        accessible
        accessibilityLabel="AVEN 圆形角色"
        style={[
          styles.mascot,
          {
            width: size,
            height: size,
            borderRadius: radius,
            backgroundColor: palette['mascot-bg'],
            borderWidth: 0,
          },
        ]}
      >
        <View
          style={[
            styles.eye,
            { width: eyeWidth, height: eyeHeight, backgroundColor: palette['mascot-eye'] },
          ]}
        />
        <View
          style={[
            styles.eye,
            { width: eyeWidth, height: eyeHeight, backgroundColor: palette['mascot-eye'] },
          ]}
        />
      </View>
      {showStar && (
        <View
          style={{
            position: 'absolute',
            right: -2,
            bottom: -2,
            width: large ? 26 : 18,
            height: large ? 26 : 18,
            borderRadius: 999,
            backgroundColor: palette.accent,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 2,
            borderColor: palette.canvas,
          }}
        >
          <Text
            style={{ color: palette['accent-text'], fontSize: large ? 13 : 9, fontWeight: '700' }}
          >
            ★
          </Text>
        </View>
      )}
    </View>
  );
}

export function GrokRow({
  title,
  subtitle,
  value,
  onPress,
  children,
}: PropsWithChildren<{
  title: string;
  subtitle?: string;
  value?: string;
  onPress?: (() => void) | undefined;
}>) {
  const palette = usePalette();
  const content = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 13,
        paddingHorizontal: 16,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: palette.text, fontSize: 15, fontWeight: '500' }}>{title}</Text>
        {!!subtitle && (
          <Text style={{ color: palette['text-secondary'], fontSize: 12.5, lineHeight: 17 }}>
            {subtitle}
          </Text>
        )}
      </View>
      {!!value && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ color: palette['text-secondary'], fontSize: 14 }}>{value}</Text>
          <Text style={{ color: palette['text-tertiary'], fontSize: 14 }}>›</Text>
        </View>
      )}
      {onPress && !value && (
        <Text style={{ color: palette['text-tertiary'], fontSize: 14 }}>›</Text>
      )}
      {children}
    </View>
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
        {content}
      </Pressable>
    );
  }
  return content;
}

export function GrokDivider() {
  const palette = usePalette();
  return <View style={{ height: 1, backgroundColor: palette.border, marginHorizontal: 16 }} />;
}

/*
 * Message layout follows mainstream AI chat: the assistant writes as plain,
 * full-width prose with a small mark, while only the user message keeps a
 * compact rounded bubble on the trailing edge.
 */
export function ChatBubble({
  role,
  children,
}: {
  role: 'assistant' | 'user';
  children?: ReactNode;
}) {
  const palette = usePalette();
  if (role === 'user') {
    return (
      <View style={[styles.bubbleRow, styles.bubbleRowUser]}>
        <View
          style={[styles.bubble, styles.bubbleUser, { backgroundColor: palette['user-bubble'] }]}
        >
          <Text
            selectable
            style={{ color: palette['user-bubble-text'], fontSize: 15.5, lineHeight: 24 }}
          >
            {children}
          </Text>
        </View>
      </View>
    );
  }
  return (
    <View style={styles.assistantRow}>
      <View
        style={[
          styles.assistantMark,
          { backgroundColor: palette['mascot-bg'], borderColor: palette.border },
        ]}
      >
        <View style={[styles.assistantEye, { backgroundColor: palette['mascot-eye'] }]} />
        <View style={[styles.assistantEye, { backgroundColor: palette['mascot-eye'] }]} />
      </View>
      <View style={styles.assistantBody}>
        <Text selectable style={{ color: palette.text, fontSize: 15.5, lineHeight: 25 }}>
          {children}
        </Text>
      </View>
    </View>
  );
}

/* 会话时间分隔：参考图中的居中灰色时间戳。 */
export function TimeDivider({ children }: { children?: string }) {
  const palette = usePalette();
  return (
    <View style={styles.timeDivider}>
      <Text style={{ color: palette['text-tertiary'], fontSize: 12 }}>{children}</Text>
    </View>
  );
}

function MicGlyph({ color }: { color: string }) {
  return (
    <View style={styles.micGlyph}>
      <View style={[styles.micHead, { backgroundColor: color }]} />
      <View style={[styles.micCradle, { borderColor: color }]} />
      <View style={[styles.micStem, { backgroundColor: color }]} />
    </View>
  );
}

/* 底部胶囊输入条：加号入口、输入区、语音占位、发送或停止。 */
export function Composer({
  value,
  onChangeText,
  onSend,
  onStop,
  onPlugins,
  busy,
  disabled = false,
  placeholder = '向 AVEN 提问…',
}: {
  value: string;
  onChangeText: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onPlugins: () => void;
  busy: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const palette = usePalette();
  return (
    <View style={[styles.composerDock, { backgroundColor: palette.canvas }]}>
      <View
        style={[
          styles.composer,
          { borderColor: palette.border, backgroundColor: palette['surface-raised'] },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="连接器"
          onPress={onPlugins}
          disabled={disabled}
          style={({ pressed }) => [
            styles.composerIcon,
            { backgroundColor: palette['surface-hover'] },
            pressed && styles.composerIconPressed,
          ]}
        >
          <Text style={{ color: palette.text, fontSize: 20, lineHeight: 22 }}>＋</Text>
        </Pressable>
        <TextInput
          accessibilityLabel="向 AVEN 提问"
          placeholder={placeholder}
          placeholderTextColor={palette['text-secondary']}
          value={value}
          onChangeText={onChangeText}
          editable={!disabled && !busy}
          multiline
          maxLength={8000}
          style={[styles.composerInput, { color: palette.text }]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="语音模式"
          disabled
          style={styles.composerIcon}
        >
          <MicGlyph color={palette['text-secondary']} />
        </Pressable>
        {busy ? (
          <Pressable
            testID="chat-stop"
            accessibilityRole="button"
            accessibilityLabel="停止回复"
            onPress={onStop}
            style={({ pressed }) => [
              styles.sendButton,
              { backgroundColor: palette['send-bg'] },
              pressed && styles.composerIconPressed,
            ]}
          >
            <View style={[styles.stopGlyph, { backgroundColor: palette['send-text'] }]} />
          </Pressable>
        ) : (
          <Pressable
            testID="chat-send"
            accessibilityRole="button"
            accessibilityLabel="发送消息"
            onPress={onSend}
            disabled={disabled || !value.trim()}
            style={({ pressed }) => [
              styles.sendButton,
              { backgroundColor: palette['send-bg'] },
              (disabled || !value.trim()) && { backgroundColor: palette.border },
              pressed && styles.composerIconPressed,
            ]}
          >
            <Text
              style={{
                color: disabled || !value.trim() ? palette['text-tertiary'] : palette['send-text'],
                fontSize: 18,
                lineHeight: 20,
                fontWeight: '600',
              }}
            >
              ↑
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
export const styles = StyleSheet.create({
  page: { padding: 18, gap: 14, paddingBottom: 40 },
  card: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    gap: 12,
  },
  button: {
    minHeight: 46,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 12,
    justifyContent: 'center',
  },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    fontSize: 16,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bubbleRow: { flexDirection: 'row', marginBottom: 14 },
  bubbleRowUser: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '86%',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  bubbleUser: {
    borderBottomRightRadius: 6,
  },
  assistantRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 16,
  },
  assistantMark: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: 2,
  },
  assistantEye: { width: 4, height: 11, borderRadius: 2 },
  assistantBody: { flex: 1 },
  timeDivider: { alignItems: 'center', paddingVertical: 14 },
  composerDock: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  composerInput: {
    flex: 1,
    fontSize: 15.5,
    lineHeight: 22,
    maxHeight: 132,
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  composerIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerIconPressed: { opacity: 0.7 },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopGlyph: { width: 12, height: 12, borderRadius: 2 },
  micGlyph: { width: 14, height: 20, alignItems: 'center' },
  micHead: {
    width: 8,
    height: 12,
    borderRadius: 4,
  },
  micCradle: {
    width: 14,
    height: 8,
    marginTop: -2,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    borderWidth: 1.5,
    borderTopWidth: 0,
  },
  micStem: { width: 1.5, height: 3 },
  mascot: {
    width: 60,
    height: 60,
    borderRadius: 30,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  eye: { width: 7, height: 18, borderRadius: 4 },
});
