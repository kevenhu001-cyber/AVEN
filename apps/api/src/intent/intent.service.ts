import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import {
  IntentSchema,
  MatchCandidateSchema,
  type CreateIntentRequest,
  type GenerateMatchesRequest,
  type Intent,
  type MatchCandidate,
  type OpportunityStage,
  type SetIntentStatusRequest,
  type UpdateIntentRequest,
} from '@aven/contracts';
import { createApplicationPool, withRequestContext, type DatabasePool } from '@aven/database';
import type { AuthContext } from '../auth/auth.types.js';

type IntentRow = {
  id: string;
  owner_principal_id: string;
  title: string;
  description: string;
  domains: string[];
  desired_stages: OpportunityStage[];
  location_preference: string | null;
  remote_ok: boolean;
  commitment_hours_per_week: number | null;
  deadline: Date | null;
  status: 'draft' | 'active' | 'paused' | 'closed';
  version: number;
  created_at: Date;
  updated_at: Date;
};

type MatchCandidateRow = {
  candidate_id?: string;
  id?: string;
  intent_id: string;
  opportunity_id: string;
  opportunity_title?: string;
  organization_id?: string;
  organization_name?: string;
  algorithm_version: string;
  score: string | number | null;
  feature_scores: Record<string, unknown>;
  reasons: string[];
  evidence: Record<string, unknown>[];
  status: 'active' | 'stale' | 'dismissed';
  computed_at: Date;
  expires_at: Date | null;
};

function parseArrayField<T extends string>(val: unknown): T[] {
  if (Array.isArray(val)) return val as T[];
  if (typeof val === 'string') {
    const trimmed = val.replace(/^\{|\}$/g, '').trim();
    if (!trimmed) return [];
    return trimmed.split(',').map((s) => s.trim()) as T[];
  }
  return [];
}

function mapIntent(row: IntentRow): Intent {
  return IntentSchema.parse({
    id: row.id,
    ownerPrincipalId: row.owner_principal_id,
    title: row.title,
    description: row.description,
    domains: parseArrayField<string>(row.domains),
    desiredStages: parseArrayField<OpportunityStage>(row.desired_stages),
    locationPreference: row.location_preference ?? null,
    remoteOk: row.remote_ok ?? false,
    commitmentHoursPerWeek: row.commitment_hours_per_week ?? null,
    deadline: row.deadline ? new Date(row.deadline).toISOString() : null,
    status: row.status,
    version: row.version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  });
}

function mapCandidate(row: MatchCandidateRow): MatchCandidate {
  return MatchCandidateSchema.parse({
    id: row.candidate_id ?? row.id,
    intentId: row.intent_id,
    opportunityId: row.opportunity_id,
    opportunityTitle: row.opportunity_title,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    algorithmVersion: row.algorithm_version,
    score: row.score !== null ? Number(row.score) : null,
    featureScores: row.feature_scores ?? {},
    reasons: row.reasons ?? [],
    evidence: row.evidence ?? [],
    status: row.status,
    computedAt: new Date(row.computed_at).toISOString(),
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
  });
}

@Injectable()
export class IntentService implements OnModuleDestroy {
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

  async create(auth: AuthContext, input: CreateIntentRequest): Promise<Intent> {
    return withRequestContext(this.getPool(), this.context(auth), async (client) => {
      try {
        const res = await client.query<IntentRow>(
          `SELECT * FROM app.create_intent(
            $1, $2, $3::text[], $4::public.opportunity_stage[], $5, $6, $7, $8
          )`,
          [
            input.title,
            input.description,
            input.domains ?? [],
            input.desiredStages ?? [],
            input.locationPreference ?? null,
            input.remoteOk ?? false,
            input.commitmentHoursPerWeek ?? null,
            input.deadline ? new Date(input.deadline) : null,
          ],
        );
        const row = res.rows[0];
        if (!row) throw new NotFoundException('Failed to create intent.');
        return mapIntent(row);
      } catch (err) {
        console.error('CREATE INTENT ERROR:', err);
        throw err;
      }
    });
  }

  async get(auth: AuthContext, intentId: string): Promise<Intent> {
    return withRequestContext(this.getPool(), this.context(auth), async (client) => {
      const res = await client.query<IntentRow>(
        'SELECT * FROM app.get_intent($1)',
        [intentId],
      );
      const row = res.rows[0];
      if (!row) throw new NotFoundException('Intent not found.');
      return mapIntent(row);
    });
  }

  async listMine(auth: AuthContext): Promise<Intent[]> {
    return withRequestContext(this.getPool(), this.context(auth), async (client) => {
      const res = await client.query<IntentRow>(
        'SELECT * FROM app.list_my_intents()',
      );
      return res.rows.map(mapIntent);
    });
  }

  async update(auth: AuthContext, intentId: string, input: UpdateIntentRequest): Promise<Intent> {
    return withRequestContext(this.getPool(), this.context(auth), async (client) => {
      try {
        const res = await client.query<IntentRow>(
          `SELECT * FROM app.update_intent(
            $1, $2, $3, $4::text[], $5::public.opportunity_stage[], $6, $7, $8, $9, $10
          )`,
          [
            intentId,
            input.title ?? null,
            input.description ?? null,
            input.domains ?? null,
            input.desiredStages ?? null,
            input.locationPreference ?? null,
            input.remoteOk ?? null,
            input.commitmentHoursPerWeek ?? null,
            input.deadline ? new Date(input.deadline) : null,
            input.expectedVersion,
          ],
        );
        const row = res.rows[0];
        if (!row) throw new NotFoundException('Intent not found.');
        return mapIntent(row);
      } catch (err) {
        if (err instanceof Error && 'code' in err && (err as { code: string }).code === '40001') {
          throw new ConflictException('Intent version conflict.');
        }
        throw err;
      }
    });
  }

  async setStatus(auth: AuthContext, intentId: string, input: SetIntentStatusRequest): Promise<Intent> {
    return withRequestContext(this.getPool(), this.context(auth), async (client) => {
      try {
        const res = await client.query<IntentRow>(
          'SELECT * FROM app.set_intent_status($1, $2::public.intent_status, $3)',
          [intentId, input.status, input.expectedVersion],
        );
        const row = res.rows[0];
        if (!row) throw new NotFoundException('Intent not found.');
        return mapIntent(row);
      } catch (err) {
        if (err instanceof Error && 'code' in err && (err as { code: string }).code === '40001') {
          throw new ConflictException('Intent version conflict.');
        }
        throw err;
      }
    });
  }

  async generateMatches(auth: AuthContext, intentId: string, input: GenerateMatchesRequest): Promise<number> {
    return withRequestContext(this.getPool(), this.context(auth), async (client) => {
      const res = await client.query<{ generate_match_candidates: number }>(
        'SELECT app.generate_match_candidates($1, $2)',
        [intentId, input.algorithmVersion ?? 'v1'],
      );
      return Number(res.rows[0]?.generate_match_candidates ?? 0);
    });
  }

  async listMatches(auth: AuthContext, intentId: string): Promise<MatchCandidate[]> {
    return withRequestContext(this.getPool(), this.context(auth), async (client) => {
      const res = await client.query<MatchCandidateRow>(
        'SELECT * FROM app.list_candidates_for_intent($1)',
        [intentId],
      );
      return res.rows.map(mapCandidate);
    });
  }

  async dismissMatch(auth: AuthContext, candidateId: string): Promise<boolean> {
    return withRequestContext(this.getPool(), this.context(auth), async (client) => {
      const res = await client.query<{ dismiss_candidate: boolean }>(
        'SELECT app.dismiss_candidate($1)',
        [candidateId],
      );
      return Boolean(res.rows[0]?.dismiss_candidate);
    });
  }
}
