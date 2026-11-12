import { HttpStatus } from '@nestjs/common';
import type { AvailabilityStatus, CalendarOAuthProvider } from '@aven/contracts';
import { ApiCodeException } from '../http-errors.js';
import type { OAuthTokenPayload } from './calendar-crypto.js';

export const CALENDAR_OAUTH_ADAPTER = Symbol('CALENDAR_OAUTH_ADAPTER');

export type SyncExternalBusyBlock = {
  startAt: string;
  endAt: string;
  timezone: string;
  status: AvailabilityStatus;
};

export type CalendarAdapterErrorCode =
  'TOKEN_REVOKED' | 'SYNC_CURSOR_EXPIRED' | 'UPSTREAM_UNAVAILABLE';

export class CalendarAdapterError extends Error {
  constructor(
    public readonly code: CalendarAdapterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CalendarAdapterError';
  }
}

export interface CalendarOAuthAdapter {
  getAuthorizationConfig(input: {
    provider: CalendarOAuthProvider;
    stateToken: string;
    redirectUri: string;
    loginHint?: string;
    allowLive: boolean;
  }): Promise<{
    authorizationUrl: string;
    scopes: string[];
    providerMode: 'mock' | 'live';
  }>;

  exchangeCode(input: {
    provider: CalendarOAuthProvider;
    code: string;
    redirectUri: string;
    allowLive: boolean;
  }): Promise<{
    tokens: OAuthTokenPayload;
    providerMode: 'mock' | 'live';
  }>;

  fetchBusyDelta(input: {
    provider: CalendarOAuthProvider;
    tokens: OAuthTokenPayload;
    syncCursor: string | null;
    windowStart: string;
    windowEnd: string;
    allowLive: boolean;
  }): Promise<{
    blocks: SyncExternalBusyBlock[];
    nextCursor: string;
    refreshedTokens?: OAuthTokenPayload;
    providerMode: 'mock' | 'live';
  }>;
}

const PROVIDER_METADATA: Record<
  CalendarOAuthProvider,
  { authBase: string; scopes: string[]; envVar: string }
> = {
  google_calendar: {
    authBase: 'https://accounts.google.com/o/oauth2/v2/auth',
    scopes: ['https://www.googleapis.com/auth/calendar.freebusy'],
    envVar: 'GOOGLE_CALENDAR_CLIENT_ID',
  },
  microsoft_outlook: {
    authBase: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    scopes: ['Calendars.Read', 'offline_access'],
    envVar: 'MICROSOFT_CALENDAR_CLIENT_ID',
  },
  feishu_calendar: {
    authBase: 'https://open.feishu.cn/open-apis/authen/v1/authorize',
    scopes: ['calendar:calendar.freebusy:read'],
    envVar: 'FEISHU_CALENDAR_APP_ID',
  },
  caldav_ics: {
    authBase: 'https://caldav.aven.example.com/oauth/authorize',
    scopes: ['caldav:freebusy:read'],
    envVar: 'CALDAV_OAUTH_CLIENT_ID',
  },
};

function requireNoMissingLiveConfig(provider: CalendarOAuthProvider, allowLive: boolean): void {
  if (!allowLive) return;
  const meta = PROVIDER_METADATA[provider];
  if (!process.env[meta.envVar]?.trim()) {
    throw new ApiCodeException(
      'PROVIDER_UNAVAILABLE',
      HttpStatus.SERVICE_UNAVAILABLE,
      `Live OAuth credentials are not configured for ${provider}.`,
      false,
    );
  }
}

export class MockCalendarOAuthAdapter implements CalendarOAuthAdapter {
  async getAuthorizationConfig(input: {
    provider: CalendarOAuthProvider;
    stateToken: string;
    redirectUri: string;
    loginHint?: string;
    allowLive: boolean;
  }) {
    requireNoMissingLiveConfig(input.provider, input.allowLive);
    const meta = PROVIDER_METADATA[input.provider];
    const url = new URL(meta.authBase);
    url.searchParams.set('client_id', `aven-mock-${input.provider}`);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', meta.scopes.join(' '));
    url.searchParams.set('state', input.stateToken);
    url.searchParams.set('access_type', 'offline');
    if (input.loginHint) {
      url.searchParams.set('login_hint', input.loginHint);
    }

    return {
      authorizationUrl: url.toString(),
      scopes: meta.scopes,
      providerMode: 'mock' as const,
    };
  }

  async exchangeCode(input: {
    provider: CalendarOAuthProvider;
    code: string;
    redirectUri: string;
    allowLive: boolean;
  }) {
    requireNoMissingLiveConfig(input.provider, input.allowLive);
    const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
    return {
      tokens: {
        accessToken: `mock-access-${input.provider}-${input.code.slice(0, 8)}`,
        refreshToken: `mock-refresh-${input.provider}-${input.code.slice(0, 8)}`,
        expiresAt,
        scope: PROVIDER_METADATA[input.provider].scopes.join(' '),
        tokenType: 'Bearer',
      },
      providerMode: 'mock' as const,
    };
  }

  async fetchBusyDelta(input: {
    provider: CalendarOAuthProvider;
    tokens: OAuthTokenPayload;
    syncCursor: string | null;
    windowStart: string;
    windowEnd: string;
    allowLive: boolean;
  }) {
    requireNoMissingLiveConfig(input.provider, input.allowLive);
    const startMs = Date.parse(input.windowStart);
    const endMs = Date.parse(input.windowEnd);
    const dayMs = 24 * 3600 * 1000;
    const baseDay = new Date(startMs);
    baseDay.setUTCHours(2, 0, 0, 0);
    if (baseDay.getTime() < startMs) {
      baseDay.setTime(baseDay.getTime() + dayMs);
    }

    const blocks: SyncExternalBusyBlock[] = [];
    if (baseDay.getTime() + 90 * 60_000 <= endMs) {
      blocks.push({
        startAt: baseDay.toISOString(),
        endAt: new Date(baseDay.getTime() + 90 * 60_000).toISOString(),
        timezone: 'Asia/Shanghai',
        status: 'busy',
      });
    }
    const secondStart = baseDay.getTime() + 5 * 3600_000;
    if (secondStart + 60 * 60_000 <= endMs) {
      blocks.push({
        startAt: new Date(secondStart).toISOString(),
        endAt: new Date(secondStart + 60 * 60_000).toISOString(),
        timezone: 'Asia/Shanghai',
        status: 'tentative',
      });
    }

    const prevSeq = input.syncCursor?.startsWith(`mock-cursor:${input.provider}:`)
      ? Number(input.syncCursor.split(':')[2] ?? '0')
      : 0;
    const nextSeq = Number.isFinite(prevSeq) ? prevSeq + 1 : 1;

    return {
      blocks,
      nextCursor: `mock-cursor:${input.provider}:${nextSeq}`,
      providerMode: 'mock' as const,
    };
  }
}
