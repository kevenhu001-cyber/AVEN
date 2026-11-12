import { URL } from 'node:url';
import { SafeHttpsUrlSchema } from '@aven/contracts';
import { AIError } from '../errors.js';

function hostMatchesAllowlist(hostname: string, allowedHost: string): boolean {
  const normalizedHost = hostname.toLowerCase();
  const normalizedAllowed = allowedHost.toLowerCase();
  return normalizedHost === normalizedAllowed || normalizedHost.endsWith(`.${normalizedAllowed}`);
}

/**
 * Validates that an external link returned by a plugin is public https://
 * and belongs strictly to the plugin's declared host allowlist.
 */
export function sanitizeExternalPluginUrl(rawUrl: string, allowedHosts: readonly string[]): string {
  const parsedUrl = SafeHttpsUrlSchema.safeParse(rawUrl);
  if (!parsedUrl.success) {
    throw new AIError('TOOL_RESULT_INVALID', 'Plugin returned an unsafe external URL.');
  }
  const hostname = new URL(parsedUrl.data).hostname;
  if (!allowedHosts.some((allowed) => hostMatchesAllowlist(hostname, allowed))) {
    throw new AIError('TOOL_RESULT_INVALID', 'Plugin returned a URL outside its allowed hosts.');
  }
  return parsedUrl.data;
}
