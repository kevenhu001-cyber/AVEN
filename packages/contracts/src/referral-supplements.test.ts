import { describe, expect, it } from 'vitest';
import {
  ReferralSupplementSchema,
  SubmitReferralSupplementRequestSchema,
  ReferralSupplementListResponseSchema,
} from './index.js';

describe('Referral Supplements Contracts', () => {
  it('validates a valid SubmitReferralSupplementRequest', () => {
    const valid = {
      content:
        'Here is my GitHub repository and academic publication link: https://github.com/example/project',
      expectedVersion: 1,
    };
    const parsed = SubmitReferralSupplementRequestSchema.parse(valid);
    expect(parsed.content).toBe(valid.content);
    expect(parsed.expectedVersion).toBe(1);
  });

  it('rejects empty or whitespace-only content', () => {
    expect(() => SubmitReferralSupplementRequestSchema.parse({ content: '   ' })).toThrow();
    expect(() => SubmitReferralSupplementRequestSchema.parse({ content: '' })).toThrow();
  });

  it('rejects content exceeding 4000 characters', () => {
    const tooLong = 'a'.repeat(4001);
    expect(() => SubmitReferralSupplementRequestSchema.parse({ content: tooLong })).toThrow();
  });

  it('validates a valid ReferralSupplement', () => {
    const supplement = {
      id: '11111111-1111-4111-8111-111111111111',
      referralId: '22222222-2222-4222-8222-222222222222',
      supplementVersion: 1,
      authorUserId: '33333333-3333-4333-8333-333333333333',
      content: 'My supplemental research report',
      createdAt: '2026-11-12T10:00:00.000Z',
    };
    const parsed = ReferralSupplementSchema.parse(supplement);
    expect(parsed.supplementVersion).toBe(1);
  });

  it('validates ReferralSupplementListResponse', () => {
    const list = {
      referralId: '22222222-2222-4222-8222-222222222222',
      supplements: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          referralId: '22222222-2222-4222-8222-222222222222',
          supplementVersion: 1,
          authorUserId: '33333333-3333-4333-8333-333333333333',
          content: 'My supplemental research report',
          createdAt: '2026-11-12T10:00:00.000Z',
        },
      ],
    };
    const parsed = ReferralSupplementListResponseSchema.parse(list);
    expect(parsed.supplements).toHaveLength(1);
  });
});
