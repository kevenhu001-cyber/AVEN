import { describe, expect, it } from 'vitest';
import {
  CreateConnectionPreviewRequestSchema,
  ConnectionDecisionRequestSchema,
  SendConnectionInvitationRequestSchema,
} from './index.js';
const id = '11111111-1111-4111-8111-111111111111';
describe('personal connection input boundaries', () => {
  it('defaults to a short, explicit sharing horizon', () => {
    expect(
      CreateConnectionPreviewRequestSchema.parse({ recipientUserId: id, memoryItemIds: [id] })
        .expiresInDays,
    ).toBe(7);
  });
  it.each([
    [],
    [id, id],
    Array.from({ length: 11 }, (_, index) => id.slice(0, -2) + index.toString(16).padStart(2, '0')),
  ])('rejects empty, duplicate or oversized selections', (memoryItemIds) => {
    expect(
      CreateConnectionPreviewRequestSchema.safeParse({ recipientUserId: id, memoryItemIds })
        .success,
    ).toBe(false);
  });
  it('rejects actor injection, client snapshots, invalid horizons and unversioned decisions', () => {
    for (const extra of [
      { senderUserId: id },
      { snapshot: 'private' },
      { expiresInDays: 8 },
      { expiresInDays: 0 },
    ]) {
      expect(
        CreateConnectionPreviewRequestSchema.safeParse({
          recipientUserId: id,
          memoryItemIds: [id],
          ...extra,
        }).success,
      ).toBe(false);
    }
    expect(ConnectionDecisionRequestSchema.safeParse({ decision: 'accepted' }).success).toBe(false);
    expect(
      SendConnectionInvitationRequestSchema.safeParse({ previewId: id, recipientUserId: id })
        .success,
    ).toBe(false);
  });
});
