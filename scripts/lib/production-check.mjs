export function productionIssues(env) {
  const failures = [];
  if (env.APP_ENV !== 'production') failures.push('APP_ENV');
  if (env.AUTH_DEV_MODE !== 'false') failures.push('AUTH_DEV_MODE');
  try {
    const url = new URL(env.WEB_ORIGIN);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      failures.push('WEB_ORIGIN');
  } catch {
    failures.push('WEB_ORIGIN');
  }
  if (!env.AUTH_IP_SALT || env.AUTH_IP_SALT.length < 32) failures.push('AUTH_IP_SALT');
  const encryption = env.AI_USER_CONFIG_KEY ?? '';
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encryption) || Buffer.from(encryption, 'base64').length !== 32)
    failures.push('AI_USER_CONFIG_KEY');
  for (const name of [
    'AVEN_APP_PASSWORD',
    'AVEN_AUTH_PASSWORD',
    'AVEN_WORKER_PASSWORD',
    'REDIS_PASSWORD',
  ]) {
    if (!env[name] || env[name].length < 24 || /change.?me|example|development/i.test(env[name]))
      failures.push(name);
  }
  if (env.DATABASE_URL) {
    try {
      const url = new URL(env.DATABASE_URL);
      if (
        !['postgres:', 'postgresql:'].includes(url.protocol) ||
        decodeURIComponent(url.username) !== 'aven_app'
      )
        failures.push('DATABASE_URL_ROLE');
    } catch {
      failures.push('DATABASE_URL_ROLE');
    }
  }
  const passwords = ['AVEN_APP_PASSWORD', 'AVEN_AUTH_PASSWORD', 'AVEN_WORKER_PASSWORD'].map(
    (name) => env[name],
  );
  if (new Set(passwords).size !== passwords.length) failures.push('DISTINCT_DATABASE_PASSWORDS');
  if (env.AI_PROVIDER && env.AI_PROVIDER !== 'mock')
    failures.push('AI_PROVIDER_REQUIRES_LIVE_REVIEW');
  return failures;
}
