import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import {
  ExtractMemoryResponseSchema,
  MemoryCandidateListResponseSchema,
  MemoryCandidateSchema,
  MemoryDetailSchema,
  MemoryItemSchema,
  MemoryListResponseSchema,
  MemorySourceSchema,
  RequestIdSchema,
  type ConfirmMemoryRequest,
  type ContextUse,
  type CreateMemoryRequest,
  type ExtractMemoryRequest,
  type ExtractMemoryResponse,
  type MemoryCandidate,
  type MemoryCandidateListResponse,
  type MemoryDetail,
  type MemoryItem,
  type MemoryListResponse,
  type MemorySource,
  type RejectMemoryRequest,
  type UpdateMemoryRequest,
} from '@aven/contracts';
import { createApplicationPool, withRequestContext, type DatabasePool } from '@aven/database';
import type { AuthContext } from '../auth/auth.types.js';
import { MEMORY_EXTRACTOR_VERSION, extractMemoryCandidates } from './memory-extractor.js';

type MemoryRow = {
  id: string;
  kind: MemoryItem['kind'];
  title: string;
  content: string;
  structured_value: Record<string, unknown> | null;
  sensitivity: MemoryItem['sensitivity'];
  status: MemoryItem['status'];
  version: number;
  valid_from: Date | null;
  valid_until: Date | null;
  confirmed_at: Date | null;
  created_at: Date;
  updated_at: Date;
  display_audience: MemoryItem['policy']['displayAudience'];
  discoverable: boolean;
  allowed_uses: string[];
  campus_id: string | null;
  policy_version: number;
  source_count: number;
};

type CandidateRow = MemoryRow & {
  source_record_id: string | null;
  source_type: MemorySource['sourceType'] | null;
  source_ref_id: string | null;
  source_version: string | null;
  source_excerpt: string | null;
  source_created_at: Date | null;
};

type SourceRow = {
  id: string;
  source_type: MemorySource['sourceType'];
  source_id: string | null;
  source_version: string | null;
  excerpt: string | null;
  created_at: Date;
};

function mapMemory(row: MemoryRow): MemoryItem {
  return MemoryItemSchema.parse({
    id: row.id,
    kind: row.kind,
    title: row.title,
    content: row.content,
    structuredValue: row.structured_value,
    sensitivity: row.sensitivity,
    status: row.status,
    version: row.version,
    validFrom: row.valid_from?.toISOString() ?? null,
    validUntil: row.valid_until?.toISOString() ?? null,
    confirmedAt: row.confirmed_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    policy: {
      displayAudience: row.display_audience,
      discoverable: row.discoverable,
      allowedUses: row.allowed_uses as MemoryItem['policy']['allowedUses'],
      campusId: row.campus_id,
      version: row.policy_version,
    },
    sourceCount: row.source_count,
  });
}

function mapSource(row: SourceRow): MemorySource {
  return MemorySourceSchema.parse({
    id: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    sourceVersion: row.source_version,
    excerpt: row.excerpt,
    createdAt: row.created_at.toISOString(),
  });
}

function mapCandidate(row: CandidateRow): MemoryCandidate {
  const source =
    row.source_record_id && row.source_type && row.source_created_at
      ? mapSource({
          id: row.source_record_id,
          source_type: row.source_type,
          source_id: row.source_ref_id,
          source_version: row.source_version,
          excerpt: row.source_excerpt,
          created_at: row.source_created_at,
        })
      : null;
  return MemoryCandidateSchema.parse({ ...mapMemory(row), source });
}

function encodeCursor(item: MemoryItem): string {
  return Buffer.from(JSON.stringify({ createdAt: item.createdAt, id: item.id })).toString(
    'base64url',
  );
}

function decodeCursor(value: string): { createdAt: Date; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      createdAt?: unknown;
      id?: unknown;
    };
    const id = RequestIdSchema.safeParse(parsed.id);
    const createdAt = new Date(String(parsed.createdAt));
    if (!id.success || Number.isNaN(createdAt.getTime())) throw new Error('invalid cursor');
    return { createdAt, id: id.data };
  } catch {
    throw new UnprocessableEntityException('Invalid cursor.');
  }
}

@Injectable()
export class MemoryService implements OnModuleDestroy {
  private pool: DatabasePool | undefined;

  private getPool(): DatabasePool {
    this.pool ??= createApplicationPool({ max: 5 });
    return this.pool;
  }

  private context(auth: AuthContext) {
    return { principalId: auth.principalId, userId: auth.userId };
  }

  private validatePolicy(input: {
    displayAudience: MemoryItem['policy']['displayAudience'];
    discoverable: boolean;
    campusId: string | null;
  }): void {
    if (input.displayAudience === 'campus' && !input.campusId) {
      throw new UnprocessableEntityException('Campus audience requires a campus.');
    }
    if (input.displayAudience !== 'campus' && input.campusId) {
      throw new UnprocessableEntityException('Campus id requires campus audience.');
    }
    if (input.discoverable && input.displayAudience === 'owner') {
      throw new UnprocessableEntityException('Owner-only memory cannot be discoverable.');
    }
  }

  async create(auth: AuthContext, input: CreateMemoryRequest): Promise<MemoryDetail> {
    const result = await withRequestContext(this.getPool(), this.context(auth), async (client) =>
      client.query<{ id: string }>(
        `SELECT app.create_memory_item(
             $1::public.memory_kind, $2, $3, $4, $5::public.sensitivity,
             $6::public.display_audience, $7, $8::public.context_use[], $9, $10
           ) AS id`,
        [
          input.kind,
          input.title,
          input.content,
          input.structuredValue ?? null,
          input.sensitivity,
          input.displayAudience,
          input.discoverable,
          input.allowedUses,
          input.campusId ?? null,
          input.validUntil ? new Date(input.validUntil) : null,
        ],
      ),
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error('MEMORY_CREATE_FAILED');
    return this.get(auth, id);
  }

  async get(auth: AuthContext, id: string): Promise<MemoryDetail> {
    const result = await withRequestContext(this.getPool(), this.context(auth), async (client) =>
      client.query<MemoryRow>('SELECT * FROM app.get_memory_item($1)', [id]),
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException();
    const sources = await withRequestContext(this.getPool(), this.context(auth), async (client) =>
      client.query<SourceRow>('SELECT * FROM app.list_memory_sources($1)', [id]),
    );
    return MemoryDetailSchema.parse({
      ...mapMemory(row),
      sources: sources.rows.map(mapSource),
    });
  }

  async list(
    auth: AuthContext,
    options: { limit: number; cursor?: string; kind?: MemoryItem['kind'] },
  ): Promise<MemoryListResponse> {
    const cursor = options.cursor ? decodeCursor(options.cursor) : undefined;
    const result = await withRequestContext(this.getPool(), this.context(auth), async (client) =>
      client.query<MemoryRow>(
        `SELECT * FROM app.list_my_memory_items($1, $2, $3, $4::public.memory_kind)`,
        [options.limit, cursor?.createdAt ?? null, cursor?.id ?? null, options.kind ?? null],
      ),
    );
    const rows = result.rows.slice(0, options.limit);
    const data = rows.map(mapMemory);
    const hasMore = result.rows.length > options.limit;
    return MemoryListResponseSchema.parse({
      data,
      nextCursor: hasMore && data.length ? encodeCursor(data[data.length - 1]!) : null,
    });
  }

  async extract(auth: AuthContext, input: ExtractMemoryRequest): Promise<ExtractMemoryResponse> {
    const drafts = extractMemoryCandidates(input.text);
    const ids = await withRequestContext(this.getPool(), this.context(auth), async (client) => {
      const created: string[] = [];
      for (const draft of drafts) {
        const result = await client.query<{ id: string }>(
          `SELECT app.create_memory_candidate(
               $1::public.memory_kind, $2, $3, null, 'normal'::public.sensitivity,
               $4::public.memory_source_type, $5, $6, $7
             ) AS id`,
          [
            draft.kind,
            draft.title,
            draft.content,
            input.sourceType,
            input.sourceId ?? null,
            input.sourceVersion ?? MEMORY_EXTRACTOR_VERSION,
            draft.excerpt,
          ],
        );
        const id = result.rows[0]?.id;
        if (!id) throw new Error('MEMORY_CANDIDATE_CREATE_FAILED');
        created.push(id);
      }
      return created;
    });
    const data: MemoryCandidate[] = [];
    for (const id of ids) data.push(await this.getCandidate(auth, id));
    return ExtractMemoryResponseSchema.parse({ extractor: MEMORY_EXTRACTOR_VERSION, data });
  }

  async listCandidates(
    auth: AuthContext,
    options: { limit: number; cursor?: string },
  ): Promise<MemoryCandidateListResponse> {
    const cursor = options.cursor ? decodeCursor(options.cursor) : undefined;
    const result = await withRequestContext(this.getPool(), this.context(auth), async (client) =>
      client.query<CandidateRow>(`SELECT * FROM app.list_memory_candidates($1, $2, $3)`, [
        options.limit,
        cursor?.createdAt ?? null,
        cursor?.id ?? null,
      ]),
    );
    const rows = result.rows.slice(0, options.limit);
    const data = rows.map(mapCandidate);
    const hasMore = result.rows.length > options.limit;
    return MemoryCandidateListResponseSchema.parse({
      data,
      nextCursor: hasMore && data.length ? encodeCursor(data[data.length - 1]!) : null,
    });
  }

  private async getCandidate(auth: AuthContext, id: string): Promise<MemoryCandidate> {
    const detail = await this.get(auth, id);
    const { sources, ...item } = detail;
    return MemoryCandidateSchema.parse({ ...item, source: sources[0] ?? null });
  }

  async confirm(auth: AuthContext, id: string, input: ConfirmMemoryRequest): Promise<MemoryDetail> {
    const current = await this.get(auth, id);
    if (current.status !== 'pending_confirmation') {
      throw new ConflictException('Memory is not awaiting confirmation.');
    }
    const displayAudience = input.displayAudience ?? current.policy.displayAudience;
    const discoverable = input.discoverable ?? current.policy.discoverable;
    const allowedUses = input.allowedUses ?? current.policy.allowedUses;
    const campusId = input.campusId === undefined ? current.policy.campusId : input.campusId;
    const validUntil = input.validUntil === undefined ? current.validUntil : input.validUntil;
    const structuredValue =
      input.structuredValue === undefined ? current.structuredValue : input.structuredValue;
    this.validatePolicy({ displayAudience, discoverable, campusId });
    await withRequestContext(this.getPool(), this.context(auth), async (client) =>
      client.query(
        `SELECT app.confirm_memory_item(
             $1, $2, $3::public.memory_kind, $4, $5, $6, $7::public.sensitivity,
             $8::public.display_audience, $9, $10::public.context_use[], $11, $12
           )`,
        [
          id,
          input.expectedVersion,
          input.kind ?? current.kind,
          input.title ?? current.title,
          input.content ?? current.content,
          structuredValue,
          input.sensitivity ?? current.sensitivity,
          displayAudience,
          discoverable,
          allowedUses,
          campusId,
          validUntil ? new Date(validUntil) : null,
        ],
      ),
    );
    return this.get(auth, id);
  }

  async reject(auth: AuthContext, id: string, input: RejectMemoryRequest): Promise<MemoryDetail> {
    const current = await this.get(auth, id);
    if (current.status !== 'pending_confirmation') {
      throw new ConflictException('Memory is not awaiting confirmation.');
    }
    await withRequestContext(this.getPool(), this.context(auth), async (client) =>
      client.query('SELECT app.reject_memory_item($1, $2)', [id, input.expectedVersion]),
    );
    return this.get(auth, id);
  }

  async listUsable(
    auth: AuthContext,
    use: ContextUse,
    options: { limit: number; cursor?: string },
  ): Promise<MemoryListResponse> {
    const cursor = options.cursor ? decodeCursor(options.cursor) : undefined;
    const result = await withRequestContext(this.getPool(), this.context(auth), async (client) =>
      client.query<MemoryRow>(
        `SELECT * FROM app.list_memory_for_use($1::public.context_use, $2, $3, $4)`,
        [use, options.limit, cursor?.createdAt ?? null, cursor?.id ?? null],
      ),
    );
    const rows = result.rows.slice(0, options.limit);
    const data = rows.map(mapMemory);
    const hasMore = result.rows.length > options.limit;
    return MemoryListResponseSchema.parse({
      data,
      nextCursor: hasMore && data.length ? encodeCursor(data[data.length - 1]!) : null,
    });
  }

  async update(auth: AuthContext, id: string, input: UpdateMemoryRequest): Promise<MemoryDetail> {
    const current = await this.get(auth, id);
    if (current.status === 'rejected' || current.status === 'expired') {
      throw new ConflictException('Memory is not editable.');
    }
    const displayAudience = input.displayAudience ?? current.policy.displayAudience;
    const discoverable = input.discoverable ?? current.policy.discoverable;
    const allowedUses = input.allowedUses ?? current.policy.allowedUses;
    const campusId = input.campusId === undefined ? current.policy.campusId : input.campusId;
    const validUntil = input.validUntil === undefined ? current.validUntil : input.validUntil;
    const structuredValue =
      input.structuredValue === undefined ? current.structuredValue : input.structuredValue;
    this.validatePolicy({ displayAudience, discoverable, campusId });
    await withRequestContext(this.getPool(), this.context(auth), async (client) =>
      client.query(
        `SELECT app.update_memory_item(
             $1, $2, $3, $4, $5, $6::public.sensitivity,
             $7::public.display_audience, $8, $9::public.context_use[], $10, $11
           )`,
        [
          id,
          input.expectedVersion,
          input.title ?? current.title,
          input.content ?? current.content,
          structuredValue,
          input.sensitivity ?? current.sensitivity,
          displayAudience,
          discoverable,
          allowedUses,
          campusId,
          validUntil ? new Date(validUntil) : null,
        ],
      ),
    );
    return this.get(auth, id);
  }

  async delete(auth: AuthContext, id: string, expectedVersion: number): Promise<void> {
    await this.get(auth, id);
    await withRequestContext(this.getPool(), this.context(auth), async (client) =>
      client.query('SELECT app.delete_memory_item($1, $2)', [id, expectedVersion]),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end().catch(() => undefined);
  }
}
