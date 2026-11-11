import type { Request } from 'express';

export type AuthContext = {
  sessionId: string;
  userId: string;
  principalId: string;
  client: 'web' | 'mobile';
  csrfTokenHash: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  userAgent: string | null;
};

export type AuthenticatedRequest = Request & { auth?: AuthContext };

export type RequestContext = {
  ip: string;
  userAgent: string;
};

export type LoginResult = {
  user: {
    id: string;
    displayName: string;
    email: string;
    emailVerified: boolean;
    locale: string;
    timezone: string;
  };
  session: {
    id: string;
    client: 'web' | 'mobile';
    userAgent: string | null;
    createdAt: string;
    lastSeenAt: string;
    expiresAt: string;
    revokedAt: string | null;
    current: boolean;
  };
  sessionToken: string;
  csrfToken: string;
};
