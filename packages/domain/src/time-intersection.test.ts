import { describe, expect, it } from 'vitest';
import { findAvailableTimeSlots, mergeIntervals } from './time-intersection.js';

describe('mergeIntervals', () => {
  it('returns empty array when given no intervals', () => {
    expect(mergeIntervals([])).toEqual([]);
  });

  it('merges overlapping intervals', () => {
    const intervals = [
      { start: new Date('2026-11-12T10:00:00Z'), end: new Date('2026-11-12T12:00:00Z') },
      { start: new Date('2026-11-12T11:00:00Z'), end: new Date('2026-11-12T13:00:00Z') },
    ];
    const merged = mergeIntervals(intervals);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.start.toISOString()).toBe('2026-11-12T10:00:00.000Z');
    expect(merged[0]?.end.toISOString()).toBe('2026-11-12T13:00:00.000Z');
  });

  it('keeps disjoint intervals separate', () => {
    const intervals = [
      { start: new Date('2026-11-12T10:00:00Z'), end: new Date('2026-11-12T11:00:00Z') },
      { start: new Date('2026-11-12T13:00:00Z'), end: new Date('2026-11-12T14:00:00Z') },
    ];
    const merged = mergeIntervals(intervals);
    expect(merged).toHaveLength(2);
  });
});

describe('findAvailableTimeSlots', () => {
  it('returns empty slots when duration cannot fit', () => {
    const windowStart = new Date('2026-11-12T10:00:00Z');
    const windowEnd = new Date('2026-11-12T10:30:00Z'); // 30 mins
    const slots = findAvailableTimeSlots({
      windowStart,
      windowEnd,
      durationMinutes: 60, // requires 60 mins
      busyIntervals: [],
    });
    expect(slots).toHaveLength(0);
  });

  it('computes free slots around busy periods', () => {
    const windowStart = new Date('2026-11-12T09:00:00Z');
    const windowEnd = new Date('2026-11-12T12:00:00Z'); // 3 hours
    const busyIntervals = [
      { start: new Date('2026-11-12T10:00:00Z'), end: new Date('2026-11-12T11:00:00Z') }, // 10:00-11:00 busy
    ];

    const slots = findAvailableTimeSlots({
      windowStart,
      windowEnd,
      durationMinutes: 60,
      busyIntervals,
      stepMinutes: 60,
    });

    expect(slots).toHaveLength(2);
    expect(slots[0]).toEqual({
      startAt: '2026-11-12T09:00:00.000Z',
      endAt: '2026-11-12T10:00:00.000Z',
    });
    expect(slots[1]).toEqual({
      startAt: '2026-11-12T11:00:00.000Z',
      endAt: '2026-11-12T12:00:00.000Z',
    });
  });

  it('handles completely blocked windows (no overlap possible)', () => {
    const windowStart = new Date('2026-11-12T09:00:00Z');
    const windowEnd = new Date('2026-11-12T12:00:00Z');
    const busyIntervals = [
      { start: new Date('2026-11-12T08:00:00Z'), end: new Date('2026-11-12T13:00:00Z') },
    ];

    const slots = findAvailableTimeSlots({
      windowStart,
      windowEnd,
      durationMinutes: 30,
      busyIntervals,
    });

    expect(slots).toHaveLength(0);
  });
});

it('uses UTC working hours across days regardless of server timezone', () => {
  const slots = findAvailableTimeSlots({
    windowStart: new Date('2026-11-12T17:00:00Z'),
    windowEnd: new Date('2026-11-13T10:00:00Z'),
    durationMinutes: 60,
    busyIntervals: [],
    workingHoursOnly: true,
    stepMinutes: 60,
  });
  expect(slots).toEqual([
    { startAt: '2026-11-12T17:00:00.000Z', endAt: '2026-11-12T18:00:00.000Z' },
    { startAt: '2026-11-13T09:00:00.000Z', endAt: '2026-11-13T10:00:00.000Z' },
  ]);
});

it('rejects a nonpositive step instead of looping indefinitely', () => {
  expect(
    findAvailableTimeSlots({
      windowStart: new Date('2026-11-12T09:00:00Z'),
      windowEnd: new Date('2026-11-12T10:00:00Z'),
      durationMinutes: 30,
      busyIntervals: [],
      stepMinutes: 0,
    }),
  ).toEqual([]);
});

describe('invalid solver input fails closed', () => {
  const options = {
    windowStart: new Date('2026-11-12T09:00:00Z'),
    windowEnd: new Date('2026-11-12T12:00:00Z'),
    durationMinutes: 30,
    busyIntervals: [],
  };

  it.each([NaN, Infinity, -1, 0, 0.5])('rejects duration or step %s', (value) => {
    expect(findAvailableTimeSlots({ ...options, durationMinutes: value })).toEqual([]);
    expect(findAvailableTimeSlots({ ...options, stepMinutes: value })).toEqual([]);
  });

  it('rejects invalid window dates', () => {
    expect(findAvailableTimeSlots({ ...options, windowStart: new Date(NaN) })).toEqual([]);
    expect(findAvailableTimeSlots({ ...options, windowEnd: new Date(NaN) })).toEqual([]);
  });

  it.each([
    { start: new Date(NaN), end: new Date('2026-11-12T10:00:00Z') },
    { start: new Date('2026-11-12T10:00:00Z'), end: new Date(NaN) },
    { start: new Date('2026-11-12T10:00:00Z'), end: new Date('2026-11-12T09:00:00Z') },
    { start: new Date('2026-11-12T10:00:00Z'), end: new Date('2026-11-12T10:00:00Z') },
  ])('does not treat malformed busy interval as free time: %o', (interval) => {
    expect(findAvailableTimeSlots({ ...options, busyIntervals: [interval] })).toEqual([]);
  });

  it.each([
    [-1, 18],
    [9, 25],
    [18, 9],
    [9, 9],
    [NaN, 18],
    [9, Infinity],
    [9.5, 18],
  ])('rejects invalid working hours %s–%s', (workingHourStart, workingHourEnd) => {
    expect(
      findAvailableTimeSlots({
        ...options,
        workingHoursOnly: true,
        workingHourStart,
        workingHourEnd,
      }),
    ).toEqual([]);
  });
});
