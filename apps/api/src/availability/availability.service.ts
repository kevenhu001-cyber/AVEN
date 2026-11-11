import { Injectable, NotFoundException } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import {
  AvailabilityBlockSchema,
  AvailabilityShareSchema,
  type AvailabilityBlock,
  type AvailabilityShare,
  type AvailabilityStatus,
  type AvailabilityWindowItem,
  type CreateAvailabilityShareRequest,
  type QueryAvailabilityWindowRequest,
  type TimeIntersectionRequest,
  type TimeSlot,
  type UpsertAvailabilityBlockRequest,
} from '@aven/contracts';
import { createApplicationPool, withRequestContext, type DatabasePool } from '@aven/database';
import { findAvailableTimeSlots } from '@aven/domain';
import type { AuthContext } from '../auth/auth.types.js';

type AvailabilityBlockRow = {
  id: string;
  principal_id: string;
  start_at: Date;
  end_at: Date;
  timezone: string;
  status: AvailabilityStatus;
  source: string;
  version: number;
  created_at: Date;
  updated_at: Date;
};

type AvailabilityWindowRow = {
  principal_id: string;
  start_at: Date;
  end_at: Date;
  status: AvailabilityStatus;
};

function mapBlock(row: AvailabilityBlockRow): AvailabilityBlock {
  return AvailabilityBlockSchema.parse({
    id: row.id,
    principalId: row.principal_id,
    startAt: new Date(row.start_at).toISOString(),
    endAt: new Date(row.end_at).toISOString(),
    timezone: row.timezone,
    status: row.status,
    source: row.source,
    version: row.version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  });
}

@Injectable()
export class AvailabilityService implements OnModuleDestroy {
  private pool: DatabasePool | null = null;

  private getPool(): DatabasePool {
    if (!this.pool) {
      this.pool = createApplicationPool();
    }
    return this.pool;
  }

  private context(auth: AuthContext) {
    return { principalId: auth.principalId, userId: auth.userId };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  async upsertBlock(
    auth: AuthContext,
    input: UpsertAvailabilityBlockRequest,
  ): Promise<AvailabilityBlock> {
    return withRequestContext(this.getPool(), this.context(auth), async (client) => {
      const res = await client.query<AvailabilityBlockRow>(
        'SELECT * FROM app.upsert_availability_block($1, $2, $3, $4::public.availability_status, $5, $6)',
        [
          new Date(input.startAt),
          new Date(input.endAt),
          input.timezone,
          input.status,
          input.source,
          input.blockId ?? null,
        ],
      );
      const row = res.rows[0];
      if (!row) throw new NotFoundException('Failed to upsert availability block.');
      return mapBlock(row);
    });
  }

  async deleteBlock(auth: AuthContext, blockId: string): Promise<boolean> {
    return withRequestContext(this.getPool(), this.context(auth), async (client) => {
      const res = await client.query<{ delete_availability_block: boolean }>(
        'SELECT app.delete_availability_block($1)',
        [blockId],
      );
      return Boolean(res.rows[0]?.delete_availability_block);
    });
  }

  async listMine(auth: AuthContext, startAt: string, endAt: string): Promise<AvailabilityBlock[]> {
    return withRequestContext(this.getPool(), this.context(auth), async (client) => {
      const res = await client.query<AvailabilityBlockRow>(
        'SELECT * FROM app.list_my_availability_blocks($1, $2)',
        [new Date(startAt), new Date(endAt)],
      );
      return res.rows.map(mapBlock);
    });
  }

  async queryWindow(
    auth: AuthContext,
    input: QueryAvailabilityWindowRequest,
  ): Promise<AvailabilityWindowItem[]> {
    return withRequestContext(this.getPool(), this.context(auth), async (client) => {
      const res = await client.query<AvailabilityWindowRow>(
        'SELECT * FROM app.query_availability_window($1::uuid[], $2, $3)',
        [input.principalIds, new Date(input.startAt), new Date(input.endAt)],
      );
      return res.rows.map((r) => ({
        principalId: r.principal_id,
        startAt: new Date(r.start_at).toISOString(),
        endAt: new Date(r.end_at).toISOString(),
        status: r.status,
      }));
    });
  }

  async createShare(
    auth: AuthContext,
    input: CreateAvailabilityShareRequest,
  ): Promise<AvailabilityShare> {
    return withRequestContext(this.getPool(), this.context(auth), async (client) => {
      const res = await client.query<{ create_availability_share: Record<string, unknown> }>(
        'SELECT app.create_availability_share($1, $2) AS create_availability_share',
        [input.granteePrincipalId, new Date(input.expiresAt)],
      );
      const raw = res.rows[0]?.create_availability_share;
      if (!raw) throw new NotFoundException('Failed to create availability share.');
      return AvailabilityShareSchema.parse({
        ...raw,
        expiresAt: new Date(String(raw.expiresAt)).toISOString(),
        createdAt: new Date(String(raw.createdAt)).toISOString(),
        direction: 'granted',
      });
    });
  }

  async listShares(auth: AuthContext): Promise<AvailabilityShare[]> {
    return withRequestContext(this.getPool(), this.context(auth), async (client) => {
      const res = await client.query<{ list_availability_shares: unknown }>(
        'SELECT app.list_availability_shares() AS list_availability_shares',
      );
      const raw = res.rows[0]?.list_availability_shares;
      const items = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
      return items.map((item) =>
        AvailabilityShareSchema.parse({
          ...item,
          expiresAt: new Date(String(item.expiresAt)).toISOString(),
          createdAt: new Date(String(item.createdAt)).toISOString(),
        }),
      );
    });
  }

  async revokeShare(auth: AuthContext, shareId: string): Promise<boolean> {
    return withRequestContext(this.getPool(), this.context(auth), async (client) => {
      const res = await client.query<{ revoke_availability_share: boolean }>(
        'SELECT app.revoke_availability_share($1) AS revoke_availability_share',
        [shareId],
      );
      return Boolean(res.rows[0]?.revoke_availability_share);
    });
  }

  async computeIntersection(
    auth: AuthContext,
    input: TimeIntersectionRequest,
  ): Promise<TimeSlot[]> {
    // 1. Fetch busy intervals of all participants within requested window
    const busyBlocks = await this.queryWindow(auth, {
      principalIds: input.principalIds,
      startAt: input.windowStart,
      endAt: input.windowEnd,
    });

    // 2. Filter to busy/tentative blocks only
    const busyIntervals = busyBlocks
      .filter((b) => b.status === 'busy' || b.status === 'tentative')
      .map((b) => ({
        start: new Date(b.startAt),
        end: new Date(b.endAt),
      }));

    // 3. Solve deterministic availability intersection
    return findAvailableTimeSlots({
      windowStart: new Date(input.windowStart),
      windowEnd: new Date(input.windowEnd),
      durationMinutes: input.durationMinutes,
      busyIntervals,
      workingHoursOnly: input.workingHoursOnly,
    });
  }
}
