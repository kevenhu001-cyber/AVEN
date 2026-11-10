import { Client } from 'pg';
import { migrationDatabaseUrl } from './env.js';
import { seedIds, seedVersion } from './seed-data.js';

async function main(): Promise<void> {
  const client = new Client({ connectionString: migrationDatabaseUrl() });
  await client.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      'SELECT 1 FROM app.development_seed_runs WHERE version = $1',
      [seedVersion],
    );
    if (existing.rows.length > 0) {
      await client.query('COMMIT');
      console.log(`Seed ${seedVersion} is already applied.`);
      return;
    }

    await client.query(
      `INSERT INTO public.principals (id, type, display_name)
       VALUES ($1, 'user', $2), ($3, 'user', $4), ($5, 'organization', $6), ($7, 'organization', $8)
       ON CONFLICT (id) DO NOTHING`,
      [
        seedIds.userOne,
        '开发用户一',
        seedIds.userTwo,
        '开发用户二',
        seedIds.organizationOne,
        '西交大智能系统实验室（开发样例）',
        seedIds.organizationTwo,
        '西交大开放创新社团（开发样例）',
      ],
    );
    await client.query(
      `INSERT INTO public.users (id) VALUES ($1), ($2) ON CONFLICT (id) DO NOTHING`,
      [seedIds.userOne, seedIds.userTwo],
    );
    await client.query(
      `INSERT INTO public.user_private (user_id, email_normalized, email_verified_at)
       VALUES ($1, $2, now()), ($3, $4, now())
       ON CONFLICT (user_id) DO NOTHING`,
      [seedIds.userOne, 'dev.user1@example.test', seedIds.userTwo, 'dev.user2@example.test'],
    );
    await client.query(
      `INSERT INTO public.campuses (id, name, slug, city, country, email_domains)
       VALUES ($1, $2, $3, $4, 'CN', ARRAY['xjtu.edu.cn'])
       ON CONFLICT (id) DO NOTHING`,
      [seedIds.campus, '西安交通大学（开发样例）', 'xjtu-dev', '西安'],
    );
    await client.query(
      `INSERT INTO public.campus_memberships (id, campus_id, user_id, status)
       VALUES ($1, $2, $3, 'pending'), ($4, $2, $5, 'pending')
       ON CONFLICT (id) DO NOTHING`,
      [
        seedIds.campusMembershipOne,
        seedIds.campus,
        seedIds.userOne,
        seedIds.campusMembershipTwo,
        seedIds.userTwo,
      ],
    );
    await client.query(
      `INSERT INTO public.organizations (id, slug, description, type, campus_id)
       VALUES ($1, $2, $3, 'lab', $4), ($5, $6, $7, 'club', $4)
       ON CONFLICT (id) DO NOTHING`,
      [
        seedIds.organizationOne,
        'dev-lab',
        '仅用于开发验证的组织样例，不代表真实实验室或官方认证。',
        seedIds.campus,
        seedIds.organizationTwo,
        'dev-club',
        '仅用于开发验证的社团样例，不代表真实组织或官方认证。',
      ],
    );
    await client.query(
      `INSERT INTO public.organization_memberships
         (id, organization_id, user_id, role, status, can_represent, joined_at)
       VALUES
         ($1, $2, $3, 'owner', 'active', true, now()),
         ($4, $2, $5, 'admin', 'active', true, now()),
         ($6, $7, $3, 'member', 'active', false, now())
       ON CONFLICT (id) DO NOTHING`,
      [
        seedIds.membershipOneOwner,
        seedIds.organizationOne,
        seedIds.userOne,
        seedIds.membershipOneAdmin,
        seedIds.userTwo,
        seedIds.membershipTwoMember,
        seedIds.organizationTwo,
      ],
    );
    await client.query('INSERT INTO app.development_seed_runs (version) VALUES ($1)', [
      seedVersion,
    ]);
    await client.query('COMMIT');

    const counts = await client.query<{
      principals: string;
      users: string;
      organizations: string;
      memberships: string;
    }>(`SELECT
      (SELECT count(*) FROM public.principals) AS principals,
      (SELECT count(*) FROM public.users) AS users,
      (SELECT count(*) FROM public.organizations) AS organizations,
      (SELECT count(*) FROM public.organization_memberships) AS memberships`);
    console.log(`Seed ${seedVersion} applied.`);
    console.log(counts.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Seed failed.');
  process.exitCode = 1;
});
