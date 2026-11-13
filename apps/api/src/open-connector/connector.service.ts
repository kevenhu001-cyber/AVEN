import { createDecipheriv } from 'node:crypto';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ProjectConnector } from '@oomol-lab/connector';
import { z } from 'zod';
import { createApplicationPool, withRequestContext, type DatabasePool } from '@aven/database';
import type { AuthContext } from '../auth/auth.types.js';
import { ServiceNotReadyException } from '../http-errors.js';
import { approvedProviderUrl } from '../ai-provider/provider-security.js';

export const ConnectorServiceSchema = z.enum([
  'gmail',
  'googledrive',
  'github',
  'googlecalendar',
  'outlook',
]);
export const GatewayRequestSchema = z.object({
  id: z.string().min(1).max(256),
  externalUserId: z.string(),
  service: z.string(),
  status: z
    .enum(['initiated', 'pending', 'connected', 'failed', 'expired', 'cancelled'])
    .transform((value) => (value === 'initiated' ? 'pending' : value)),
  authorizationUrl: z.url(),
  expiresAt: z.iso.datetime(),
  connectedAccountId: z.string().nullable(),
});
@Injectable()
export class OpenConnectorService implements OnModuleDestroy {
  private pool: DatabasePool | undefined;
  async onModuleDestroy() {
    await this.pool?.end();
  }
  private context<T>(auth: AuthContext, run: Parameters<typeof withRequestContext<T>>[2]) {
    return withRequestContext(
      (this.pool ??= createApplicationPool()),
      { userId: auth.userId, principalId: auth.principalId },
      run,
    );
  }
  private async gateway(auth: AuthContext) {
    const config = await this.context(auth, async (client) => {
      const result = await client.query<{ base_url: string; encrypted_key: string }>(
        'SELECT * FROM app.get_open_connector_runtime()',
      );
      return result.rows[0];
    });
    if (!config) {
      const apiKey = process.env.OOMOL_PROJECT_API_KEY?.trim();
      if (!apiKey) throw new ServiceNotReadyException();
      return new ProjectConnector({
        apiKey,
        baseUrl: 'https://connector.oomol.com/v1',
        timeoutMs: 12000,
        maxRetries: 0,
      });
    }
    if (!process.env.AI_USER_CONFIG_KEY) throw new ServiceNotReadyException();
    // Pin outbound calls to the official gateway; no administrator-controlled SSRF target.
    const baseUrl = approvedProviderUrl(config.base_url, 'https://connector.oomol.com/v1');
    const [version, iv, tag, data] = config.encrypted_key.split('.');
    if (version !== 'v1' || !iv || !tag || !data) throw new ServiceNotReadyException();
    const decipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(process.env.AI_USER_CONFIG_KEY, 'base64'),
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAAD(Buffer.from('aven:user-ai-provider:v1:platform:open_connector'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const apiKey = Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    return new ProjectConnector({ apiKey, baseUrl, timeoutMs: 12000, maxRetries: 0 });
  }
  async list(auth: AuthContext) {
    return this.context(
      auth,
      async (client) =>
        (
          await client.query(
            'SELECT service,status,expires_at,updated_at FROM public.open_connector_connections WHERE user_id=$1',
            [auth.userId],
          )
        ).rows,
    );
  }
  async connect(auth: AuthContext, service: string) {
    const hosts = (process.env.OPEN_CONNECTOR_AUTH_HOSTS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!hosts.length) throw new ServiceNotReadyException();
    const gateway = await this.gateway(auth);
    const origin = new URL(process.env.WEB_ORIGIN ?? 'http://localhost:3000');
    let request: z.infer<typeof GatewayRequestSchema>;
    try {
      request = GatewayRequestSchema.parse(
        await gateway.connect.oauth(auth.userId, {
          service,
          connectionName: 'aven',
          returnUri: new URL('/connectors', origin).href,
        }),
      );
    } catch {
      // Gateway unreachable, rejected, or returned an unexpected shape: never fake success.
      throw new ServiceNotReadyException();
    }
    if (request.externalUserId !== auth.userId || request.service !== service)
      throw new ServiceNotReadyException();
    const url = new URL(request.authorizationUrl);
    if (url.protocol !== 'https:' || url.username || url.password || !hosts.includes(url.hostname))
      throw new ServiceNotReadyException();
    await this.context(auth, (client) =>
      client.query(
        `INSERT INTO public.open_connector_connections(user_id,service,request_id,status,expires_at)
      VALUES($1,$2,$3,'pending',$4) ON CONFLICT(user_id,service) DO UPDATE SET request_id=$3,status='pending',connected_account_id=NULL,expires_at=$4,updated_at=now()`,
        [auth.userId, service, request.id, request.expiresAt],
      ),
    );
    return { authorizationUrl: request.authorizationUrl, expiresAt: request.expiresAt };
  }
  async refresh(auth: AuthContext, service: string) {
    const row = await this.context(
      auth,
      async (client) =>
        (
          await client.query<{ request_id: string }>(
            'SELECT request_id FROM public.open_connector_connections WHERE user_id=$1 AND service=$2',
            [auth.userId, service],
          )
        ).rows[0],
    );
    if (!row) return { status: 'disconnected' };
    const gateway = await this.gateway(auth);
    let request: z.infer<typeof GatewayRequestSchema>;
    try {
      request = GatewayRequestSchema.parse(await gateway.getConnectionRequest(row.request_id));
    } catch {
      throw new ServiceNotReadyException();
    }
    if (
      request.id !== row.request_id ||
      request.externalUserId !== auth.userId ||
      request.service !== service
    )
      throw new ServiceNotReadyException();
    await this.context(auth, (client) =>
      client.query(
        `UPDATE public.open_connector_connections SET status=$3,connected_account_id=$4,updated_at=now()
      WHERE user_id=$1 AND service=$2 AND request_id=$5`,
        [auth.userId, service, request.status, request.connectedAccountId, row.request_id],
      ),
    );
    return { status: request.status };
  }
  async disconnect(auth: AuthContext, service: string) {
    await this.context(auth, (client) =>
      client.query(
        'DELETE FROM public.open_connector_connections WHERE user_id=$1 AND service=$2',
        [auth.userId, service],
      ),
    );
    return { status: 'disconnected' };
  }
}
