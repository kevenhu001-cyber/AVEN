import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import {
  CampusListResponseSchema,
  CampusMembershipListResponseSchema,
  CampusMembershipSchema,
  type CampusListResponse,
  type CampusMembership,
  type CampusMembershipListResponse,
  type MeResponse,
  type UpdateProfileRequest,
} from '@aven/contracts';
import { createApplicationPool, withRequestContext, type DatabasePool } from '@aven/database';
import { AuthService } from '../auth/auth.service.js';
import type { AuthContext } from '../auth/auth.types.js';

type CampusRow = {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  country: string;
};

type MembershipRow = {
  membership_id: string;
  campus_uuid: string;
  campus_name: string;
  status: 'pending' | 'verified' | 'rejected' | 'revoked';
  verification_method: 'email_domain' | 'manual' | 'student_id' | null;
  verified_at: Date | null;
  created_at: Date;
};

function isDatabaseCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

function mapMembership(row: MembershipRow): CampusMembership {
  return CampusMembershipSchema.parse({
    id: row.membership_id,
    campusId: row.campus_uuid,
    campusName: row.campus_name,
    status: row.status,
    verificationMethod: row.verification_method,
    verifiedAt: row.verified_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  });
}

@Injectable()
export class ProfileService implements OnModuleDestroy {
  private pool: DatabasePool | undefined;

  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  private getPool(): DatabasePool {
    this.pool ??= createApplicationPool({ max: 5 });
    return this.pool;
  }

  async updateProfile(auth: AuthContext, input: UpdateProfileRequest): Promise<MeResponse> {
    await withRequestContext(
      this.getPool(),
      { principalId: auth.principalId, userId: auth.userId },
      async (client) => {
        await client.query('SELECT app.update_my_profile($1, $2, $3)', [
          input.displayName ?? null,
          input.locale ?? null,
          input.timezone ?? null,
        ]);
      },
    );
    return this.auth.me(auth);
  }

  async listCampuses(): Promise<CampusListResponse> {
    const result = await this.getPool().query<CampusRow>(
      'SELECT * FROM app.list_active_campuses()',
    );
    return CampusListResponseSchema.parse({
      data: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        city: row.city,
        country: row.country,
      })),
    });
  }

  async listMemberships(auth: AuthContext): Promise<CampusMembershipListResponse> {
    const result = await withRequestContext(
      this.getPool(),
      { principalId: auth.principalId, userId: auth.userId },
      async (client) =>
        client.query<MembershipRow>('SELECT * FROM app.list_my_campus_memberships()'),
    );
    return CampusMembershipListResponseSchema.parse({
      data: result.rows.map(mapMembership),
    });
  }

  async requestMembership(auth: AuthContext, campusId: string): Promise<CampusMembership> {
    try {
      const result = await withRequestContext(
        this.getPool(),
        { principalId: auth.principalId, userId: auth.userId },
        async (client) =>
          client.query<MembershipRow>('SELECT * FROM app.request_campus_membership($1)', [
            campusId,
          ]),
      );
      const row = result.rows[0];
      if (!row) throw new NotFoundException();
      return mapMembership(row);
    } catch (error) {
      if (isDatabaseCode(error, '22023')) {
        throw new UnprocessableEntityException('Campus is not available.');
      }
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end().catch(() => undefined);
  }
}
