import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import {
  AcceptOrganizationInvitationResponseSchema,
  OrganizationDetailSchema,
  OrganizationInvitationListResponseSchema,
  OrganizationInvitationSchema,
  OrganizationListResponseSchema,
  OrganizationMemberListResponseSchema,
  OrganizationMemberSchema,
  type AcceptOrganizationInvitationResponse,
  type CreateOrganizationRequest,
  type InviteOrganizationMemberRequest,
  type OrganizationDetail,
  type OrganizationInvitation,
  type OrganizationInvitationListResponse,
  type OrganizationListResponse,
  type OrganizationMember,
  type OrganizationMemberListResponse,
} from '@aven/contracts';
import { createApplicationPool, withRequestContext, type DatabasePool } from '@aven/database';
import { MAILER } from '../auth/auth.constants.js';
import type { AuthContext } from '../auth/auth.types.js';
import type { Mailer } from '../auth/mailer.js';
import { randomToken, sha256 } from '../auth/tokens.js';
import { ServiceNotReadyException } from '../http-errors.js';

type SummaryRow = {
  organization_id: string;
  name: string;
  slug: string;
  type: 'lab' | 'research_group' | 'club' | 'department' | 'company' | 'other';
  role: 'owner' | 'admin' | 'member';
  status: 'invited' | 'active' | 'removed' | 'left';
  can_represent: boolean;
  joined_at: Date;
};

type DetailRow = {
  organization_id: string;
  name: string;
  slug: string;
  description: string | null;
  type: 'lab' | 'research_group' | 'club' | 'department' | 'company' | 'other';
  campus_id: string | null;
  verification_status: 'unverified' | 'pending' | 'verified' | 'rejected';
  role: 'owner' | 'admin' | 'member';
  can_represent: boolean;
  member_count: number;
};

type MemberRow = {
  user_id: string;
  display_name: string;
  role: 'owner' | 'admin' | 'member';
  status: 'invited' | 'active' | 'removed' | 'left';
  can_represent: boolean;
  joined_at: Date | null;
};

type InvitationRow = {
  invitation_id: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expires_at: Date;
  created_at: Date;
  accepted_at: Date | null;
};

type AcceptRow = {
  organization_id: string;
  membership_id: string;
  role: 'owner' | 'admin' | 'member';
};

function mapSummary(row: SummaryRow) {
  return {
    id: row.organization_id,
    name: row.name,
    slug: row.slug,
    type: row.type,
    role: row.role,
    status: row.status,
    canRepresent: row.can_represent,
    joinedAt: row.joined_at.toISOString(),
  };
}

function mapDetail(row: DetailRow): OrganizationDetail {
  return OrganizationDetailSchema.parse({
    id: row.organization_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    type: row.type,
    campusId: row.campus_id,
    verificationStatus: row.verification_status,
    role: row.role,
    canRepresent: row.can_represent,
    memberCount: row.member_count,
  });
}

function mapMember(row: MemberRow): OrganizationMember {
  return OrganizationMemberSchema.parse({
    userId: row.user_id,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    canRepresent: row.can_represent,
    joinedAt: row.joined_at?.toISOString() ?? null,
  });
}

function mapInvitation(row: InvitationRow): OrganizationInvitation {
  return OrganizationInvitationSchema.parse({
    id: row.invitation_id,
    email: row.email,
    role: row.role,
    status: row.status,
    expiresAt: row.expires_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    acceptedAt: row.accepted_at?.toISOString() ?? null,
  });
}

@Injectable()
export class OrganizationService implements OnModuleDestroy {
  private pool: DatabasePool | undefined;

  constructor(@Inject(MAILER) private readonly mailer: Mailer) {}

  private getPool(): DatabasePool {
    this.pool ??= createApplicationPool({ max: 5 });
    return this.pool;
  }

  private context(auth: AuthContext) {
    return { principalId: auth.principalId, userId: auth.userId };
  }

  async create(auth: AuthContext, input: CreateOrganizationRequest): Promise<OrganizationDetail> {
    const result = await withRequestContext(this.getPool(), this.context(auth), async (client) =>
      client.query<{ organization_id: string }>(
        `SELECT app.create_organization($1, $2, $3, $4::public.organization_type, $5)
           AS organization_id`,
        [input.name, input.slug, input.description ?? null, input.type, input.campusId ?? null],
      ),
    );
    const organizationId = result.rows[0]?.organization_id;
    if (!organizationId) throw new Error('ORGANIZATION_CREATE_FAILED');
    return this.get(auth, organizationId);
  }

  async list(auth: AuthContext): Promise<OrganizationListResponse> {
    const result = await withRequestContext(this.getPool(), this.context(auth), async (client) =>
      client.query<SummaryRow>('SELECT * FROM app.list_my_organizations()'),
    );
    return OrganizationListResponseSchema.parse({
      data: result.rows.map(mapSummary),
    });
  }

  async get(auth: AuthContext, organizationId: string): Promise<OrganizationDetail> {
    const result = await withRequestContext(this.getPool(), this.context(auth), async (client) =>
      client.query<DetailRow>('SELECT * FROM app.get_organization($1)', [organizationId]),
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException();
    return mapDetail(row);
  }

  async members(
    auth: AuthContext,
    organizationId: string,
  ): Promise<OrganizationMemberListResponse> {
    const result = await withRequestContext(this.getPool(), this.context(auth), async (client) =>
      client.query<MemberRow>('SELECT * FROM app.list_organization_members($1)', [organizationId]),
    );
    return OrganizationMemberListResponseSchema.parse({
      data: result.rows.map(mapMember),
    });
  }

  async invite(
    auth: AuthContext,
    organizationId: string,
    input: InviteOrganizationMemberRequest,
  ): Promise<OrganizationInvitation> {
    if (!this.mailer.configured) {
      throw new ServiceNotReadyException('Email delivery is not configured.', true);
    }
    const token = randomToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    const result = await withRequestContext(this.getPool(), this.context(auth), async (client) =>
      client.query<{ invitation_id: string }>(
        `SELECT app.create_organization_invitation(
             $1, $2, $3::public.organization_role, $4, $5
           ) AS invitation_id`,
        [organizationId, input.email, input.role, sha256(token), expiresAt],
      ),
    );
    const invitationId = result.rows[0]?.invitation_id;
    if (!invitationId) throw new Error('INVITATION_CREATE_FAILED');
    try {
      await this.mailer.send({
        to: input.email,
        subject: '加入 AVEN 组织',
        text: `邀请令牌：${token}\n组织 ID：${organizationId}\n角色：${input.role}\n有效期至：${expiresAt.toISOString()}\n如果这不是你的操作，请忽略此邮件。`,
        kind: 'invite_organization',
      });
    } catch {
      throw new ServiceNotReadyException('Email delivery is not configured.', true);
    }
    return OrganizationInvitationSchema.parse({
      id: invitationId,
      email: input.email,
      role: input.role,
      status: 'pending',
      expiresAt: expiresAt.toISOString(),
      createdAt: new Date().toISOString(),
      acceptedAt: null,
    });
  }

  async invitations(
    auth: AuthContext,
    organizationId: string,
  ): Promise<OrganizationInvitationListResponse> {
    const result = await withRequestContext(this.getPool(), this.context(auth), async (client) =>
      client.query<InvitationRow>('SELECT * FROM app.list_organization_invitations($1)', [
        organizationId,
      ]),
    );
    return OrganizationInvitationListResponseSchema.parse({
      data: result.rows.map(mapInvitation),
    });
  }

  async acceptInvitation(
    auth: AuthContext,
    token: string,
  ): Promise<AcceptOrganizationInvitationResponse> {
    const result = await withRequestContext(this.getPool(), this.context(auth), async (client) =>
      client.query<AcceptRow>('SELECT * FROM app.accept_organization_invitation($1)', [
        sha256(token),
      ]),
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException();
    return AcceptOrganizationInvitationResponseSchema.parse({
      organizationId: row.organization_id,
      membershipId: row.membership_id,
      role: row.role,
    });
  }

  async updateRole(
    auth: AuthContext,
    organizationId: string,
    userId: string,
    role: 'admin' | 'member',
  ): Promise<void> {
    await withRequestContext(this.getPool(), this.context(auth), async (client) =>
      client.query(
        'SELECT app.update_organization_member_role($1, $2, $3::public.organization_role)',
        [organizationId, userId, role],
      ),
    );
  }

  async removeMember(auth: AuthContext, organizationId: string, userId: string): Promise<void> {
    await withRequestContext(this.getPool(), this.context(auth), async (client) =>
      client.query('SELECT app.remove_organization_member($1, $2)', [organizationId, userId]),
    );
  }

  async leave(auth: AuthContext, organizationId: string): Promise<void> {
    await withRequestContext(this.getPool(), this.context(auth), async (client) =>
      client.query('SELECT app.leave_organization($1)', [organizationId]),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end().catch(() => undefined);
  }
}
