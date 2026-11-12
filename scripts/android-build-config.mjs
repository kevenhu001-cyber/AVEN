// Validate public build configuration without printing values into CI logs.
const value = process.env.EXPO_PUBLIC_API_URL?.trim();
if (!value) {
  console.log('No API origin configured: APK will display configuration instructions.');
} else {
  let valid = false;
  try {
    const url = new URL(value);
    valid =
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    /* Report only the configuration key, never its value. */
  }
  if (!valid) throw new Error('EXPO_PUBLIC_API_URL must be a device-accessible HTTPS origin.');
  console.log('Public API origin validated. Mock Provider remains server-controlled.');
}
