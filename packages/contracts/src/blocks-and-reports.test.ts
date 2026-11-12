import { describe, expect, it } from 'vitest';
import {
  BlockUserRequestSchema,
  BlockItemSchema,
  BlockUserResponseSchema,
  UnblockUserResponseSchema,
  ListBlocksResponseSchema,
  SubmitReportRequestSchema,
  ReportItemSchema,
  SubmitReportResponseSchema,
  ListReportsResponseSchema,
} from './index.js';

describe('Blocks and Reports Contracts', () => {
  it('validates BlockUserRequestSchema', () => {
    const valid = {
      blockedUserId: '11111111-1111-4111-8111-111111111111',
      reason: 'Harassment in messages',
    };
    expect(BlockUserRequestSchema.parse(valid)).toEqual(valid);

    // reason optional
    expect(
      BlockUserRequestSchema.parse({
        blockedUserId: '11111111-1111-4111-8111-111111111111',
      }),
    ).toBeDefined();

    // invalid uuid
    expect(() =>
      BlockUserRequestSchema.parse({
        blockedUserId: 'not-a-uuid',
      }),
    ).toThrow();
  });

  it('validates BlockItemSchema and ListBlocksResponseSchema', () => {
    const blockItem = {
      id: '22222222-2222-4222-8222-222222222222',
      blockedUserId: '11111111-1111-4111-8111-111111111111',
      reason: 'Spam',
      createdAt: '2026-11-12T13:00:00.000Z',
    };
    expect(BlockItemSchema.parse(blockItem)).toEqual(blockItem);

    const listResponse = {
      blocks: [blockItem],
    };
    expect(ListBlocksResponseSchema.parse(listResponse)).toEqual(listResponse);
  });

  it('validates BlockUserResponseSchema and UnblockUserResponseSchema', () => {
    const res = {
      id: '22222222-2222-4222-8222-222222222222',
      ownerUserId: '33333333-3333-4333-8333-333333333333',
      blockedUserId: '11111111-1111-4111-8111-111111111111',
      reason: null,
      createdAt: '2026-11-12T13:00:00.000Z',
    };
    expect(BlockUserResponseSchema.parse(res)).toEqual(res);

    expect(UnblockUserResponseSchema.parse({ unblocked: true })).toEqual({ unblocked: true });
  });

  it('validates SubmitReportRequestSchema', () => {
    const valid = {
      targetType: 'user',
      targetId: '11111111-1111-4111-8111-111111111111',
      reason: 'spam',
      details: 'Sending spam invitations constantly',
    };
    expect(SubmitReportRequestSchema.parse(valid)).toEqual(valid);

    // invalid reason
    expect(() =>
      SubmitReportRequestSchema.parse({
        targetType: 'user',
        targetId: '11111111-1111-4111-8111-111111111111',
        reason: 'invalid_reason',
      }),
    ).toThrow();

    // invalid targetType
    expect(() =>
      SubmitReportRequestSchema.parse({
        targetType: 'unknown_type',
        targetId: '11111111-1111-4111-8111-111111111111',
        reason: 'spam',
      }),
    ).toThrow();
  });

  it('validates SubmitReportResponseSchema and ListReportsResponseSchema', () => {
    const reportItem = {
      id: '44444444-4444-4444-8444-444444444444',
      targetType: 'peer_message',
      targetId: '55555555-5555-4555-8555-555555555555',
      reason: 'harassment',
      details: 'Offensive language',
      status: 'open',
      createdAt: '2026-11-12T13:00:00.000Z',
    };
    expect(ReportItemSchema.parse(reportItem)).toEqual(reportItem);

    const submitResponse = {
      id: '44444444-4444-4444-8444-444444444444',
      reporterUserId: '66666666-6666-4666-8666-666666666666',
      targetType: 'peer_message',
      targetId: '55555555-5555-4555-8555-555555555555',
      reason: 'harassment',
      details: 'Offensive language',
      status: 'open',
      createdAt: '2026-11-12T13:00:00.000Z',
    };
    expect(SubmitReportResponseSchema.parse(submitResponse)).toEqual(submitResponse);

    const listRes = {
      reports: [reportItem],
    };
    expect(ListReportsResponseSchema.parse(listRes)).toEqual(listRes);
  });
});
