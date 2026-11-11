export type TimeRange = {
  start: Date;
  end: Date;
};

export type AvailableSlot = {
  startAt: string;
  endAt: string;
};

export type TimeIntersectionOptions = {
  windowStart: Date;
  windowEnd: Date;
  durationMinutes: number;
  busyIntervals: TimeRange[];
  workingHoursOnly?: boolean;
  workingHourStart?: number; // e.g. 9 for 09:00
  workingHourEnd?: number; // e.g. 18 for 18:00
  stepMinutes?: number; // e.g. 30
};

/**
 * Merges overlapping or contiguous time intervals into sorted disjoint intervals.
 */
export function mergeIntervals(intervals: TimeRange[]): TimeRange[] {
  if (intervals.length === 0) return [];

  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());
  const first = sorted[0];
  if (!first) return [];

  const merged: TimeRange[] = [{ start: first.start, end: first.end }];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const prev = merged[merged.length - 1];
    if (!current || !prev) continue;

    if (current.start.getTime() <= prev.end.getTime()) {
      if (current.end.getTime() > prev.end.getTime()) {
        prev.end = current.end;
      }
    } else {
      merged.push({ start: current.start, end: current.end });
    }
  }

  return merged;
}

/**
 * Deterministically computes available free time slots across all participants.
 */
export function findAvailableTimeSlots(options: TimeIntersectionOptions): AvailableSlot[] {
  const {
    windowStart,
    windowEnd,
    durationMinutes,
    busyIntervals,
    workingHoursOnly = false,
    workingHourStart = 9,
    workingHourEnd = 18,
    stepMinutes = 30,
  } = options;

  if (windowEnd.getTime() <= windowStart.getTime() || durationMinutes <= 0) {
    return [];
  }

  const durationMs = durationMinutes * 60 * 1000;
  const stepMs = stepMinutes * 60 * 1000;

  // Collect all blocked ranges (busy intervals + non-working hours if enabled)
  const allBlocked: TimeRange[] = [...busyIntervals];

  if (workingHoursOnly) {
    // Generate blocked intervals for off-hours
    const currentDay = new Date(windowStart);
    currentDay.setHours(0, 0, 0, 0);

    const endDay = new Date(windowEnd);
    endDay.setHours(23, 59, 59, 999);

    while (currentDay.getTime() <= endDay.getTime()) {
      // 00:00 to workingHourStart
      const morningBlockStart = new Date(currentDay);
      morningBlockStart.setHours(0, 0, 0, 0);
      const morningBlockEnd = new Date(currentDay);
      morningBlockEnd.setHours(workingHourStart, 0, 0, 0);

      allBlocked.push({ start: morningBlockStart, end: morningBlockEnd });

      // workingHourEnd to 23:59:59.999
      const eveningBlockStart = new Date(currentDay);
      eveningBlockStart.setHours(workingHourEnd, 0, 0, 0);
      const eveningBlockEnd = new Date(currentDay);
      eveningBlockEnd.setHours(24, 0, 0, 0);

      allBlocked.push({ start: eveningBlockStart, end: eveningBlockEnd });

      currentDay.setDate(currentDay.getDate() + 1);
    }
  }

  // Clip blocked intervals to window
  const clipped: TimeRange[] = [];
  for (const b of allBlocked) {
    const s = Math.max(b.start.getTime(), windowStart.getTime());
    const e = Math.min(b.end.getTime(), windowEnd.getTime());
    if (e > s) {
      clipped.push({ start: new Date(s), end: new Date(e) });
    }
  }

  const mergedBlocked = mergeIntervals(clipped);

  // Compute free gaps
  const freeGaps: TimeRange[] = [];
  let cursor = windowStart.getTime();

  for (const block of mergedBlocked) {
    if (block.start.getTime() > cursor) {
      freeGaps.push({ start: new Date(cursor), end: block.start });
    }
    cursor = Math.max(cursor, block.end.getTime());
  }

  if (cursor < windowEnd.getTime()) {
    freeGaps.push({ start: new Date(cursor), end: windowEnd });
  }

  // Within free gaps, generate candidate slots of length durationMinutes
  const availableSlots: AvailableSlot[] = [];

  for (const gap of freeGaps) {
    let slotStart = gap.start.getTime();
    while (slotStart + durationMs <= gap.end.getTime()) {
      const slotEnd = slotStart + durationMs;
      availableSlots.push({
        startAt: new Date(slotStart).toISOString(),
        endAt: new Date(slotEnd).toISOString(),
      });
      slotStart += stepMs;
    }
  }

  return availableSlots;
}
