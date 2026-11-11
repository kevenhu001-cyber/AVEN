import { Injectable, NotFoundException } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import {
  AvailabilityBlockSchema,
  type AvailabilityBlock,
  type AvailabilityStatus,
  type AvailabilityWindowItem,
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

  async upsertBlock(auth: AuthContext, input: UpsertAvailabilityBlockRequest): Promise<AvailabilityBlock> {
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

  async queryWindow(auth: AuthContext, input: QueryAvailabilityWindowRequest): Promise<AvailabilityWindowItem[]> {
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

  async computeIntersection(auth: AuthContext, input: TimeIntersectionRequest): Promise<TimeSlot[]> {
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
