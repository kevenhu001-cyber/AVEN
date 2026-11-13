import {
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import type { ApiEnvironment } from '@aven/config/env';
import {
  MeResponseSchema,
  RegisterResponseSchema,
  SessionListResponseSchema,
  type LoginRequest,
  type MeResponse,
  type RegisterRequest,
  type RegisterResponse,
  type SessionListResponse,
} from '@aven/contracts';
import {
  createApplicationPool,
  createPool,
  withRequestContext,
  type DatabasePool,
} from '@aven/database';
import {
  ApiCodeException,
  RateLimitedException,
  ServiceNotReadyException,
} from '../http-errors.js';
import { API_ENVIRONMENT, MAILER } from './auth.constants.js';
import type { AuthContext, LoginResult, RequestContext } from './auth.types.js';
import { hashPassword, verifyDummyPassword, verifyPassword } from './password.js';
import type { Mailer } from './mailer.js';
import { AuthRateLimiter } from './rate-limit.js';
import { hashIp, randomToken, sha256 } from './tokens.js';

type AuthLookupRow = {
  user_id: string;
  password_hash: string;
  principal_status: 'active' | 'suspended' | 'deleted';
  email_verified_at: Date | null;
  display_name: string;
  locale: string;
  timezone: string;
};

type SessionLookupRow = {
  session_id: string;
  user_id: string;
  principal_id: string;
  client: 'web' | 'mobile';
  csrf_token_hash: string | null;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  user_agent: string | null;
};

type SessionRow = {
  id: string;
  client: 'web' | 'mobile';
  user_agent: string | null;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
};

type ProfileRow = {
  display_name: string;
  email_normalized: string;
  email_verified_at: Date | null;
  locale: string;
  timezone: string;
};

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

@Injectable()
export class AuthService implements OnModuleDestroy {
  private authPool: DatabasePool | undefined;
  private appPool: DatabasePool | undefined;

  constructor(
    @Inject(API_ENVIRONMENT) private readonly env: ApiEnvironment,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(AuthRateLimiter) private readonly limiter: AuthRateLimiter,
  ) {}

  private getAuthPool(): DatabasePool {
    this.authPool ??= createPool('aven_auth', { max: 5 });
    return this.authPool;
  }

  private getAppPool(): DatabasePool {
    this.appPool ??= createApplicationPool({ max: 5 });
    return this.appPool;
  }

  private ipHash(context: RequestContext): string {
    return hashIp(context.ip, this.env.AUTH_IP_SALT ?? 'aven-dev-ip-salt-change-me');
  }

  private async limit(
    action: string,
    identifier: string,
    limit: number,
    windowSeconds: number,
  ): Promise<void> {
    let result;
    try {
      result = await this.limiter.consume(action, identifier, limit, windowSeconds);
    } catch {
      throw new ServiceNotReadyException('Authentication rate limiter is unavailable.', true);
    }
    if (!result.allowed) throw new RateLimitedException(result.retryAfter);
  }

  async register(input: RegisterRequest, context: RequestContext): Promise<RegisterResponse> {
    await this.limit('register:ip', this.ipHash(context), 5, 3600);
    await this.limit('register:email', input.email, 3, 3600);
    if (!this.mailer.configured) {
      throw new ServiceNotReadyException('Email delivery is not configured.', true);
    }
    const passwordHash = await hashPassword(input.password);
    const verificationToken = randomToken();
    const verificationExpiresAt = new Date(Date.now() + 24 * 3600 * 1000);
    let userId: string | undefined;
    let displayName = input.displayName;
    let locale = 'zh-CN';
    let timezone = 'Asia/Shanghai';
    try {
      const result = await this.getAuthPool().query<{ user_id: string }>(
        'SELECT app.register_user($1, $2, $3, $4, $5) AS user_id',
        [
          input.email,
          passwordHash,
          input.displayName,
          sha256(verificationToken),
          verificationExpiresAt,
        ],
      );
      userId = result.rows[0]?.user_id;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const lookup = await this.getAuthPool().query<AuthLookupRow>(
        'SELECT * FROM app.auth_lookup($1)',
        [input.email],
      );
      const existing = lookup.rows[0];
      if (!existing) throw error;
      if (
        existing.principal_status !== 'active' ||
        existing.email_verified_at ||
        !(await verifyPassword(existing.password_hash, input.password))
      ) {
        throw new ApiCodeException(
          'ACCOUNT_ALREADY_EXISTS',
          409,
          'Use sign in or password recovery.',
        );
      }
      // Prove password possession before issuing a new verification token.
      await this.getAuthPool().query('SELECT app.create_email_verification_token($1, $2, $3)', [
        existing.user_id,
        sha256(verificationToken),
        verificationExpiresAt,
      ]);
      userId = existing.user_id;
      displayName = existing.display_name;
      locale = existing.locale;
      timezone = existing.timezone;
    }
    if (!userId) throw new Error('REGISTER_FAILED');
    let verificationDelivery: 'sent' | 'failed' = 'sent';
    try {
      await this.mailer.send({
        to: input.email,
        subject: '验证你的 AVEN 邮箱',
        text: `验证令牌：${verificationToken}\n有效期至：${verificationExpiresAt.toISOString()}\n如果这不是你的操作，请忽略此邮件。`,
        kind: 'verify_email',
      });
    } catch {
      verificationDelivery = 'failed';
    }
    return RegisterResponseSchema.parse({
      user: {
        id: userId,
        displayName,
        email: input.email,
        emailVerified: false,
        locale,
        timezone,
      },
      verificationRequired: true,
      verificationDelivery,
    });
  }

  async login(input: LoginRequest, context: RequestContext): Promise<LoginResult> {
    const ipHash = this.ipHash(context);
    await this.limit('login:ip', ipHash, 10, 900);
    await this.limit('login:email', input.email, 5, 900);
    const lookup = await this.getAuthPool().query<AuthLookupRow>(
      'SELECT * FROM app.auth_lookup($1)',
      [input.email],
    );
    const row = lookup.rows[0];
    if (!row) {
      await verifyDummyPassword(input.password);
      throw new UnauthorizedException();
    }
    if (row.principal_status !== 'active') {
      await verifyDummyPassword(input.password);
      throw new UnauthorizedException();
    }
    const valid = await verifyPassword(row.password_hash, input.password);
    if (!valid) throw new UnauthorizedException();

    const sessionToken = randomToken();
    const csrfToken = randomToken();
    const expiresAt = new Date(Date.now() + this.env.AUTH_SESSION_TTL_DAYS * 86400 * 1000);
    const session = await this.getAuthPool().query<{ id: string }>(
      'SELECT app.create_session($1, $2, $3, $4::public.session_client, $5, $6, $7) AS id',
      [
        row.user_id,
        sha256(sessionToken),
        sha256(csrfToken),
        input.client,
        context.userAgent,
        ipHash,
        expiresAt,
      ],
    );
    const sessionId = session.rows[0]?.id;
    if (!sessionId) throw new Error('SESSION_CREATE_FAILED');
    const now = new Date();
    return {
      user: {
        id: row.user_id,
        displayName: row.display_name,
        email: input.email,
        emailVerified: row.email_verified_at !== null,
        locale: row.locale,
        timezone: row.timezone,
      },
      session: {
        id: sessionId,
        client: input.client,
        userAgent: context.userAgent || null,
        createdAt: now.toISOString(),
        lastSeenAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        revokedAt: null,
        current: true,
      },
      sessionToken,
      csrfToken,
    };
  }

  async sessionLookup(tokenHash: string): Promise<AuthContext | null> {
    const result = await this.getAppPool().query<SessionLookupRow>(
      'SELECT * FROM app.session_lookup($1)',
      [tokenHash],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      sessionId: row.session_id,
      userId: row.user_id,
      principalId: row.principal_id,
      client: row.client,
      csrfTokenHash: row.csrf_token_hash,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      expiresAt: row.expires_at,
      userAgent: row.user_agent,
    };
  }

  async me(auth: AuthContext): Promise<MeResponse> {
    const profile = await withRequestContext(
      this.getAppPool(),
      { principalId: auth.principalId, userId: auth.userId },
      async (client) => {
        const result = await client.query<ProfileRow>(
          `SELECT p.display_name, up.email_normalized, up.email_verified_at, u.locale, u.timezone
           FROM public.principals p
           JOIN public.users u ON u.id = p.id
           JOIN public.user_private up ON up.user_id = u.id
           WHERE p.id = $1`,
          [auth.principalId],
        );
        return result.rows[0];
      },
    );
    if (!profile) throw new UnauthorizedException();
    return MeResponseSchema.parse({
      user: {
        id: auth.userId,
        displayName: profile.display_name,
        email: profile.email_normalized,
        emailVerified: profile.email_verified_at !== null,
        locale: profile.locale,
        timezone: profile.timezone,
      },
      session: {
        id: auth.sessionId,
        client: auth.client,
        userAgent: auth.userAgent,
        createdAt: auth.createdAt.toISOString(),
        lastSeenAt: auth.lastSeenAt.toISOString(),
        expiresAt: auth.expiresAt.toISOString(),
        revokedAt: null,
        current: true,
      },
    });
  }

  async listSessions(auth: AuthContext): Promise<SessionListResponse> {
    const result = await this.getAppPool().query<SessionRow>(
      'SELECT * FROM app.list_sessions($1)',
      [auth.userId],
    );
    return SessionListResponseSchema.parse({
      data: result.rows.map((row) => ({
        id: row.id,
        client: row.client,
        userAgent: row.user_agent,
        createdAt: row.created_at.toISOString(),
        lastSeenAt: row.last_seen_at.toISOString(),
        expiresAt: row.expires_at.toISOString(),
        revokedAt: row.revoked_at?.toISOString() ?? null,
        current: row.id === auth.sessionId,
      })),
    });
  }

  async revokeSession(auth: AuthContext, sessionId: string): Promise<void> {
    const result = await this.getAppPool().query<{ ok: boolean }>(
      'SELECT app.revoke_session($1, $2, $3) AS ok',
      [sessionId, auth.userId, 'user_revoked'],
    );
    if (!result.rows[0]?.ok) throw new NotFoundException();
  }

  async logout(auth: AuthContext): Promise<void> {
    await this.getAppPool().query('SELECT app.revoke_session($1, $2, $3)', [
      auth.sessionId,
      auth.userId,
      'logout',
    ]);
  }

  async verifyEmail(token: string, context: RequestContext): Promise<void> {
    await this.limit('verify_email:ip', this.ipHash(context), 10, 3600);
    const result = await this.getAuthPool().query<{ user_id: string | null }>(
      'SELECT app.verify_email($1) AS user_id',
      [sha256(token)],
    );
    if (!result.rows[0]?.user_id) {
      throw new UnprocessableEntityException('Verification token is invalid or expired.');
    }
  }

  async requestPasswordReset(email: string, context: RequestContext): Promise<void> {
    await this.limit('password_reset:ip', this.ipHash(context), 5, 3600);
    await this.limit('password_reset:email', email, 3, 3600);
    if (!this.mailer.configured) {
      throw new ServiceNotReadyException('Email delivery is not configured.', true);
    }
    const token = randomToken();
    const expiresAt = new Date(Date.now() + 3600 * 1000);
    const result = await this.getAuthPool().query<{ user_id: string | null }>(
      'SELECT app.create_password_reset_token($1, $2, $3) AS user_id',
      [email, sha256(token), expiresAt],
    );
    if (!result.rows[0]?.user_id) return;
    try {
      await this.mailer.send({
        to: email,
        subject: '重置你的 AVEN 密码',
        text: `请打开以下链接设置新密码：\n${this.env.WEB_ORIGIN}/#reset_token=${encodeURIComponent(token)}\n\n或在 AVEN 密码恢复页填写重置码：${token}\n有效期至：${expiresAt.toISOString()}\n如果这不是你的操作，请忽略此邮件。`,
        kind: 'reset_password',
      });
    } catch {
      // Do not reveal whether the account exists; delivery failures need monitoring.
    }
  }

  async resetPassword(token: string, newPassword: string, context: RequestContext): Promise<void> {
    await this.limit('password_reset:complete:ip', this.ipHash(context), 5, 3600);
    const passwordHash = await hashPassword(newPassword);
    const result = await this.getAuthPool().query<{ user_id: string | null }>(
      'SELECT app.reset_password($1, $2) AS user_id',
      [sha256(token), passwordHash],
    );
    if (!result.rows[0]?.user_id) {
      throw new UnprocessableEntityException('Reset token is invalid or expired.');
    }
  }

  async changePassword(
    auth: AuthContext,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    await this.limit('password_change:user', auth.userId, 5, 3600);
    const lookup = await this.getAuthPool().query<{ password_hash: string | null }>(
      'SELECT app.password_lookup($1) AS password_hash',
      [auth.userId],
    );
    const currentHash = lookup.rows[0]?.password_hash;
    if (!currentHash || !(await verifyPassword(currentHash, currentPassword))) {
      throw new UnauthorizedException();
    }
    const passwordHash = await hashPassword(newPassword);
    await this.getAuthPool().query('SELECT app.update_password($1, $2)', [
      auth.userId,
      passwordHash,
    ]);
  }

  async onModuleDestroy(): Promise<void> {
    await this.authPool?.end().catch(() => undefined);
    await this.appPool?.end().catch(() => undefined);
    this.limiter.close();
  }
}
