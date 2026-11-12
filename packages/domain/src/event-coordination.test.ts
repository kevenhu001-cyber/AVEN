import { describe, expect, it } from 'vitest';
import type { ExtractedEventConstraints } from '@aven/contracts';
import {
  buildNonWorkingBlockedIntervals,
  coordinateEventSchedule,
  zonedWallClockToUtc,
} from './event-coordination.js';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

function baseConstraints(
  overrides: Partial<ExtractedEventConstraints> = {},
): ExtractedEventConstraints {
  return {
    title: '科研同步会',
    durationMinutes: 60,
    windowStart: '2026-11-13T00:00:00.000Z',
    windowEnd: '2026-11-14T00:00:00.000Z',
    timezone: 'Asia/Shanghai',
    workingHoursOnly: true,
    workingHours: { startHour: 9, endHour: 18 },
    preferredTimeOfDay: 'any',
    notes: null,
    ...overrides,
  };
}

describe('event coordination domain solver (M6-05)', () => {
  it('converts local wall clock across DST fall-back accurately', () => {
    // 2026-11-01 in America/New_York: 09:00 EDT/EST after 02:00 fall-back is UTC-5 => 14:00Z
    const afterFallback = zonedWallClockToUtc(2026, 11, 1, 9, 0, 'America/New_York');
    expect(afterFallback.toISOString()).toBe('2026-11-01T14:00:00.000Z');

    // 2026-10-31 in America/New_York: 09:00 EDT (UTC-4) => 13:00Z
    const beforeFallback = zonedWallClockToUtc(2026, 10, 31, 9, 0, 'America/New_York');
    expect(beforeFallback.toISOString()).toBe('2026-10-31T13:00:00.000Z');
  });

  it('intersects local working hours across Asia/Shanghai and America/New_York', () => {
    // Asia/Shanghai 08:00-22:00 on 2026-11-13 = 00:00Z..14:00Z
    // America/New_York (EST, UTC-5) 08:00-22:00 spans:
    //   Nov 12 local: 2026-11-12T13:00Z..2026-11-13T03:00Z
    //   Nov 13 local: 2026-11-13T13:00Z..2026-11-14T03:00Z
    // Overlap inside [2026-11-13T00:00Z, 2026-11-14T00:00Z]:
    //   00:00Z..03:00Z (5 sliding 60m slots) + 13:00Z..14:00Z (1 slot) = 6 candidates.
    const result = coordinateEventSchedule({
      extracted: baseConstraints({
        workingHours: { startHour: 8, endHour: 22 },
      }),
      defaultTimezone: 'Asia/Shanghai',
      participantIds: [USER_A, USER_B],
      participantTimezones: {
        [USER_A]: 'Asia/Shanghai',
        [USER_B]: 'America/New_York',
      },
      busyIntervals: [],
    });

    expect(result.status).toBe('candidates_ready');
    expect(result.candidates).toHaveLength(6);
    expect(result.candidates[0]?.startAt).toBe('2026-11-13T00:00:00.000Z');
    expect(result.candidates[0]?.endAt).toBe('2026-11-13T01:00:00.000Z');
    expect(result.candidates[5]?.startAt).toBe('2026-11-13T13:00:00.000Z');
    expect(result.candidates[5]?.endAt).toBe('2026-11-13T14:00:00.000Z');
  });

  it('returns needs_clarification when duration or window is missing', () => {
    const result = coordinateEventSchedule({
      extracted: baseConstraints({
        durationMinutes: null,
        windowStart: null,
        windowEnd: null,
      }),
      defaultTimezone: 'Asia/Shanghai',
      participantIds: [USER_A],
      busyIntervals: [],
    });

    expect(result.status).toBe('needs_clarification');
    expect(result.missingConstraints).toEqual(['windowStart', 'windowEnd', 'durationMinutes']);
    expect(result.clarificationPrompts.length).toBeGreaterThanOrEqual(3);
    expect(result.candidates).toEqual([]);
  });

  it('applies explicit overrides over extracted constraints and ranks by preferredTimeOfDay', () => {
    // 2026-11-13 Asia/Shanghai 09:00-18:00 is 01:00Z..10:00Z
    // Busy in morning 01:00Z..04:00Z (09:00-12:00 CST), free 04:00Z..10:00Z (12:00-18:00 CST)
    const result = coordinateEventSchedule({
      extracted: baseConstraints({
        durationMinutes: null,
        preferredTimeOfDay: 'morning',
      }),
      overrides: {
        durationMinutes: 60,
        preferredTimeOfDay: 'afternoon',
      },
      defaultTimezone: 'Asia/Shanghai',
      participantIds: [USER_A],
      busyIntervals: [
        {
          start: new Date('2026-11-13T01:00:00.000Z'),
          end: new Date('2026-11-13T04:00:00.000Z'),
        },
      ],
      maxCandidates: 3,
    });

    expect(result.status).toBe('candidates_ready');
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates[0]?.startAt).toBe('2026-11-13T04:00:00.000Z');
    expect(result.candidates[0]?.score).toBe(0.95);
    expect(result.candidates[0]?.reason).toContain('符合下午时段偏好');
  });

  it('returns no_common_slots when busy intervals cover all local working hours', () => {
    const blocked = buildNonWorkingBlockedIntervals(
      new Date('2026-11-13T00:00:00.000Z'),
      new Date('2026-11-14T00:00:00.000Z'),
      { timeZone: 'Asia/Shanghai', startHour: 9, endHour: 18 },
    );
    expect(blocked.length).toBeGreaterThan(0);

    const result = coordinateEventSchedule({
      extracted: baseConstraints(),
      defaultTimezone: 'Asia/Shanghai',
      participantIds: [USER_A, USER_B],
      busyIntervals: [
        {
          start: new Date('2026-11-13T01:00:00.000Z'),
          end: new Date('2026-11-13T10:00:00.000Z'),
        },
      ],
    });

    expect(result.status).toBe('no_common_slots');
    expect(result.candidates).toEqual([]);
  });
});
