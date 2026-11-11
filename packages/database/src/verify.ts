import { Client } from 'pg';
import { databaseUrlFor, migrationDatabaseUrl } from './env.js';
import { seedIds } from './seed-data.js';

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`);
  if (!ok) failed += 1;
}

async function main(): Promise<void> {
  const migrator = new Client({ connectionString: migrationDatabaseUrl() });
  const app = new Client({ connectionString: databaseUrlFor('aven_app') });
  const auth = new Client({ connectionString: databaseUrlFor('aven_auth') });
  await migrator.connect();
  await app.connect();
  await auth.connect();

  async function appQuery(
    sql: string,
    context: { principalId?: string; userId?: string } = {},
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> {
    await app.query('BEGIN');
    try {
      if (context.principalId) {
        await app.query("SELECT set_config('app.principal_id', $1, true)", [context.principalId]);
      }
      if (context.userId) {
        await app.query("SELECT set_config('app.user_id', $1, true)", [context.userId]);
      }
      const result = await app.query(sql);
      await app.query('COMMIT');
      return result;
    } catch (error) {
      await app.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  }

  async function appError(sql: string, context: { principalId?: string; userId?: string } = {}) {
    try {
      await appQuery(sql, context);
      return false;
    } catch {
      return true;
    }
  }

  async function authError(sql: string) {
    try {
      await auth.query(sql);
      return false;
    } catch {
      return true;
    }
  }

  async function scalar(sql: string, context: { principalId?: string; userId?: string } = {}) {
    const result = await appQuery(sql, context);
    return String(result.rows[0]?.value ?? result.rows[0]?.count ?? '');
  }

  try {
    const migrations = await migrator.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM app.schema_migrations',
    );
    check('ten migrations are recorded', migrations.rows[0]?.count === '10');
    const seed = await migrator.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM app.development_seed_runs',
    );
    check('development seed is recorded', seed.rows[0]?.count === '1');

    const tables = await migrator.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname IN (
         'principals','users','user_private','credentials','sessions',
         'email_verification_tokens','password_reset_tokens','campuses',
         'campus_memberships','organizations','organization_memberships',
         'organization_invitations','platform_role_assignments'
       )`,
    );
    check('thirteen D1 tables exist', tables.rows[0]?.count === '13');

    const rls = await migrator.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relrowsecurity AND c.relname IN (
         'principals','users','user_private','credentials','sessions',
         'email_verification_tokens','password_reset_tokens','campuses',
         'campus_memberships','organizations','organization_memberships',
         'organization_invitations','platform_role_assignments'
       )`,
    );
    check('RLS is enabled on all D1 tables', rls.rows[0]?.count === '13');
    const forcedRls = await migrator.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE ((n.nspname = 'public' AND c.relname IN (
         'principals','users','user_private','credentials','sessions',
         'email_verification_tokens','password_reset_tokens','campuses',
         'campus_memberships','organizations','organization_memberships',
         'organization_invitations','platform_role_assignments',
         'outbox_events','job_receipts'
       )) OR (n.nspname = 'app' AND c.relname IN (
         'sample_tasks','sample_task_results','sample_external_effects'
       )))
         AND c.relrowsecurity AND c.relforcerowsecurity`,
    );
    check('all tenant tables force RLS', forcedRls.rows[0]?.count === '18');
    check(
      'app cannot disable row security',
      await appError('SET row_security = off; SELECT count(*) FROM public.principals;'),
    );

    const asyncTables = await migrator.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
         AND c.relname IN ('outbox_events', 'job_receipts')`,
    );
    check('outbox and receipt tables exist', asyncTables.rows[0]?.count === '2');
    const asyncRls = await migrator.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relrowsecurity
         AND c.relname IN ('outbox_events', 'job_receipts')`,
    );
    check('RLS is enabled on async tables', asyncRls.rows[0]?.count === '2');
    check(
      'app cannot read outbox payloads',
      await appError('SELECT payload FROM public.outbox_events'),
    );

    const authFunctions = await migrator.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'app' AND p.proname IN (
         'register_user','auth_lookup','password_lookup','create_session',
         'session_lookup','list_sessions','revoke_session','revoke_all_sessions',
         'verify_email','create_email_verification_token',
         'create_password_reset_token','reset_password','update_password'
       )`,
    );
    check('thirteen authentication functions exist', authFunctions.rows[0]?.count === '13');
    const authFunctionOwners = await migrator.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'app'
         AND p.proname IN (
           'register_user','auth_lookup','password_lookup','create_session',
           'session_lookup','list_sessions','revoke_session','revoke_all_sessions',
           'verify_email','create_email_verification_token',
           'create_password_reset_token','reset_password','update_password'
         )
         AND p.proowner = 'aven_function_owner'::regrole`,
    );
    check(
      'authentication functions are owned by the function owner',
      authFunctionOwners.rows[0]?.count === '13',
    );
    check(
      'app cannot execute the auth lookup',
      await appError("SELECT * FROM app.auth_lookup('nobody@example.test')"),
    );
    check(
      'app cannot execute session creation',
      await appError(
        "SELECT app.create_session('00000000-0000-4000-8000-000000000000', repeat('a', 64), repeat('b', 64), 'web', null, null, now() + interval '1 day')",
      ),
    );
    check(
      'auth pool can execute the auth lookup',
      (await auth.query("SELECT * FROM app.auth_lookup('nobody@example.test')")).rows.length === 0,
    );
    check(
      'auth pool cannot read principals directly',
      await authError('SELECT * FROM public.principals'),
    );
    check(
      'app can execute session lookup',
      (await app.query("SELECT * FROM app.session_lookup(repeat('a', 64))")).rows.length === 0,
    );

    const profileFunctions = await migrator.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'app'
         AND p.proname IN (
           'update_my_profile','list_active_campuses',
           'list_my_campus_memberships','request_campus_membership'
         )
         AND p.proowner = 'aven_function_owner'::regrole`,
    );
    check(
      'four profile/campus functions are owned by the function owner',
      profileFunctions.rows[0]?.count === '4',
    );
    check(
      'app can list active campuses',
      (await app.query('SELECT * FROM app.list_active_campuses()')).rows.length === 1,
    );
    check(
      'app cannot update a profile without context',
      await appError("SELECT app.update_my_profile('probe', null, null)"),
    );
    await app.query('BEGIN');
    try {
      await app.query("SELECT set_config('app.user_id', $1, true)", [seedIds.userOne]);
      await app.query("SELECT set_config('app.principal_id', $1, true)", [seedIds.userOne]);
      const memberships = await app.query('SELECT * FROM app.list_my_campus_memberships()');
      check('user context lists own campus memberships', memberships.rows.length === 1);
      const requested = await app.query(
        `SELECT * FROM app.request_campus_membership('${seedIds.campus}')`,
      );
      check(
        'campus membership request is idempotent for an existing row',
        requested.rows.length === 1 && requested.rows[0]?.status === 'pending',
      );
      await app.query("SELECT app.update_my_profile('验证资料更新', 'zh-CN', 'Asia/Shanghai')");
      const updated = await app.query<{ display_name: string }>(
        `SELECT display_name FROM public.principals WHERE id = '${seedIds.userOne}'`,
      );
      check(
        'profile update changes the display name',
        updated.rows[0]?.display_name === '验证资料更新',
      );
    } finally {
      await app.query('ROLLBACK');
    }

    const organizationFunctions = await migrator.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'app'
         AND p.proname IN (
           'create_organization','list_my_organizations','get_organization',
           'list_organization_members','create_organization_invitation',
           'list_organization_invitations','accept_organization_invitation',
           'update_organization_member_role','remove_organization_member',
           'leave_organization'
         )
         AND p.proowner = 'aven_function_owner'::regrole`,
    );
    check(
      'ten organization functions are owned by the function owner',
      organizationFunctions.rows[0]?.count === '10',
    );
    check(
      'app cannot create an organization without context',
      await appError("SELECT app.create_organization('probe', 'probe-org', null, 'lab', null)"),
    );
    const userOneContext = { principalId: seedIds.userOne, userId: seedIds.userOne };
    const userTwoContext = { principalId: seedIds.userTwo, userId: seedIds.userTwo };
    check(
      'user one lists two organizations',
      (await scalar(
        'SELECT count(*)::text AS value FROM app.list_my_organizations()',
        userOneContext,
      )) === '2',
    );
    check(
      'organization detail reports two active members',
      (await scalar(
        `SELECT member_count::text AS value FROM app.get_organization('${seedIds.organizationOne}')`,
        userOneContext,
      )) === '2',
    );
    check(
      'organization member list is visible to members',
      (await scalar(
        `SELECT count(*)::text AS value FROM app.list_organization_members('${seedIds.organizationOne}')`,
        userOneContext,
      )) === '2',
    );
    check(
      'admin cannot change the owner role',
      await appError(
        `SELECT app.update_organization_member_role('${seedIds.organizationOne}', '${seedIds.userOne}', 'admin')`,
        userTwoContext,
      ),
    );
    check(
      'last owner cannot leave',
      await appError(`SELECT app.leave_organization('${seedIds.organizationOne}')`, userOneContext),
    );
    await app.query('BEGIN');
    try {
      await app.query("SELECT set_config('app.user_id', $1, true)", [seedIds.userOne]);
      await app.query("SELECT set_config('app.principal_id', $1, true)", [seedIds.userOne]);
      const created = await app.query<{ id: string }>(
        "SELECT app.create_organization('验证组织', 'verify-org', null, 'lab', null) AS id",
      );
      const organizationId = created.rows[0]?.id;
      check('organization creation returns an id', Boolean(organizationId));
      const createdMembers = await app.query(
        `SELECT * FROM app.list_organization_members('${organizationId}')`,
      );
      check(
        'creator becomes the sole owner',
        createdMembers.rows.length === 1 && createdMembers.rows[0]?.role === 'owner',
      );
    } finally {
      await app.query('ROLLBACK');
    }

    check('app cannot read credentials', await appError('SELECT * FROM public.credentials'));
    check(
      'app cannot read session token hashes',
      await appError('SELECT token_hash FROM public.sessions'),
    );
    check(
      'app cannot read platform role assignments directly',
      await appError('SELECT * FROM public.platform_role_assignments'),
    );
    check(
      'app cannot insert principals',
      await appError("INSERT INTO public.principals (type, display_name) VALUES ('user', 'probe')"),
    );
    check(
      'app cannot update principals',
      await appError(
        `UPDATE public.principals SET display_name = 'probe' WHERE id = '${seedIds.userOne}'`,
      ),
    );
    check(
      'app cannot delete principals',
      await appError(`DELETE FROM public.principals WHERE id = '${seedIds.userOne}'`),
    );

    check(
      'without context, app sees no user principals',
      (await scalar(
        "SELECT count(*)::text AS value FROM public.principals WHERE type = 'user'",
      )) === '0',
    );
    check(
      'without context, app sees public organization principals',
      (await scalar(
        "SELECT count(*)::text AS value FROM public.principals WHERE type = 'organization'",
      )) === '2',
    );
    check(
      'without context, app sees public organizations',
      (await scalar('SELECT count(*)::text AS value FROM public.organizations')) === '2',
    );
    check(
      'without context, app sees no campuses',
      (await scalar('SELECT count(*)::text AS value FROM public.campuses')) === '0',
    );
    check(
      'without context, app sees no memberships',
      (await scalar('SELECT count(*)::text AS value FROM public.organization_memberships')) === '0',
    );

    const userOne = { principalId: seedIds.userOne, userId: seedIds.userOne };
    const userTwo = { principalId: seedIds.userTwo, userId: seedIds.userTwo };
    check(
      'user one sees own principal',
      (await scalar(
        `SELECT count(*)::text AS value FROM public.principals WHERE id = '${seedIds.userOne}'`,
        userOne,
      )) === '1',
    );
    check(
      'user one does not see user two principal',
      (await scalar(
        `SELECT count(*)::text AS value FROM public.principals WHERE id = '${seedIds.userTwo}'`,
        userOne,
      )) === '0',
    );
    check(
      'user one sees own private email row',
      (await scalar(
        `SELECT count(*)::text AS value FROM public.user_private WHERE user_id = '${seedIds.userOne}'`,
        userOne,
      )) === '1',
    );
    check(
      'user one does not see user two private email',
      (await scalar(
        `SELECT count(*)::text AS value FROM public.user_private WHERE user_id = '${seedIds.userTwo}'`,
        userOne,
      )) === '0',
    );
    check(
      'user one sees the campus',
      (await scalar('SELECT count(*)::text AS value FROM public.campuses', userOne)) === '1',
    );
    check(
      'user one sees all memberships in both organizations',
      (await scalar(
        'SELECT count(*)::text AS value FROM public.organization_memberships',
        userOne,
      )) === '3',
    );
    check(
      'user two sees only the shared organization memberships',
      (await scalar(
        'SELECT count(*)::text AS value FROM public.organization_memberships',
        userTwo,
      )) === '2',
    );
    check(
      'user one is an organization member',
      (await scalar(
        `SELECT app.is_org_member('${seedIds.organizationOne}')::text AS value`,
        userOne,
      )) === 'true',
    );
    check(
      'user two is not a member of organization two',
      (await scalar(
        `SELECT app.is_org_member('${seedIds.organizationTwo}')::text AS value`,
        userTwo,
      )) === 'false',
    );
    check(
      'user two is an organization admin',
      (await scalar(
        `SELECT app.is_org_admin('${seedIds.organizationOne}')::text AS value`,
        userTwo,
      )) === 'true',
    );
    check(
      'user one can represent organization one',
      (await scalar(
        `SELECT app.can_represent('${seedIds.organizationOne}')::text AS value`,
        userOne,
      )) === 'true',
    );
    check(
      'user two cannot represent organization two',
      (await scalar(
        `SELECT app.can_represent('${seedIds.organizationTwo}')::text AS value`,
        userTwo,
      )) === 'false',
    );
    check(
      'seed campus membership is not verified',
      (await scalar(
        `SELECT app.is_verified_campus_member('${seedIds.campus}')::text AS value`,
        userOne,
      )) === 'false',
    );
    check(
      'user one is not a platform admin',
      (await scalar('SELECT app.is_platform_admin()::text AS value', userOne)) === 'false',
    );

    async function constraintFails(sql: string): Promise<boolean> {
      await migrator.query('BEGIN');
      try {
        await migrator.query(sql);
        await migrator.query('ROLLBACK');
        return false;
      } catch {
        await migrator.query('ROLLBACK').catch(() => undefined);
        return true;
      }
    }
    check(
      'empty display names are rejected',
      await constraintFails(
        "INSERT INTO public.principals (type, display_name) VALUES ('user', '   ')",
      ),
    );
    check(
      'duplicate normalized emails are rejected',
      await constraintFails(
        `INSERT INTO public.user_private (user_id, email_normalized) VALUES ('${seedIds.userTwo}', 'dev.user1@example.test')`,
      ),
    );
    check(
      'a second active owner is rejected',
      await constraintFails(
        `INSERT INTO public.organization_memberships (organization_id, user_id, role, status) VALUES ('${seedIds.organizationOne}', '${seedIds.userTwo}', 'owner', 'active')`,
      ),
    );
    check(
      'owner invitations are rejected',
      await constraintFails(
        `INSERT INTO public.organization_invitations (organization_id, email_normalized, role, token_hash, invited_by, expires_at) VALUES ('${seedIds.organizationOne}', 'owner@example.test', 'owner', 'probe-token', '${seedIds.userOne}', now() + interval '1 day')`,
      ),
    );
    check(
      'verified campus memberships require a verification time',
      await constraintFails(
        `INSERT INTO public.campus_memberships (campus_id, user_id, status) VALUES ('${seedIds.campus}', '${seedIds.userTwo}', 'verified')`,
      ),
    );
    check(
      'a user row cannot reference an organization principal',
      await constraintFails(`INSERT INTO public.users (id) VALUES ('${seedIds.organizationOne}')`),
    );

    await migrator.query('BEGIN');
    try {
      await migrator.query(
        `INSERT INTO public.principals (id, type, display_name, created_at, updated_at)
         VALUES ('99999999-9999-4999-8999-999999999999', 'user', 'trigger probe', '2000-01-01', '2000-01-01')`,
      );
      await migrator.query(
        `UPDATE public.principals SET display_name = 'trigger probe 2'
         WHERE id = '99999999-9999-4999-8999-999999999999'`,
      );
      const refreshed = await migrator.query<{ ok: boolean }>(
        `SELECT updated_at > '2000-01-01'::timestamptz AS ok
         FROM public.principals WHERE id = '99999999-9999-4999-8999-999999999999'`,
      );
      check('updated_at is refreshed by the trigger', refreshed.rows[0]?.ok === true);
    } finally {
      await migrator.query('ROLLBACK');
    }
  } finally {
    await auth.end();
    await app.end();
    await migrator.end();
  }

  if (failed) {
    console.error(`\n${failed} database check(s) failed.`);
    process.exitCode = 1;
    return;
  }
  console.log('\nAll database checks passed.');
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Database verification failed.');
  process.exitCode = 1;
});
