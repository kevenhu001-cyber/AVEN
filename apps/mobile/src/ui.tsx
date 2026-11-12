import type { PropsWithChildren } from 'react';
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

export function useTheme() {
  return colors[useColorScheme() === 'dark' ? 'dark' : 'light'];
}
export function Copy({
  children,
  muted = false,
  title = false,
}: PropsWithChildren<{ muted?: boolean; title?: boolean }>) {
  const theme = useTheme();
  return (
    <Text
      selectable
      style={{
        color: muted ? theme['foreground-secondary'] : theme.foreground,
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
  const theme = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme['surface-secondary'], borderColor: theme.border },
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
  const theme = useTheme();
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
          backgroundColor: secondary ? theme['surface-secondary'] : theme.primary,
          opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text
        style={{
          color: secondary ? theme.foreground : theme['primary-foreground'],
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
  const theme = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Copy>{label}</Copy>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme['foreground-tertiary']}
        autoCapitalize="none"
        {...props}
        style={[
          styles.input,
          {
            color: theme.foreground,
            borderColor: theme['control-border'],
            backgroundColor: theme.surface,
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
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Text style={{ flex: 1, color: theme.foreground, fontSize: 15 }}>{label}</Text>
      <Switch
        accessibilityLabel={label}
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
  return <ActivityIndicator accessibilityLabel="正在读取" color={useTheme().foreground} />;
}
export function confirm(title: string, body: string, action: () => void) {
  Alert.alert(title, body, [
    { text: '取消', style: 'cancel' },
    { text: '确认', style: 'destructive', onPress: action },
  ]);
}
export function Mascot() {
  return (
    <View accessible accessibilityLabel="AVEN 圆形角色" style={styles.mascot}>
      <View style={styles.eye} />
      <View style={styles.eye} />
    </View>
  );
}
export const styles = StyleSheet.create({
  page: { padding: 20, gap: 16, paddingBottom: 40 },
  card: { borderWidth: 1, borderRadius: 22, padding: 16, gap: 12 },
  button: {
    minHeight: 48,
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 13,
    justifyContent: 'center',
  },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 16, padding: 12, fontSize: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  mascot: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#111111',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  eye: { width: 7, height: 18, borderRadius: 4, backgroundColor: '#FFFFFF' },
});
