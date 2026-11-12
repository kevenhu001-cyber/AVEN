import { describe, expect, it } from 'vitest';
import {
  CoordinateEventRequestSchema,
  CoordinateEventResponseSchema,
  ExtractedEventConstraintsSchema,
} from './index.js';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const USER_C = '33333333-3333-4333-8333-333333333333';

describe('event coordination contracts (M6-05)', () => {
  it('validates coordinate event requests and rejects unknown participant timezones', () => {
    const valid = CoordinateEventRequestSchema.parse({
      prompt: '下周二下午和王老师开一个60分钟的组会',
      participantIds: [USER_A, USER_B],
      defaultTimezone: 'Asia/Shanghai',
      participantTimezones: {
        [USER_B]: 'America/New_York',
      },
    });
    expect(valid.maxCandidates).toBe(10);
    expect(valid.defaultTimezone).toBe('Asia/Shanghai');

    const unknownParticipant = CoordinateEventRequestSchema.safeParse({
      prompt: '下周二下午开会',
      participantIds: [USER_A],
      participantTimezones: {
        [USER_C]: 'Asia/Shanghai',
      },
    });
    expect(unknownParticipant.success).toBe(false);
  });

  it('rejects invalid IANA time zones and over-31-day override windows', () => {
    const badTz = CoordinateEventRequestSchema.safeParse({
      prompt: 'tomorrow 60 minutes',
      participantIds: [USER_A],
      defaultTimezone: 'Mars/Olympus',
    });
    expect(badTz.success).toBe(false);

    const longWindow = CoordinateEventRequestSchema.safeParse({
      prompt: 'schedule sync',
      participantIds: [USER_A],
      overrides: {
        windowStart: '2026-11-12T00:00:00.000Z',
        windowEnd: '2026-12-20T00:00:00.000Z',
      },
    });
    expect(longWindow.success).toBe(false);
  });

  it('validates extracted constraints and enforces externalCalendarsModified=false on responses', () => {
    const extracted = ExtractedEventConstraintsSchema.parse({
      title: '科研进展同步',
      durationMinutes: 60,
      windowStart: '2026-11-13T00:00:00.000Z',
      windowEnd: '2026-11-14T00:00:00.000Z',
      timezone: 'Asia/Shanghai',
      workingHoursOnly: true,
      workingHours: { startHour: 9, endHour: 18 },
      preferredTimeOfDay: 'afternoon',
      notes: null,
    });

    const response = CoordinateEventResponseSchema.parse({
      status: 'candidates_ready',
      provider: 'mock',
      model: 'mock-deterministic-v1',
      mock: true,
      extractedConstraints: extracted,
      missingConstraints: [],
      clarificationPrompts: [],
      candidates: [
        {
          startAt: '2026-11-13T06:00:00.000Z',
          endAt: '2026-11-13T07:00:00.000Z',
          score: 0.95,
          reason: '符合所有参与者当地时间段及下午偏好',
        },
      ],
      externalCalendarsModified: false,
    });
    expect(response.externalCalendarsModified).toBe(false);

    const mutatedCalendarAttempt = CoordinateEventResponseSchema.safeParse({
      ...response,
      externalCalendarsModified: true,
    });
    expect(mutatedCalendarAttempt.success).toBe(false);
  });
});
