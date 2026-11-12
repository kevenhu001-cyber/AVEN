/** Fragment tokens never enter the HTTP request or referrer. */
export function parseResetFragment(fragment: string): string | null {
  const values = new URLSearchParams(fragment.replace(/^#/, '')).getAll('reset_token');
  if (values.length !== 1) return null;
  const token = values[0];
  return token && /^[A-Za-z0-9_-]{20,256}$/.test(token) ? token : null;
}
