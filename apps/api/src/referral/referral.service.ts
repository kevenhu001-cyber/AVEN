import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import {
  ConsentPreviewSchema,
  ReferralDecisionSchema,
  ReferralSchema,
  type ConsentPreview,
  type CreateConsentPreviewRequest,
  type CreateReferralRequest,
  type Referral,
  type ReferralDecision,
  type ReferralDecisionRequest,
  type ReferralDecisionType,
  type ReferralSide,
  type ReferralStatus,
  type WithdrawReferralRequest,
} from '@aven/contracts';
import { createApplicationPool, withRequestContext, type DatabasePool } from '@aven/database';
import type { AuthContext } from '../auth/auth.types.js';

type ConsentPreviewRow = {
  preview_id: string;
  opportunity_id: string;
  recipient_organization_id: string;
  recipient_organization_name: string;
  purpose_scopes: Record<string, unknown>;
  preview_data: Record<string, unknown>;
  expires_at: Date;
};

type ReferralRow = {
  id: string;
  applicant_user_id: string;
  applicant_name?: string;
  intent_id?: string;
  opportunity_id: string;
  opportunity_title?: string;
  organization_id: string;
  organization_name?: string;
  candidate_id?: string | null;
  status: ReferralStatus;
  applicant_decision?: ReferralDecisionType;
  org_decision?: ReferralDecisionType;
  org_decision_reason?: string | null;
  content_version?: number;
  version: number;
  sent_at?: Date;
  expires_at: Date;
  created_at?: Date;
  updated_at?: Date;
};

type DecisionRow = {
  id: string;
  referral_id: string;
  side: ReferralSide;
  decision: ReferralDecisionType;
  reason: string | null;
  decided_at: Date | null;
  version: number;
};

function mapPreview(row: ConsentPreviewRow): ConsentPreview {
  return ConsentPreviewSchema.parse({
    previewId: row.preview_id,
    opportunityId: row.opportunity_id,
    recipientOrganizationId: row.recipient_organization_id,
    recipientOrganizationName: row.recipient_organization_name,
    purposeScopes: row.purpose_scopes ?? {},
    previewData: row.preview_data ?? {},
    expiresAt: new Date(row.expires_at).toISOString(),
  });
}

function mapDecision(row: DecisionRow): ReferralDecision {
  return ReferralDecisionSchema.parse({
    id: row.id,
    referralId: row.referral_id,
    side: row.side,
    decision: row.decision,
    reason: row.reason,
    decidedAt: row.decided_at ? new Date(row.decided_at).toISOString() : null,
    version: row.version,
  });
}

function mapReferral(row: ReferralRow, decisions?: ReferralDecision[]): Referral {
  return ReferralSchema.parse({
    id: row.id,
    applicantUserId: row.applicant_user_id,
    applicantName: row.applicant_name,
    intentId: row.intent_id,
    opportunityId: row.opportunity_id,
    opportunityTitle: row.opportunity_title,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    candidateId: row.candidate_id ?? null,
    status: row.status,
    contentVersion: row.content_version ?? row.version ?? 1,
    decisions: decisions ?? [],
    applicantDecision: row.applicant_decision,
    orgDecision: row.org_decision,
    orgDecisionReason: row.org_decision_reason ?? null,
    sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : undefined,
    expiresAt: new Date(row.expires_at).toISOString(),
    createdAt: row.created_at
      ? new Date(row.created_at).toISOString()
      : row.sent_at
        ? new Date(row.sent_at).toISOString()
        : undefined,
    updatedAt: row.updated_at
      ? new Date(row.updated_at).toISOString()
      : row.sent_at
        ? new Date(row.sent_at).toISOString()
        : undefined,
  });
}

@Injectable()
export class ReferralService implements OnModuleDestroy {
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

  async createPreview(
    auth: AuthContext,
    input: CreateConsentPreviewRequest,
  ): Promise<ConsentPreview> {
    return withRequestContext(this.getPool(), this.context(auth), async (client) => {
      const res = await client.query<ConsentPreviewRow>(
        'SELECT * FROM app.create_consent_preview($1, $2, $3::jsonb)',
        [input.opportunityId, input.intentId ?? null, JSON.stringify(input.purposeScopes)],
      );
      const row = res.rows[0];
      if (!row) throw new NotFoundException('Failed to create consent preview.');
      return mapPreview(row);
    });
  }

  async createReferral(auth: AuthContext, input: CreateReferralRequest): Promise<Referral> {
    const refId = await withRequestContext(this.getPool(), this.context(auth), async (client) => {
      try {
        const res = await client.query<{ referral_id: string }>(
          'SELECT referral_id FROM app.create_referral_with_consent($1, $2)',
          [input.previewId, input.candidateId ?? null],
        );
        const id = res.rows[0]?.referral_id;
        if (!id) throw new NotFoundException('Failed to create referral.');
        return id;
      } catch (err) {
        console.error('CREATE REFERRAL ERROR:', err);
        throw err;
      }
    });
    return this.get(auth, refId);
  }

  async get(auth: AuthContext, referralId: string): Promise<Referral> {
    return withRequestContext(this.getPool(), this.context(auth), async (client) => {
      try {
        const res = await client.query<ReferralRow>('SELECT * FROM app.get_referral($1)', [
          referralId,
        ]);
        const row = res.rows[0];
        if (!row) throw new NotFoundException('Referral not found.');

        // Fetch decisions
        const decRes = await client.query<DecisionRow>(
          'SELECT * FROM public.referral_decisions WHERE referral_id = $1 ORDER BY created_at ASC',
          [referralId],
        );
        const decisions = decRes.rows.map(mapDecision);

        return mapReferral(row, decisions);
      } catch (err) {
        console.error('GET REFERRAL ERROR:', err);
        throw err;
      }
    });
  }

  async listMine(auth: AuthContext): Promise<Referral[]> {
    return withRequestContext(this.getPool(), this.context(auth), async (client) => {
      const res = await client.query<ReferralRow>('SELECT * FROM app.list_my_referrals()');
      return res.rows.map((r) =>
        mapReferral({ ...r, applicant_user_id: r.applicant_user_id ?? auth.userId }),
      );
    });
  }

  async listOrganization(auth: AuthContext, organizationId: string): Promise<Referral[]> {
    return withRequestContext(this.getPool(), this.context(auth), async (client) => {
      try {
        const res = await client.query<ReferralRow>(
          'SELECT * FROM app.list_organization_referrals($1)',
          [organizationId],
        );
        return res.rows.map((r) =>
          mapReferral({ ...r, organization_id: r.organization_id ?? organizationId }),
        );
      } catch (err) {
        if (err instanceof Error && 'code' in err && (err as { code: string }).code === '42501') {
          throw new ForbiddenException('Not an organization member.');
        }
        throw err;
      }
    });
  }

  async getSharedSnapshot(auth: AuthContext, referralId: string): Promise<Record<string, unknown>> {
    return withRequestContext(this.getPool(), this.context(auth), async (client) => {
      const res = await client.query<{ get_referral_shared_snapshot: Record<string, unknown> }>(
        'SELECT app.get_referral_shared_snapshot($1)',
        [referralId],
      );
      return res.rows[0]?.get_referral_shared_snapshot ?? {};
    });
  }

  async decide(
    auth: AuthContext,
    referralId: string,
    input: ReferralDecisionRequest,
  ): Promise<Referral> {
    await withRequestContext(this.getPool(), this.context(auth), async (client) => {
      try {
        await client.query(
          'SELECT * FROM app.decide_referral($1, $2::public.referral_decision_type, $3, $4)',
          [referralId, input.decision, input.reason ?? null, input.expectedVersion ?? 1],
        );
      } catch (err) {
        if (err instanceof Error && 'code' in err && (err as { code: string }).code === '40001') {
          throw new ConflictException('Referral version conflict.');
        }
        throw err;
      }
    });
    return this.get(auth, referralId);
  }

  async withdraw(
    auth: AuthContext,
    referralId: string,
    input: WithdrawReferralRequest,
  ): Promise<Referral> {
    await withRequestContext(this.getPool(), this.context(auth), async (client) => {
      await client.query('SELECT * FROM app.withdraw_referral($1, $2)', [
        referralId,
        input.reason ?? 'Withdrawn by applicant',
      ]);
    });
    return this.get(auth, referralId);
  }

  async revokeConsent(auth: AuthContext, grantId: string, reason?: string): Promise<boolean> {
    return withRequestContext(this.getPool(), this.context(auth), async (client) => {
      const res = await client.query<{ revoke_consent: boolean }>(
        'SELECT app.revoke_consent($1, $2)',
        [grantId, reason ?? 'User requested revocation'],
      );
      return Boolean(res.rows[0]?.revoke_consent);
    });
  }
}
