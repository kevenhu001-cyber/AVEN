import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import {
  createPool,
  createApplicationPool,
  withRequestContext,
} from '../packages/database/dist/index.js';
import {
  ConnectionInvitationSchema,
  ConnectionMaintenanceResultSchema,
} from '../packages/contracts/dist/index.js';

const envFile = resolve(import.meta.dirname, '../.env');
if (existsSync(envFile)) loadEnvFile(envFile);
let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}
async function denied(work: () => Promise<unknown>, code = '42501') {
  try {
    await work();
    return false;
  } catch (error) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
  }
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Development verification only.');
  const admin = createPool('aven_migrator');
  const app = createApplicationPool();
  const worker = createPool('aven_worker');
  type Fixture = {
    sender: string;
    recipient: string;
    preview: string;
    invitation: string;
    grant: string;
    item: string;
    memory: string;
    key: string;
  };
  async function fixture(
    input: {
      previewAgeHours?: number;
      itemStatus?: 'active' | 'stale';
      invalidAgeDays?: number;
      grantExpiredDays?: number;
      revokedDays?: number;
      sourceExpiredDays?: number;
    } = {},
  ): Promise<Fixture> {
    const f: Fixture = {
      sender: randomUUID(),
      recipient: randomUUID(),
      preview: randomUUID(),
      invitation: randomUUID(),
      grant: randomUUID(),
      item: randomUUID(),
      memory: randomUUID(),
      key: randomUUID(),
    };
    await withRequestContext(admin, { userId: f.sender, principalId: f.sender }, async (client) => {
      for (const id of [f.sender, f.recipient]) {
        await client.query(
          "INSERT INTO public.principals(id,type,display_name) VALUES($1,'user','开发保留验证用户')",
          [id],
        );
        await client.query('INSERT INTO public.users(id) VALUES($1)', [id]);
      }
      await client.query(
        `INSERT INTO public.memory_items(id,owner_principal_id,kind,title,content,status,confirmed_at,valid_until)
        VALUES($1,$2,'interest','开发保留样例','开发专用共享正文','confirmed',clock_timestamp(),
          CASE WHEN $3::int IS NULL THEN NULL ELSE clock_timestamp()-make_interval(days=>$3) END)`,
        [f.memory, f.sender, input.sourceExpiredDays ?? null],
      );
      await client.query(
        `INSERT INTO public.context_field_policies(owner_principal_id,source_type,source_id,field_key,allowed_uses)
        VALUES($1,'memory_item',$2,'content',ARRAY['sharing']::public.context_use[])`,
        [f.sender, f.memory],
      );
      await client.query(
        `INSERT INTO public.connection_previews(id,actor_user_id,recipient_user_id,memory_item_ids,manifest,grant_expires_at,expires_at,consumed_at)
        VALUES($1,$2,$3,ARRAY[$4]::uuid[],$5,clock_timestamp()+interval '7 days',clock_timestamp()-make_interval(hours=>$6),clock_timestamp())`,
        [
          f.preview,
          f.sender,
          f.recipient,
          f.memory,
          JSON.stringify([
            {
              sourceId: f.memory,
              sourceVersion: 1,
              policyVersion: 1,
              value: '开发专用共享正文',
              validUntil: null,
            },
          ]),
          input.previewAgeHours ?? -1,
        ],
      );
      await client.query(
        `INSERT INTO public.consent_grants(id,grantor_principal_id,grantee_principal_id,purpose,status,expires_at,created_at,connection_invitation_id,revoked_at,revoked_by)
        VALUES($1,$2,$3,'connection_invitation',$4,clock_timestamp()-make_interval(days=>$5),clock_timestamp()-interval '100 days',$6,
          CASE WHEN $7::int IS NULL THEN NULL ELSE clock_timestamp()-make_interval(days=>$7) END,CASE WHEN $7::int IS NULL THEN NULL ELSE $2::uuid END)`,
        [
          f.grant,
          f.sender,
          f.recipient,
          input.revokedDays === undefined ? 'active' : 'revoked',
          input.grantExpiredDays ?? -7,
          f.invitation,
          input.revokedDays ?? null,
        ],
      );
      await client.query(
        `INSERT INTO public.connection_invitations(id,sender_user_id,recipient_user_id,preview_id,idempotency_key,grant_id,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()-make_interval(days=>$7))`,
        [
          f.invitation,
          f.sender,
          f.recipient,
          f.preview,
          f.key,
          f.grant,
          input.grantExpiredDays ?? -7,
        ],
      );
      await client.query(
        'UPDATE public.connection_previews SET result_invitation_id=$2 WHERE id=$1',
        [f.preview, f.invitation],
      );
      await client.query(
        `INSERT INTO public.consent_grant_items(id,grant_id,source_type,source_id,field_key,value_snapshot,status,invalidated_at)
        VALUES($1,$2,'memory_item',$3,'content',to_jsonb('开发专用共享正文'::text),$4,
          CASE WHEN $5::int IS NULL THEN NULL ELSE clock_timestamp()-make_interval(days=>$5) END)`,
        [f.item, f.grant, f.memory, input.itemStatus ?? 'active', input.invalidAgeDays ?? null],
      );
    });
    return f;
  }
  async function maintain(limit = 1000) {
    const result = await worker.query<{ result: unknown }>(
      'SELECT app.maintain_personal_connections($1) AS result',
      [limit],
    );
    return ConnectionMaintenanceResultSchema.parse(result.rows[0]?.result);
  }
  async function state(f: Fixture) {
    const result = await admin.query<{
      preview_purged: boolean;
      manifest_empty: boolean;
      item_purged: boolean;
      value_empty: boolean;
      status: string;
      invalidated_at: Date | null;
    }>(
      `SELECT p.purged_at IS NOT NULL AS preview_purged,p.manifest='[]'::jsonb AS manifest_empty,
        s.purged_at IS NOT NULL AS item_purged,s.value_snapshot='null'::jsonb AS value_empty,s.status,s.invalidated_at
        FROM public.connection_previews p JOIN public.consent_grant_items s ON s.id=$2 WHERE p.id=$1`,
      [f.preview, f.item],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Missing fixture state.');
    return row;
  }
  async function snapshot(f: Fixture) {
    return withRequestContext(
      app,
      { userId: f.recipient, principalId: f.recipient },
      async (client) => {
        const result = await client.query<{ items: unknown[] }>(
          'SELECT app.connection_snapshot($1) AS items',
          [f.invitation],
        );
        return result.rows[0]?.items ?? [];
      },
    );
  }
  try {
    check(
      'app has no maintenance execute permission',
      await denied(() => app.query('SELECT app.maintain_personal_connections(100)')),
    );
    check(
      'migration login cannot impersonate worker through the function',
      await denied(() => admin.query('SELECT app.maintain_personal_connections(100)')),
    );
    check(
      'forged worker GUC cannot authorize maintenance',
      await denied(() =>
        withRequestContext(app, {}, async (client) => {
          await client.query("SELECT set_config('app.is_worker','true',true)");
          return client.query('SELECT app.maintain_personal_connections(100)');
        }),
      ),
    );
    for (const limit of [0, -1, 1001, null])
      check(
        `invalid batch ${String(limit)} rejected`,
        await denied(
          () => worker.query('SELECT app.maintain_personal_connections($1)', [limit]),
          '22023',
        ),
      );
    check(
      'worker cannot directly read private preview values',
      await denied(() => worker.query('SELECT manifest FROM public.connection_previews')),
    );
    check(
      'worker cannot directly clear snapshot values',
      await denied(() =>
        worker.query("UPDATE public.consent_grant_items SET value_snapshot='null'::jsonb"),
      ),
    );

    const fresh = await fixture();
    const youngPreview = await fixture({ previewAgeHours: 23 });
    const oldPreview = await fixture({ previewAgeHours: 25 });
    const youngStale = await fixture({ itemStatus: 'stale', invalidAgeDays: 29 });
    const oldStale = await fixture({ itemStatus: 'stale', invalidAgeDays: 31 });
    const oldRevoked = await fixture({ revokedDays: 31 });
    const youngRevoked = await fixture({ revokedDays: 29 });
    const oldExpired = await fixture({ grantExpiredDays: 31 });
    const youngExpired = await fixture({ grantExpiredDays: 29 });
    const sourceExpired = await fixture({ sourceExpiredDays: 31 });
    const remainingMemory = randomUUID();
    await withRequestContext(
      admin,
      { userId: oldStale.sender, principalId: oldStale.sender },
      async (client) => {
        await client.query(
          `INSERT INTO public.memory_items(id,owner_principal_id,kind,title,content,status,confirmed_at)
        VALUES($1,$2,'interest','开发剩余来源','仍然授权的开发正文','confirmed',clock_timestamp())`,
          [remainingMemory, oldStale.sender],
        );
        await client.query(
          `INSERT INTO public.context_field_policies(owner_principal_id,source_type,source_id,field_key,allowed_uses)
        VALUES($1,'memory_item',$2,'content',ARRAY['sharing']::public.context_use[])`,
          [oldStale.sender, remainingMemory],
        );
        await client.query(
          `INSERT INTO public.consent_grant_items(grant_id,source_type,source_id,field_key,value_snapshot)
        VALUES($1,'memory_item',$2,'content',to_jsonb('仍然授权的开发正文'::text))`,
          [oldStale.grant, remainingMemory],
        );
      },
    );

    const outside = await fixture();
    const otherGrant = randomUUID(),
      otherItem = randomUUID();
    await admin.query(
      `INSERT INTO public.consent_grants(id,grantor_principal_id,grantee_principal_id,purpose,expires_at,created_at)
      VALUES($1,$2,$3,'relationship_context',clock_timestamp()-interval '31 days',clock_timestamp()-interval '100 days')`,
      [otherGrant, outside.sender, outside.recipient],
    );
    await admin.query(
      `INSERT INTO public.consent_grant_items(id,grant_id,source_type,source_id,field_key,value_snapshot,status,invalidated_at)
      VALUES($1,$2,'memory_item',$3,'content',to_jsonb('其他用途开发正文'::text),'stale',clock_timestamp()-interval '31 days')`,
      [otherItem, otherGrant, outside.memory],
    );

    await maintain();
    check(
      'fresh preview and active snapshot are retained',
      !(await state(fresh)).preview_purged &&
        !(await state(fresh)).item_purged &&
        (await snapshot(fresh)).length === 1,
    );
    check(
      'expired preview younger than 24 hours retains its body',
      !(await state(youngPreview)).preview_purged,
    );
    check(
      'expired preview after 24 hours is scrubbed',
      (await state(oldPreview)).preview_purged && (await state(oldPreview)).manifest_empty,
    );
    check('stale item younger than 30 days is retained', !(await state(youngStale)).item_purged);
    check(
      'stale item after 30 days has no body',
      (await state(oldStale)).item_purged && (await state(oldStale)).value_empty,
    );
    check(
      'old revocation is detected and cleared',
      (await state(oldRevoked)).item_purged && (await state(oldRevoked)).status === 'revoked',
    );
    check(
      'recent revocation invalidates without early purge',
      !(await state(youngRevoked)).item_purged && (await state(youngRevoked)).status === 'revoked',
    );
    check(
      'old grant expiry is detected and cleared',
      (await state(oldExpired)).item_purged && (await state(oldExpired)).status === 'expired',
    );
    check(
      'recent expiry invalidates without early purge',
      !(await state(youngExpired)).item_purged && (await state(youngExpired)).status === 'expired',
    );
    check(
      'expired source is cleared without running memory maintenance',
      (await state(sourceExpired)).item_purged,
    );
    const other = await admin.query<{ untouched: boolean }>(
      "SELECT purged_at IS NULL AND value_snapshot<>'null'::jsonb AS untouched FROM public.consent_grant_items WHERE id=$1",
      [otherItem],
    );
    check('other consent purposes are untouched', other.rows[0]?.untouched === true);

    const replay = await withRequestContext(
      app,
      { userId: oldPreview.sender, principalId: oldPreview.sender },
      async (client) => {
        const result = await client.query<{ result: unknown }>(
          'SELECT app.send_connection_invitation($1,$2) AS result',
          [oldPreview.preview, oldPreview.key],
        );
        return ConnectionInvitationSchema.parse(result.rows[0]?.result);
      },
    );
    check(
      'send idempotency survives preview body purge',
      replay.id === oldPreview.invitation && replay.status === 'pending',
    );
    const partial = await snapshot(oldStale);
    check(
      'partial purge preserves only the still-authorized source',
      partial.length === 1 &&
        JSON.stringify(partial).includes('仍然授权的开发正文') &&
        !JSON.stringify(partial).includes('开发专用共享正文'),
    );
    check(
      'purged preview cannot send under a new key',
      await denied(
        () =>
          withRequestContext(
            app,
            { userId: oldPreview.sender, principalId: oldPreview.sender },
            (client) =>
              client.query('SELECT app.send_connection_invitation($1,$2)', [
                oldPreview.preview,
                randomUUID(),
              ]),
          ),
        '40001',
      ),
    );
    check(
      'invalidated invitation cannot be accepted',
      await denied(
        () =>
          withRequestContext(
            app,
            { userId: oldStale.recipient, principalId: oldStale.recipient },
            (client) =>
              client.query("SELECT app.decide_connection_invitation($1,'accepted',1)", [
                oldStale.invitation,
              ]),
          ),
        '40001',
      ),
    );
    check(
      'purged item cannot reactivate',
      await denied(
        () =>
          admin.query("UPDATE public.consent_grant_items SET status='active' WHERE id=$1", [
            oldStale.item,
          ]),
        '22023',
      ),
    );
    check(
      'purged item body cannot be restored',
      await denied(
        () =>
          admin.query(
            "UPDATE public.consent_grant_items SET value_snapshot=to_jsonb('replacement'::text) WHERE id=$1",
            [oldStale.item],
          ),
        '22023',
      ),
    );
    check(
      'preview body cannot be restored',
      await denied(
        () =>
          admin.query(
            "UPDATE public.connection_previews SET manifest='[{}]'::jsonb,purged_at=NULL WHERE id=$1",
            [oldPreview.preview],
          ),
        '22023',
      ),
    );
    check(
      'active snapshot cannot be replaced',
      await denied(
        () =>
          admin.query(
            "UPDATE public.consent_grant_items SET value_snapshot=to_jsonb('replacement'::text) WHERE id=$1",
            [fresh.item],
          ),
        '22023',
      ),
    );
    check(
      'recent invalidation cannot be purged early',
      await denied(
        () =>
          admin.query(
            "UPDATE public.consent_grant_items SET value_snapshot='null'::jsonb,purged_at=clock_timestamp() WHERE id=$1",
            [youngStale.item],
          ),
        '22023',
      ),
    );

    const elapsed = await fixture({ sourceExpiredDays: 1 });
    await withRequestContext(
      admin,
      { userId: elapsed.sender, principalId: elapsed.sender },
      (client) =>
        client.query(
          "UPDATE public.memory_items SET valid_until=clock_timestamp()+interval '7 days',version=version+1 WHERE id=$1",
          [elapsed.memory],
        ),
    );
    check(
      'extending an elapsed source does not restore invitation access',
      (await snapshot(elapsed)).length === 0 && (await state(elapsed)).status === 'stale',
    );
    check(
      'source extension records original expiry rather than reviving a snapshot',
      (await state(elapsed)).invalidated_at !== null,
    );

    const established = await fixture();
    const accepted = await withRequestContext(
      app,
      { userId: established.recipient, principalId: established.recipient },
      async (client) => {
        const result = await client.query<{ result: unknown }>(
          "SELECT app.decide_connection_invitation($1,'accepted',1) AS result",
          [established.invitation],
        );
        return ConnectionInvitationSchema.parse(result.rows[0]?.result);
      },
    );
    await admin.query(
      "UPDATE public.consent_grants SET status='revoked',revoked_at=clock_timestamp()-interval '31 days',revoked_by=$2 WHERE id=$1",
      [established.grant, established.sender],
    );
    await maintain();
    const afterPurge = await withRequestContext(
      app,
      { userId: established.recipient, principalId: established.recipient },
      async (client) => {
        const result = await client.query<{ result: unknown }>(
          'SELECT app.get_connection_invitation($1) AS result',
          [established.invitation],
        );
        return ConnectionInvitationSchema.parse(result.rows[0]?.result);
      },
    );
    check(
      'purge preserves the established connection and invitation version',
      (await state(established)).item_purged &&
        afterPurge.connectionId === accepted.connectionId &&
        afterPurge.status === 'accepted' &&
        afterPurge.version === accepted.version,
    );
    const boundedOne = await fixture({ previewAgeHours: 25 });
    const boundedTwo = await fixture({ previewAgeHours: 25 });
    const bounded = await maintain(1);
    check(
      'batch limit bounds preview clearing',
      bounded.previewsPurged === 1 &&
        Number((await state(boundedOne)).preview_purged) +
          Number((await state(boundedTwo)).preview_purged) ===
          1,
    );
    await maintain();

    const locked = await fixture({ previewAgeHours: 25, itemStatus: 'stale', invalidAgeDays: 31 });
    const locker = await admin.connect();
    try {
      await locker.query('BEGIN');
      await locker.query('SELECT id FROM public.connection_previews WHERE id=$1 FOR UPDATE', [
        locked.preview,
      ]);
      await locker.query('SELECT id FROM public.consent_grant_items WHERE id=$1 FOR UPDATE', [
        locked.item,
      ]);
      await maintain();
      check(
        'locked rows are skipped without early clearing',
        !(await state(locked)).preview_purged && !(await state(locked)).item_purged,
      );
    } finally {
      await locker.query('ROLLBACK');
      locker.release();
    }
    const concurrent = await Promise.all([maintain(), maintain()]);
    check(
      'concurrent maintenance clears each fixture once',
      (await state(locked)).preview_purged &&
        (await state(locked)).item_purged &&
        concurrent.reduce((n, r) => n + r.snapshotsPurged, 0) === 1,
    );
    const audit = await admin.query<{ count: string; safe: boolean }>(
      `SELECT count(*)::text AS count,bool_and(actor_principal_id IS NULL AND NOT(metadata::text LIKE '%开发专用共享正文%')) AS safe
      FROM public.consent_events WHERE grant_id=$1 AND event_type='purged'`,
      [locked.grant],
    );
    check(
      'one metadata-only system purge event per item',
      audit.rows[0]?.count === '1' && audit.rows[0]?.safe === true,
    );
    const again = await maintain();
    check(
      'maintenance replay is idempotent',
      again.previewsPurged === 0 && again.snapshotsPurged === 0,
    );
  } finally {
    await Promise.all([admin.end(), app.end(), worker.end()]);
  }
  if (failed) throw new Error('Maintenance verification failed.');
  console.log('All personal connection retention checks passed.');
}
void main().catch((error: unknown) => {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    console.error('Verification database error code:', String(error.code));
    if ('position' in error) console.error('Verification SQL position:', String(error.position));
  }
  console.error('Connection retention verification failed.');
  process.exitCode = 1;
});
