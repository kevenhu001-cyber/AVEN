import { createPool } from '../packages/database/dist/index.js';
import { RequestIdSchema } from '../packages/contracts/dist/index.js';
// An explicit operator-only command, never called from registration or an HTTP endpoint.
const [operation, rawId] = process.argv.slice(2);
const id = RequestIdSchema.safeParse(rawId);
if (!['grant', 'revoke'].includes(operation ?? '') || !id.success)
  throw new Error('Usage: admin:role grant|revoke <user UUID>');
const pool = createPool('aven_migrator');
try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (operation === 'grant') {
      // Expire previous assignments first; short grants make bootstrap access deliberate.
      await client.query(
        "UPDATE public.platform_role_assignments SET status='revoked',revoked_at=now() WHERE user_id=$1 AND role='platform_admin' AND status='active' AND expires_at<=now()",
        [id.data],
      );
      await client.query(
        "INSERT INTO public.platform_role_assignments(user_id,role,expires_at) VALUES($1,'platform_admin',now()+interval '7 days') ON CONFLICT DO NOTHING",
        [id.data],
      );
    } else
      await client.query(
        "UPDATE public.platform_role_assignments SET status='revoked',revoked_at=now() WHERE user_id=$1 AND role='platform_admin' AND status='active'",
        [id.data],
      );
    await client.query('COMMIT');
    console.log(
      'Platform role operation completed. Assignment records are retained; no credentials were displayed.',
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
