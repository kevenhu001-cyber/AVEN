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
    check('fourteen migrations are recorded', migrations.rows[0]?.count === '14');
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
         'outbox_events','job_receipts','memory_items','memory_sources',
         'context_field_policies','memory_events'
       )) OR (n.nspname = 'app' AND c.relname IN (
         'sample_tasks','sample_task_results','sample_external_effects'
       )))
         AND c.relrowsecurity AND c.relforcerowsecurity`,
    );
    check('all tenant tables force RLS', forcedRls.rows[0]?.count === '22');
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

    const memoryFunctions = await migrator.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'app'
         AND p.proname IN (
           'create_memory_item','update_memory_item','delete_memory_item',
           'list_my_memory_items','get_memory_item','list_memory_sources',
           'create_memory_candidate','confirm_memory_item','reject_memory_item',
           'list_memory_candidates','list_memory_for_use',
           'audit_memory_item','list_memory_events','expire_due_memories',
           'purge_deleted_memories','purge_memory_events'
         )
         AND p.proowner = 'aven_function_owner'::regrole`,
    );
    check(
      'sixteen memory functions are owned by the function owner',
      memoryFunctions.rows[0]?.count === '16',
    );
    check(
      'app cannot create memory without context',
      await appError(
        "SELECT app.create_memory_item('skill', 'probe', 'probe', null, 'normal', 'owner', false, '{}', null, null)",
      ),
    );
    check(
      'app cannot insert memory directly',
      await appError(
        "INSERT INTO public.memory_items (owner_principal_id, kind, title, content) VALUES ('00000000-0000-4000-8000-000000000000', 'skill', 'probe', 'probe')",
      ),
    );
    await app.query('BEGIN');
    try {
      await app.query("SELECT set_config('app.user_id', $1, true)", [seedIds.userOne]);
      await app.query("SELECT set_config('app.principal_id', $1, true)", [seedIds.userOne]);
      const createdMemory = await app.query<{ id: string }>(
        "SELECT app.create_memory_item('skill', '验证技能', '验证内容', null, 'normal', 'owner', false, ARRAY['self_ai']::public.context_use[], null, null) AS id",
      );
      const memoryId = createdMemory.rows[0]?.id;
      check('memory creation returns an id', Boolean(memoryId));
      const memory = await app.query(`SELECT * FROM app.get_memory_item('${memoryId}')`);
      check(
        'memory detail returns the owner policy and source count',
        memory.rows.length === 1 &&
          Array.isArray(memory.rows[0]?.allowed_uses) &&
          memory.rows[0]?.allowed_uses.includes('self_ai') === true &&
          memory.rows[0]?.source_count === 1,
      );
      const listed = await app.query(
        'SELECT * FROM app.list_my_memory_items(20, null, null, null)',
      );
      check('owner memory list includes the item', listed.rows.length === 1);
      const sources = await app.query(`SELECT * FROM app.list_memory_sources('${memoryId}')`);
      check('memory sources are visible to the owner', sources.rows.length === 1);
      const updatedMemory = await app.query<{ version: number }>(
        `SELECT app.update_memory_item('${memoryId}', 1, '验证技能更新', '验证内容更新', null, 'normal', 'owner', false, ARRAY['self_ai','matching']::public.context_use[], null, null) AS version`,
      );
      check('memory update increments the version', updatedMemory.rows[0]?.version === 2);
      await app.query(`SELECT app.delete_memory_item('${memoryId}', 2)`);
      const deletedMemory = await app.query(`SELECT * FROM app.get_memory_item('${memoryId}')`);
      check('deleted memory is no longer readable', deletedMemory.rows.length === 0);
    } finally {
      await app.query('ROLLBACK');
    }
    await app.query('BEGIN');
    try {
      await app.query("SELECT set_config('app.user_id', $1, true)", [seedIds.userOne]);
      await app.query("SELECT set_config('app.principal_id', $1, true)", [seedIds.userOne]);
      const createdMemory = await app.query<{ id: string }>(
        "SELECT app.create_memory_item('skill', '隔离技能', '隔离内容', null, 'normal', 'owner', false, ARRAY['self_ai']::public.context_use[], null, null) AS id",
      );
      const memoryId = createdMemory.rows[0]?.id;
      await app.query("SELECT set_config('app.user_id', $1, true)", [seedIds.userTwo]);
      await app.query("SELECT set_config('app.principal_id', $1, true)", [seedIds.userTwo]);
      const otherUserMemory = await app.query(`SELECT * FROM app.get_memory_item('${memoryId}')`);
      check('another user cannot read the memory', otherUserMemory.rows.length === 0);
      let updateFailed = false;
      try {
        await app.query(
          `SELECT app.update_memory_item('${memoryId}', 1, 'hijack', 'hijack', null, 'normal', 'owner', false, '{}', null, null)`,
        );
      } catch {
        updateFailed = true;
      }
      check('another user cannot update the memory', updateFailed);
    } finally {
      await app.query('ROLLBACK');
    }

    check(
      'app cannot create a memory candidate without context',
      await appError(
        "SELECT app.create_memory_candidate('skill', 'probe', 'probe', null, 'normal', 'agent_extraction', null, 'probe', 'probe')",
      ),
    );
    await app.query('BEGIN');
    try {
      await app.query("SELECT set_config('app.user_id', $1, true)", [seedIds.userOne]);
      await app.query("SELECT set_config('app.principal_id', $1, true)", [seedIds.userOne]);
      const createdCandidate = await app.query<{ id: string }>(
        "SELECT app.create_memory_candidate('interest', '具身智能', '关注具身智能', null, 'normal', 'conversation', null, 'conversation-v1', '兴趣：具身智能') AS id",
      );
      const candidateId = createdCandidate.rows[0]?.id;
      check('memory candidate creation returns an id', Boolean(candidateId));
      const pendingDetail = await app.query(`SELECT * FROM app.get_memory_item('${candidateId}')`);
      check(
        'memory candidate starts pending with an owner-only empty policy',
        pendingDetail.rows.length === 1 &&
          pendingDetail.rows[0]?.status === 'pending_confirmation' &&
          pendingDetail.rows[0]?.display_audience === 'owner' &&
          pendingDetail.rows[0]?.discoverable === false &&
          Array.isArray(pendingDetail.rows[0]?.allowed_uses) &&
          (pendingDetail.rows[0]?.allowed_uses as unknown[]).length === 0,
      );
      const pendingList = await app.query(
        'SELECT * FROM app.list_my_memory_items(20, null, null, null)',
      );
      check(
        'pending candidates are excluded from the confirmed memory list',
        !pendingList.rows.some((row) => row.id === candidateId),
      );
      const candidateList = await app.query(
        'SELECT * FROM app.list_memory_candidates(20, null, null)',
      );
      check(
        'candidate list returns pending items with provenance',
        candidateList.rows.length === 1 &&
          candidateList.rows[0]?.id === candidateId &&
          candidateList.rows[0]?.source_type === 'conversation' &&
          candidateList.rows[0]?.source_excerpt === '兴趣：具身智能',
      );
      const pendingUsable = await app.query(
        "SELECT * FROM app.list_memory_for_use('self_ai', 20, null, null)",
      );
      check(
        'pending candidates are excluded from the retrieval scope',
        !pendingUsable.rows.some((row) => row.id === candidateId),
      );
      const confirmedCandidate = await app.query<{ version: number }>(
        `SELECT app.confirm_memory_item(
           '${candidateId}', 1, 'interest', '具身智能（已确认）', '关注具身智能与机器人学习',
           null, 'normal', 'owner', false, ARRAY['self_ai']::public.context_use[], null, null
         ) AS version`,
      );
      check(
        'candidate confirmation increments the version',
        confirmedCandidate.rows[0]?.version === 2,
      );
      const confirmedDetail = await app.query(
        `SELECT * FROM app.get_memory_item('${candidateId}')`,
      );
      check(
        'candidate confirmation sets confirmed status and uses',
        confirmedDetail.rows[0]?.status === 'confirmed' &&
          confirmedDetail.rows[0]?.title === '具身智能（已确认）' &&
          (confirmedDetail.rows[0]?.allowed_uses as string[]).includes('self_ai'),
      );
      const usableAfterConfirm = await app.query(
        "SELECT * FROM app.list_memory_for_use('self_ai', 20, null, null)",
      );
      check(
        'confirmed memory with self_ai enters the retrieval scope',
        usableAfterConfirm.rows.some((row) => row.id === candidateId),
      );
      const matchingAfterConfirm = await app.query(
        "SELECT * FROM app.list_memory_for_use('matching', 20, null, null)",
      );
      check(
        'confirmed memory without matching use stays out of matching scope',
        !matchingAfterConfirm.rows.some((row) => row.id === candidateId),
      );
      const rejectedCandidate = await app.query<{ id: string }>(
        "SELECT app.create_memory_candidate('skill', 'ROS 2', 'ROS 2 控制', null, 'normal', 'agent_extraction', null, 'mock_rules_v1', '技能：ROS 2') AS id",
      );
      const rejectedId = rejectedCandidate.rows[0]?.id;
      const rejectedVersion = await app.query<{ version: number }>(
        `SELECT app.reject_memory_item('${rejectedId}', 1) AS version`,
      );
      check('candidate rejection increments the version', rejectedVersion.rows[0]?.version === 2);
      const rejectedDetail = await app.query(`SELECT * FROM app.get_memory_item('${rejectedId}')`);
      check(
        'candidate rejection clears uses and discoverability',
        rejectedDetail.rows[0]?.status === 'rejected' &&
          (rejectedDetail.rows[0]?.allowed_uses as unknown[]).length === 0 &&
          rejectedDetail.rows[0]?.discoverable === false,
      );
      const rejectedUsable = await app.query(
        "SELECT * FROM app.list_memory_for_use('self_ai', 20, null, null)",
      );
      check(
        'rejected candidates stay out of the retrieval scope',
        !rejectedUsable.rows.some((row) => row.id === rejectedId),
      );
      let rejectedUpdateFailed = false;
      await app.query('SAVEPOINT rejected_update');
      try {
        await app.query(
          `SELECT app.update_memory_item('${rejectedId}', 2, 'resurrect', 'resurrect', null, 'normal', 'owner', false, '{}', null, null)`,
        );
      } catch {
        rejectedUpdateFailed = true;
        await app.query('ROLLBACK TO SAVEPOINT rejected_update');
      }
      check('rejected candidates cannot be edited', rejectedUpdateFailed);
      const noUsesCandidate = await app.query<{ id: string }>(
        "SELECT app.create_memory_candidate('preference', '远程协作', '偏好远程协作', null, 'normal', 'agent_extraction', null, 'mock_rules_v1', '偏好：远程协作') AS id",
      );
      const noUsesId = noUsesCandidate.rows[0]?.id;
      await app.query(
        `SELECT app.confirm_memory_item(
           '${noUsesId}', 1, 'preference', '远程协作', '偏好远程协作',
           null, 'normal', 'owner', false, '{}', null, null
         )`,
      );
      const noUsesUsable = await app.query(
        "SELECT * FROM app.list_memory_for_use('self_ai', 20, null, null)",
      );
      check(
        'confirmed memory without uses stays out of the retrieval scope',
        !noUsesUsable.rows.some((row) => row.id === noUsesId),
      );
      await app.query("SELECT set_config('app.user_id', $1, true)", [seedIds.userTwo]);
      await app.query("SELECT set_config('app.principal_id', $1, true)", [seedIds.userTwo]);
      let crossConfirmFailed = false;
      await app.query('SAVEPOINT cross_confirm');
      try {
        await app.query(
          `SELECT app.confirm_memory_item(
             '${noUsesId}', 2, 'preference', 'hijack', 'hijack', null, 'normal',
             'owner', false, ARRAY['self_ai']::public.context_use[], null, null
           )`,
        );
      } catch {
        crossConfirmFailed = true;
        await app.query('ROLLBACK TO SAVEPOINT cross_confirm');
      }
      check('another user cannot confirm a candidate', crossConfirmFailed);
      let crossRejectFailed = false;
      await app.query('SAVEPOINT cross_reject');
      try {
        await app.query(`SELECT app.reject_memory_item('${noUsesId}', 2)`);
      } catch {
        crossRejectFailed = true;
        await app.query('ROLLBACK TO SAVEPOINT cross_reject');
      }
      check('another user cannot reject a candidate', crossRejectFailed);
      const otherCandidateList = await app.query(
        'SELECT * FROM app.list_memory_candidates(20, null, null)',
      );
      check('another user sees no candidates', otherCandidateList.rows.length === 0);
    } finally {
      await app.query('ROLLBACK');
    }

    const memoryEventsTable = await migrator.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'memory_events'
         AND c.relrowsecurity AND c.relforcerowsecurity`,
    );
    check('memory events table exists with forced RLS', memoryEventsTable.rows[0]?.count === '1');
    check(
      'app cannot insert memory events directly',
      await appError(
        `INSERT INTO public.memory_events (memory_item_id, owner_principal_id, event_type, version)
         VALUES ('00000000-0000-4000-8000-000000000000', '${seedIds.userOne}', 'created', 1)`,
      ),
    );
    check(
      'app cannot update memory events',
      await appError("UPDATE public.memory_events SET metadata = '{}'::jsonb"),
    );
    check('app cannot delete memory events', await appError('DELETE FROM public.memory_events'));
    let metadataRejected = false;
    try {
      await migrator.query(
        `INSERT INTO public.memory_events
           (memory_item_id, owner_principal_id, event_type, version, metadata)
         VALUES ('00000000-0000-4000-8000-000000000000', $1, 'created', 1, '{"content":"private"}'::jsonb)`,
        [seedIds.userOne],
      );
    } catch {
      metadataRejected = true;
    }
    check('memory event metadata rejects private content keys', metadataRejected);

    await migrator.query('BEGIN');
    try {
      await migrator.query("SELECT set_config('app.user_id', $1, true)", [seedIds.userOne]);
      await migrator.query("SELECT set_config('app.principal_id', $1, true)", [seedIds.userOne]);
      const lifecycleMemory = await migrator.query<{ id: string }>(
        "SELECT app.create_memory_item('skill', '生命周期技能', '生命周期内容', null, 'normal', 'owner', false, ARRAY['self_ai']::public.context_use[], null, null) AS id",
      );
      const lifecycleId = lifecycleMemory.rows[0]?.id;
      check('lifecycle memory creation returns an id', Boolean(lifecycleId));
      const createdEvents = await migrator.query(
        `SELECT event_type FROM app.list_memory_events('${lifecycleId}', 20, null, null)`,
      );
      check(
        'memory creation records a created event',
        createdEvents.rows.some((row) => row.event_type === 'created'),
      );
      await migrator.query(
        `SELECT app.update_memory_item('${lifecycleId}', 1, '生命周期技能更新', '生命周期内容更新', null, 'normal', 'owner', false, ARRAY['self_ai']::public.context_use[], null, null)`,
      );
      const updatedEvents = await migrator.query(
        `SELECT event_type FROM app.list_memory_events('${lifecycleId}', 20, null, null)`,
      );
      check(
        'memory update records an updated event',
        updatedEvents.rows.some((row) => row.event_type === 'updated'),
      );
      await migrator.query(`SELECT app.delete_memory_item('${lifecycleId}', 2)`);
      const deletedEvents = await migrator.query(
        `SELECT event_type, actor_type, from_status, to_status
         FROM app.list_memory_events('${lifecycleId}', 20, null, null)`,
      );
      check(
        'memory deletion records a user deleted event',
        deletedEvents.rows.some(
          (row) =>
            row.event_type === 'deleted' &&
            row.actor_type === 'user' &&
            row.from_status === 'confirmed' &&
            row.to_status === 'deleted',
        ),
      );

      const expiringMemory = await migrator.query<{ id: string }>(
        "SELECT app.create_memory_item('goal', '到期目标', '到期内容', null, 'normal', 'owner', false, ARRAY['self_ai']::public.context_use[], null, now() + interval '1 second') AS id",
      );
      const expiringId = expiringMemory.rows[0]?.id;
      await migrator.query("SELECT set_config('app.user_id', '', true)");
      await migrator.query("SELECT set_config('app.principal_id', '', true)");
      await migrator.query('SELECT pg_sleep(1.2)');
      const expired = await migrator.query<{ count: number }>(
        'SELECT app.expire_due_memories(100) AS count',
      );
      check('due memories expire', (expired.rows[0]?.count ?? 0) >= 1);
      await migrator.query("SELECT set_config('app.user_id', $1, true)", [seedIds.userOne]);
      await migrator.query("SELECT set_config('app.principal_id', $1, true)", [seedIds.userOne]);
      const expiredDetail = await migrator.query(
        `SELECT status, version FROM app.get_memory_item('${expiringId}')`,
      );
      check(
        'expired memory status and version are updated',
        expiredDetail.rows[0]?.status === 'expired' && expiredDetail.rows[0]?.version === 2,
      );
      const expiredEvents = await migrator.query(
        `SELECT event_type, actor_type, from_status, to_status
         FROM app.list_memory_events('${expiringId}', 20, null, null)`,
      );
      check(
        'expiry records a system event',
        expiredEvents.rows.some(
          (row) =>
            row.event_type === 'expired' &&
            row.actor_type === 'system' &&
            row.from_status === 'confirmed' &&
            row.to_status === 'expired',
        ),
      );
      const expiredUsable = await migrator.query(
        "SELECT * FROM app.list_memory_for_use('self_ai', 20, null, null)",
      );
      check(
        'expired memory is excluded from the retrieval scope',
        !expiredUsable.rows.some((row) => row.id === expiringId),
      );

      await migrator.query("SELECT set_config('app.user_id', '', true)");
      await migrator.query("SELECT set_config('app.principal_id', '', true)");
      const purged = await migrator.query<{ count: number }>(
        'SELECT app.purge_deleted_memories(0) AS count',
      );
      check('deleted memory content is purged', (purged.rows[0]?.count ?? 0) >= 1);
      await migrator.query("SELECT set_config('app.user_id', $1, true)", [seedIds.userOne]);
      await migrator.query("SELECT set_config('app.principal_id', $1, true)", [seedIds.userOne]);
      const purgedMemory = await migrator.query(
        `SELECT * FROM app.get_memory_item('${lifecycleId}')`,
      );
      check('purged memory content is gone', purgedMemory.rows.length === 0);
      const purgedEvents = await migrator.query(
        `SELECT event_type, actor_type, from_status, to_status
         FROM app.list_memory_events('${lifecycleId}', 20, null, null)`,
      );
      check(
        'purge keeps an audit event after content removal',
        purgedEvents.rows.some(
          (row) =>
            row.event_type === 'purged' &&
            row.actor_type === 'system' &&
            row.from_status === 'deleted' &&
            row.to_status === null,
        ),
      );

      await migrator.query(
        "UPDATE public.memory_events SET created_at = now() - interval '400 days' WHERE memory_item_id = $1",
        [lifecycleId],
      );
      const purgedEventsCount = await migrator.query<{ count: number }>(
        'SELECT app.purge_memory_events(365) AS count',
      );
      check(
        'old audit events are purged by retention',
        (purgedEventsCount.rows[0]?.count ?? 0) >= 1,
      );
      const eventsAfterRetention = await migrator.query(
        `SELECT * FROM app.list_memory_events('${lifecycleId}', 20, null, null)`,
      );
      check('audit retention removes old events', eventsAfterRetention.rows.length === 0);
    } finally {
      await migrator.query('ROLLBACK');
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
