import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import {
  OpportunityDetailSchema,
  OpportunityListResponseSchema,
  type CreateOpportunityDraftRequest,
  type OpportunityDetail,
  type OpportunityLifecycleActionRequest,
  type OpportunityListResponse,
  type OpportunityStage,
  type OpportunitySummary,
  type UpdateOpportunityRequest,
} from '@aven/contracts';
import { createApplicationPool, withRequestContext, type DatabasePool } from '@aven/database';
import type { AuthContext } from '../auth/auth.types.js';

type OpportunityDetailRow = {
  id: string;
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  campus_id: string | null;
  title: string;
  summary: string;
  description: string;
  domains: string[];
  requirements: string[];
  stage: OpportunityStage;
  commitment_hours_per_week: number | null;
  location: string | null;
  remote_ok: boolean;
  headcount: number;
  deadline: Date | null;
  status: 'draft' | 'open' | 'paused' | 'closed' | 'expired';
  visibility: 'organization' | 'campus' | 'public';
  version: number;
  created_by: string;
  contact_user_id: string | null;
  published_at: Date | null;
  closed_at: Date | null;
  created_at: Date;
  updated_at: Date;
  is_member: boolean;
};

type OpportunitySummaryRow = {
  id: string;
  organization_id?: string;
  organization_name?: string;
  organization_slug?: string;
  campus_id?: string | null;
  title: string;
  summary: string;
  domains?: string[];
  stage: OpportunityStage;
  status?: 'draft' | 'open' | 'paused' | 'closed' | 'expired';
  visibility: 'organization' | 'campus' | 'public';
  headcount: number;
  commitment_hours_per_week?: number | null;
  location?: string | null;
  remote_ok?: boolean;
  deadline: Date | null;
  published_at: Date | null;
  closed_at?: Date | null;
  created_at?: Date;
  updated_at?: Date;
};

function mapDetail(row: OpportunityDetailRow): OpportunityDetail {
  return OpportunityDetailSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    organizationSlug: row.organization_slug,
    campusId: row.campus_id,
    title: row.title,
    summary: row.summary,
    description: row.description,
    domains: row.domains,
    requirements: row.requirements,
    stage: row.stage,
    commitmentHoursPerWeek: row.commitment_hours_per_week,
    location: row.location,
    remoteOk: row.remote_ok,
    headcount: row.headcount,
    deadline: row.deadline ? row.deadline.toISOString() : null,
    status: row.status,
    visibility: row.visibility,
    version: row.version,
    createdBy: row.created_by,
    contactUserId: row.contact_user_id,
    publishedAt: row.published_at ? row.published_at.toISOString() : null,
    closedAt: row.closed_at ? row.closed_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    isMember: row.is_member,
  });
}

function mapSummary(row: OpportunitySummaryRow): OpportunitySummary {
  return {
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    organizationSlug: row.organization_slug,
    campusId: row.campus_id ?? null,
    title: row.title,
    summary: row.summary,
    domains: row.domains,
    stage: row.stage,
    status: row.status,
    visibility: row.visibility,
    headcount: row.headcount,
    commitmentHoursPerWeek: row.commitment_hours_per_week ?? null,
    location: row.location ?? null,
    remoteOk: row.remote_ok,
    deadline: row.deadline ? row.deadline.toISOString() : null,
    publishedAt: row.published_at ? row.published_at.toISOString() : null,
    closedAt: row.closed_at ? row.closed_at.toISOString() : null,
    createdAt: row.created_at ? row.created_at.toISOString() : undefined,
    updatedAt: row.updated_at ? row.updated_at.toISOString() : undefined,
  };
}

@Injectable()
export class OpportunityService implements OnModuleDestroy {
  private pool: DatabasePool | null = null;

  private getPool(): DatabasePool {
    if (!this.pool) {
      this.pool = createApplicationPool();
    }
    return this.pool;
  }

  private context(auth?: AuthContext) {
    if (!auth) return {};
    return { principalId: auth.principalId, userId: auth.userId };
  }

  async createDraft(
    auth: AuthContext,
    organizationId: string,
    input: CreateOpportunityDraftRequest,
  ): Promise<OpportunityDetail> {
    const result = await withRequestContext(this.getPool(), this.context(auth), async (client) =>
      client.query<{ create_opportunity_draft: string }>(
        `SELECT app.create_opportunity_draft(
          $1, $2, $3, $4, $5, $6, $7::public.opportunity_stage,
          $8, $9, $10, $11, $12, $13::public.opportunity_visibility, $14
        )`,
        [
          organizationId,
          input.title,
          input.summary,
          input.description,
          input.domains,
          input.requirements,
          input.stage,
          input.commitmentHoursPerWeek ?? null,
          input.location ?? null,
          input.remoteOk,
          input.headcount,
          input.deadline ?? null,
          input.visibility,
          input.contactUserId ?? null,
        ],
      ),
    );
    const id = result.rows[0]?.create_opportunity_draft;
    if (!id) throw new NotFoundException('Failed to create opportunity draft.');
    return this.get(auth, id);
  }

  async update(
    auth: AuthContext,
    organizationId: string,
    opportunityId: string,
    input: UpdateOpportunityRequest,
  ): Promise<OpportunityDetail> {
    try {
      await withRequestContext(this.getPool(), this.context(auth), async (client) =>
        client.query(
          `SELECT * FROM app.update_opportunity(
            $1, $2, $3, $4, $5, $6, $7, $8::public.opportunity_stage,
            $9, $10, $11, $12, $13, $14::public.opportunity_visibility, $15
          )`,
          [
            opportunityId,
            input.expectedVersion,
            input.title ?? null,
            input.summary ?? null,
            input.description ?? null,
            input.domains ?? null,
            input.requirements ?? null,
            input.stage ?? null,
            input.commitmentHoursPerWeek ?? null,
            input.location ?? null,
            input.remoteOk ?? null,
            input.headcount ?? null,
            input.deadline ?? null,
            input.visibility ?? null,
            input.contactUserId ?? null,
          ],
        ),
      );
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P0001'
      ) {
        throw new ConflictException('Version conflict.');
      }
      throw error;
    }
    return this.get(auth, opportunityId);
  }

  async publish(
    auth: AuthContext,
    organizationId: string,
    opportunityId: string,
    input: OpportunityLifecycleActionRequest,
  ): Promise<OpportunityDetail> {
    try {
      await withRequestContext(this.getPool(), this.context(auth), async (client) =>
        client.query('SELECT * FROM app.publish_opportunity($1, $2)', [
          opportunityId,
          input.expectedVersion,
        ]),
      );
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P0001'
      ) {
        throw new ConflictException('Version conflict.');
      }
      throw error;
    }
    return this.get(auth, opportunityId);
  }

  async pause(
    auth: AuthContext,
    organizationId: string,
    opportunityId: string,
    input: OpportunityLifecycleActionRequest,
  ): Promise<OpportunityDetail> {
    try {
      await withRequestContext(this.getPool(), this.context(auth), async (client) =>
        client.query('SELECT * FROM app.pause_opportunity($1, $2)', [
          opportunityId,
          input.expectedVersion,
        ]),
      );
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P0001'
      ) {
        throw new ConflictException('Version conflict.');
      }
      throw error;
    }
    return this.get(auth, opportunityId);
  }

  async close(
    auth: AuthContext,
    organizationId: string,
    opportunityId: string,
    input: OpportunityLifecycleActionRequest,
  ): Promise<OpportunityDetail> {
    try {
      await withRequestContext(this.getPool(), this.context(auth), async (client) =>
        client.query('SELECT * FROM app.close_opportunity($1, $2)', [
          opportunityId,
          input.expectedVersion,
        ]),
      );
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P0001'
      ) {
        throw new ConflictException('Version conflict.');
      }
      throw error;
    }
    return this.get(auth, opportunityId);
  }

  async get(auth: AuthContext | undefined, opportunityId: string): Promise<OpportunityDetail> {
    const result = await withRequestContext(this.getPool(), this.context(auth), async (client) =>
      client.query<OpportunityDetailRow>('SELECT * FROM app.get_opportunity($1)', [opportunityId]),
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException('Opportunity not found.');
    return mapDetail(row);
  }

  async listOrganization(
    auth: AuthContext,
    organizationId: string,
  ): Promise<OpportunityListResponse> {
    const result = await withRequestContext(this.getPool(), this.context(auth), async (client) =>
      client.query<OpportunitySummaryRow>('SELECT * FROM app.list_organization_opportunities($1)', [
        organizationId,
      ]),
    );
    return OpportunityListResponseSchema.parse({
      data: result.rows.map(mapSummary),
    });
  }

  async listPublic(
    auth: AuthContext | undefined,
    query: {
      campusId?: string | undefined;
      stage?: OpportunityStage | undefined;
      domain?: string | undefined;
    },
  ): Promise<OpportunityListResponse> {
    const result = await withRequestContext(this.getPool(), this.context(auth), async (client) =>
      client.query<OpportunitySummaryRow>(
        'SELECT * FROM app.list_public_opportunities($1, $2::public.opportunity_stage, $3)',
        [query.campusId ?? null, query.stage ?? null, query.domain ?? null],
      ),
    );
    return OpportunityListResponseSchema.parse({
      data: result.rows.map(mapSummary),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end().catch(() => undefined);
  }
}
