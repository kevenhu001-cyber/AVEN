import { describe, expect, it, vi } from 'vitest';
import type { DatabasePool } from '@aven/database';
import { deliverNotification, failNotification, NotificationJobSchema } from './notification.js';
const eventId = '11111111-1111-4111-8111-111111111111';
describe('notification jobs', () => {
  it('only accepts durable event identity and generation', () => {
    expect(NotificationJobSchema.safeParse({ eventId, generation: 0 }).success).toBe(true);
    for (const value of [
      { eventId, generation: -1 },
      { eventId, generation: 0, recipientUserId: eventId },
      { eventId, generation: 0, body: 'private' },
    ])
      expect(NotificationJobSchema.safeParse(value).success).toBe(false);
  });
  it('rejects malformed jobs and excessive attempts before database access', async () => {
    const query = vi.fn();
    const pool = { query } as unknown as DatabasePool;
    await expect(
      deliverNotification(pool, { eventId, generation: 0, role: 'admin' }, 1),
    ).rejects.toThrow('INVALID_NOTIFICATION_JOB');
    await expect(deliverNotification(pool, { eventId, generation: 0 }, 6)).rejects.toThrow(
      'INVALID_NOTIFICATION_JOB',
    );
    await expect(failNotification(pool, { eventId, generation: 0 }, 0)).rejects.toThrow(
      'INVALID_NOTIFICATION_JOB',
    );
    expect(query).not.toHaveBeenCalled();
  });
  it('rejects malformed database success output', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ result: 'private error text' }] }),
    } as unknown as DatabasePool;
    await expect(deliverNotification(pool, { eventId, generation: 0 }, 1)).rejects.toThrow(
      'INVALID_DELIVERY_RESULT',
    );
  });
});
