import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import {
  RelationshipSchema,
  type CloseRelationshipRequest,
  type EstablishRelationshipRequest,
  type Relationship,
  type RelationshipStatus,
} from '@aven/contracts';
import { createApplicationPool, withRequestContext, type DatabasePool } from '@aven/database';
import type { AuthContext } from '../auth/auth.types.js';

type RelationshipRow = {
  id: string;
  referral_id: string;
  applicant_user_id: string;
  applicant_name?: string;
  opportunity_id: string;
  opportunity_title?: string;
  organization_id: string;
  status: RelationshipStatus;
  established_at: Date;
  closed_at: Date | null;
  closed_by: string | null;
  version: number;
  created_at?: Date;
  updated_at?: Date;
};

function mapRelationship(row: RelationshipRow): Relationship {
  return RelationshipSchema.parse({
    id: row.id,
    referralId: row.referral_id,
    applicantUserId: row.applicant_user_id,
    applicantName: row.applicant_name,
    opportunityId: row.opportunity_id,
    opportunityTitle: row.opportunity_title,
    organizationId: row.organization_id,
    status: row.status,
    establishedAt: new Date(row.established_at).toISOString(),
    closedAt: row.closed_at ? new Date(row.closed_at).toISOString() : null,
    closedBy: row.closed_by ?? null,
    version: row.version ?? 1,
    createdAt: row.created_at
      ? new Date(row.created_at).toISOString()
      : new Date(row.established_at).toISOString(),
    updatedAt: row.updated_at
      ? new Date(row.updated_at).toISOString()
      : new Date(row.established_at).toISOString(),
  });
}

@Injectable()
export class RelationshipService implements OnModuleDestroy {
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

  async establish(auth: AuthContext, input: EstablishRelationshipRequest): Promise<Relationship> {
    const relationshipId = await withRequestContext(
      this.getPool(),
      this.context(auth),
      async (client) => {
        const res = await client.query<{ relationship_id?: string; id?: string }>(
          'SELECT * FROM app.establish_relationship($1)',
          [input.referralId],
        );
        const row = res.rows[0];
        if (!row) throw new NotFoundException('Failed to establish relationship.');
        const id = row.relationship_id ?? row.id;
        if (!id) throw new NotFoundException('Failed to establish relationship.');
        return id;
      },
    );
    return this.get(auth, relationshipId);
  }

  async get(auth: AuthContext, relationshipId: string): Promise<Relationship> {
    return withRequestContext(this.getPool(), this.context(auth), async (client) => {
      const res = await client.query<RelationshipRow>('SELECT * FROM app.get_relationship($1)', [
        relationshipId,
      ]);
      const row = res.rows[0];
      if (!row) throw new NotFoundException('Relationship not found.');
      return mapRelationship(row);
    });
  }

  async listMine(auth: AuthContext): Promise<Relationship[]> {
    return withRequestContext(this.getPool(), this.context(auth), async (client) => {
      const res = await client.query<RelationshipRow>('SELECT * FROM app.list_my_relationships()');
      return res.rows.map(mapRelationship);
    });
  }

  async listOrganization(auth: AuthContext, organizationId: string): Promise<Relationship[]> {
    return withRequestContext(this.getPool(), this.context(auth), async (client) => {
      try {
        const res = await client.query<RelationshipRow>(
          'SELECT * FROM app.list_organization_relationships($1)',
          [organizationId],
        );
        return res.rows.map(mapRelationship);
      } catch (err) {
        if (err instanceof Error && 'code' in err && (err as { code: string }).code === '42501') {
          throw new ForbiddenException('Not an organization member.');
        }
        throw err;
      }
    });
  }

  async getSharedContext(
    auth: AuthContext,
    relationshipId: string,
  ): Promise<Record<string, unknown>> {
    return withRequestContext(this.getPool(), this.context(auth), async (client) => {
      const res = await client.query<{ get_relationship_shared_context: Record<string, unknown> }>(
        'SELECT app.get_relationship_shared_context($1)',
        [relationshipId],
      );
      return res.rows[0]?.get_relationship_shared_context ?? {};
    });
  }

  async close(
    auth: AuthContext,
    relationshipId: string,
    input: CloseRelationshipRequest,
  ): Promise<Relationship> {
    await withRequestContext(this.getPool(), this.context(auth), async (client) => {
      await client.query('SELECT app.close_relationship($1, $2)', [
        relationshipId,
        input.reason ?? 'Closed by participant',
      ]);
    });
    return this.get(auth, relationshipId);
  }
}
