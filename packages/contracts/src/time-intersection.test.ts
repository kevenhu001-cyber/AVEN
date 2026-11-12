import { describe, expect, it } from 'vitest';
import { TimeIntersectionRequestSchema } from './index.js';

const request = {
  principalIds: ['00000000-0000-4000-8000-000000000001'],
  windowStart: '2026-11-01T00:00:00.000Z',
  windowEnd: '2026-12-02T00:00:00.000Z',
};

describe('time intersection request limits', () => {
  it('accepts a 31-day window', () => {
    expect(TimeIntersectionRequestSchema.safeParse(request).success).toBe(true);
  });

  it('rejects reversed, empty, and oversized windows', () => {
    for (const windowEnd of [
      request.windowStart,
      '2026-10-31T00:00:00.000Z',
      '2026-12-02T00:00:00.001Z',
    ]) {
      expect(TimeIntersectionRequestSchema.safeParse({ ...request, windowEnd }).success).toBe(
        false,
      );
    }
  });

  it('bounds participant count and duration', () => {
    expect(
      TimeIntersectionRequestSchema.safeParse({
        ...request,
        principalIds: Array(51).fill(request.principalIds[0]),
      }).success,
    ).toBe(false);
    expect(
      TimeIntersectionRequestSchema.safeParse({ ...request, durationMinutes: 31 * 24 * 60 + 1 })
        .success,
    ).toBe(false);
  });
});
