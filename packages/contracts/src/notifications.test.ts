import { describe, expect, it } from 'vitest';
import {
  NotificationListQuerySchema,
  NotificationSchema,
  UpdateNotificationPreferencesSchema,
  RetryNotificationSchema,
} from './index.js';
const id = '11111111-1111-4111-8111-111111111111';
const at = '2026-11-12T08:00:00+00:00';
describe('notification boundaries', () => {
  it('defaults bounded pagination and requires paired cursors', () => {
    expect(NotificationListQuerySchema.parse({}).limit).toBe(20);
    expect(NotificationListQuerySchema.safeParse({ cursorId: id }).success).toBe(false);
    expect(NotificationListQuerySchema.safeParse({ cursorCreatedAt: at }).success).toBe(false);
    expect(
      NotificationListQuerySchema.safeParse({ limit: '100', cursorCreatedAt: at, cursorId: id })
        .success,
    ).toBe(true);
  });
  it.each([0, 101, -1, 1.5])('rejects invalid page size %s', (limit) =>
    expect(NotificationListQuerySchema.safeParse({ limit }).success).toBe(false),
  );
  it('forbids recipient and body injection', () => {
    expect(NotificationListQuerySchema.safeParse({ recipientUserId: id }).success).toBe(false);
    const n = {
      id,
      kind: 'sent',
      target: { type: 'connection_invitation', id },
      createdAt: at,
      readAt: null,
    };
    expect(NotificationSchema.safeParse(n).success).toBe(true);
    expect(NotificationSchema.safeParse({ ...n, body: 'private' }).success).toBe(false);
    expect(
      NotificationSchema.safeParse({ ...n, target: { ...n.target, snapshot: 'private' } }).success,
    ).toBe(false);
  });
  it('requires explicit booleans and optimistic versions', () => {
    const prefs = { connectionInvitations: false, connectionUpdates: true, expectedVersion: 0 };
    expect(UpdateNotificationPreferencesSchema.safeParse(prefs).success).toBe(true);
    expect(
      UpdateNotificationPreferencesSchema.safeParse({ ...prefs, connectionInvitations: 'false' })
        .success,
    ).toBe(false);
    expect(
      UpdateNotificationPreferencesSchema.safeParse({ ...prefs, recipientUserId: id }).success,
    ).toBe(false);
    expect(
      UpdateNotificationPreferencesSchema.safeParse({ ...prefs, expectedVersion: -1 }).success,
    ).toBe(false);
    expect(RetryNotificationSchema.safeParse({ expectedGeneration: 0 }).success).toBe(true);
    expect(RetryNotificationSchema.safeParse({}).success).toBe(false);
  });
});
