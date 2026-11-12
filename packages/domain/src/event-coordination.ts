import type {
  CoordinationCandidateSlot,
  EventCoordinationOverrides,
  EventCoordinationStatus,
  ExtractedEventConstraints,
  MissingCoordinationConstraint,
  PreferredTimeOfDay,
  WorkingHoursWindow,
} from '@aven/contracts';
import { findAvailableTimeSlots, mergeIntervals, type TimeRange } from './time-intersection.js';

const MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;
const DEFAULT_WORKING_HOURS: WorkingHoursWindow = { startHour: 9, endHour: 18 };

export type ParticipantWorkingHoursRule = {
  principalId: string;
  timeZone: string;
  startHour: number;
  endHour: number;
};

type LocalDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidIanaTimeZone(timeZone: string): boolean {
  const trimmed = timeZone.trim();
  if (!trimmed || trimmed.length > 64) return false;
  try {
    getFormatter(trimmed);
    return true;
  } catch {
    return false;
  }
}

export function getLocalDateParts(date: Date, timeZone: string): LocalDateParts {
  const parts = getFormatter(timeZone).formatToParts(date);
  const map = new Map<string, number>();
  for (const part of parts) {
    if (
      part.type === 'year' ||
      part.type === 'month' ||
      part.type === 'day' ||
      part.type === 'hour' ||
      part.type === 'minute'
    ) {
      map.set(part.type, Number.parseInt(part.value, 10));
    }
  }
  const hour = map.get('hour') ?? 0;
  return {
    year: map.get('year') ?? date.getUTCFullYear(),
    month: map.get('month') ?? date.getUTCMonth() + 1,
    day: map.get('day') ?? date.getUTCDate(),
    hour: hour === 24 ? 0 : hour,
    minute: map.get('minute') ?? date.getUTCMinutes(),
  };
}

/**
 * Converts a local wall-clock timestamp in an IANA time zone to a UTC Date.
 * Uses two-pass offset adjustment so DST transitions are resolved cleanly.
 */
export function zonedWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let candidate = targetAsUtc;
  for (let pass = 0; pass < 2; pass += 1) {
    const observed = getLocalDateParts(new Date(candidate), timeZone);
    const observedAsUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      0,
      0,
    );
    candidate -= observedAsUtc - targetAsUtc;
  }
  return new Date(candidate);
}

/**
 * Generates blocked UTC intervals representing hours outside a participant's local working hours.
 */
export function buildNonWorkingBlockedIntervals(
  windowStart: Date,
  windowEnd: Date,
  rule: { timeZone: string; startHour: number; endHour: number },
): TimeRange[] {
  if (
    !Number.isFinite(windowStart.getTime()) ||
    !Number.isFinite(windowEnd.getTime()) ||
    windowEnd.getTime() <= windowStart.getTime() ||
    !isValidIanaTimeZone(rule.timeZone) ||
    !Number.isInteger(rule.startHour) ||
    !Number.isInteger(rule.endHour) ||
    rule.startHour < 0 ||
    rule.endHour > 24 ||
    rule.startHour >= rule.endHour
  ) {
    return [{ start: windowStart, end: windowEnd }];
  }

  const startLocal = getLocalDateParts(windowStart, rule.timeZone);
  const endLocal = getLocalDateParts(windowEnd, rule.timeZone);

  // Walk local calendar dates from 1 day before startLocal through 1 day after endLocal
  const dayCursor = new Date(Date.UTC(startLocal.year, startLocal.month - 1, startLocal.day - 1));
  const lastDay = new Date(Date.UTC(endLocal.year, endLocal.month - 1, endLocal.day + 1));

  const workingWindows: TimeRange[] = [];
  while (dayCursor.getTime() <= lastDay.getTime()) {
    const y = dayCursor.getUTCFullYear();
    const m = dayCursor.getUTCMonth() + 1;
    const d = dayCursor.getUTCDate();

    const workStart = zonedWallClockToUtc(y, m, d, rule.startHour, 0, rule.timeZone);
    const workEnd =
      rule.endHour === 24
        ? zonedWallClockToUtc(y, m, d + 1, 0, 0, rule.timeZone)
        : zonedWallClockToUtc(y, m, d, rule.endHour, 0, rule.timeZone);

    if (workEnd.getTime() > workStart.getTime()) {
      const clippedStart = Math.max(workStart.getTime(), windowStart.getTime());
      const clippedEnd = Math.min(workEnd.getTime(), windowEnd.getTime());
      if (clippedEnd > clippedStart) {
        workingWindows.push({ start: new Date(clippedStart), end: new Date(clippedEnd) });
      }
    }

    dayCursor.setUTCDate(dayCursor.getUTCDate() + 1);
  }

  const mergedWorking = mergeIntervals(workingWindows);
  const blocked: TimeRange[] = [];
  let cursor = windowStart.getTime();
  for (const work of mergedWorking) {
    if (work.start.getTime() > cursor) {
      blocked.push({ start: new Date(cursor), end: work.start });
    }
    cursor = Math.max(cursor, work.end.getTime());
  }
  if (cursor < windowEnd.getTime()) {
    blocked.push({ start: new Date(cursor), end: windowEnd });
  }
  return blocked;
}

export type ResolvedCoordinationInput = {
  constraints: ExtractedEventConstraints;
  missingConstraints: MissingCoordinationConstraint[];
  clarificationPrompts: string[];
};

const CLARIFICATION_MESSAGES: Record<MissingCoordinationConstraint, string> = {
  windowStart: '请补充希望协调的开始时间范围（例如“明天”或具体的起止日期）。',
  windowEnd: '请补充希望协调的结束时间范围（最多支持 31 天时间窗）。',
  durationMinutes: '请补充本次活动预计时长（例如 30 分钟、60 分钟或 90 分钟）。',
};

export function resolveCoordinationConstraints(
  extracted: ExtractedEventConstraints,
  overrides: EventCoordinationOverrides | undefined,
  defaultTimezone: string,
): ResolvedCoordinationInput {
  const resolvedTzCandidate = overrides?.timezone ?? extracted.timezone ?? defaultTimezone;
  const timezone = isValidIanaTimeZone(resolvedTzCandidate) ? resolvedTzCandidate : defaultTimezone;

  const workingHours = overrides?.workingHours ?? extracted.workingHours ?? DEFAULT_WORKING_HOURS;
  const workingHoursOnly = overrides?.workingHoursOnly ?? extracted.workingHoursOnly ?? true;

  const merged: ExtractedEventConstraints = {
    title: overrides?.title ?? extracted.title,
    durationMinutes: overrides?.durationMinutes ?? extracted.durationMinutes,
    windowStart: overrides?.windowStart ?? extracted.windowStart,
    windowEnd: overrides?.windowEnd ?? extracted.windowEnd,
    timezone,
    workingHoursOnly,
    workingHours,
    preferredTimeOfDay: overrides?.preferredTimeOfDay ?? extracted.preferredTimeOfDay ?? 'any',
    notes: extracted.notes,
  };

  const missingSet = new Set<MissingCoordinationConstraint>();
  const clarificationPrompts: string[] = [];

  if (!merged.windowStart) {
    missingSet.add('windowStart');
  }
  if (!merged.windowEnd) {
    missingSet.add('windowEnd');
  }
  if (merged.windowStart && merged.windowEnd) {
    const startMs = Date.parse(merged.windowStart);
    const endMs = Date.parse(merged.windowEnd);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      missingSet.add('windowStart');
      missingSet.add('windowEnd');
      clarificationPrompts.push('时间范围无效：结束时间必须晚于开始时间，请重新确认起止时间。');
    } else if (endMs - startMs > MAX_WINDOW_MS) {
      missingSet.add('windowEnd');
      clarificationPrompts.push('单次协调时间窗最多支持 31 天，请缩小时间范围。');
    }
  }

  if (
    merged.durationMinutes === null ||
    !Number.isSafeInteger(merged.durationMinutes) ||
    merged.durationMinutes <= 0 ||
    merged.durationMinutes > 31 * 24 * 60
  ) {
    missingSet.add('durationMinutes');
  }

  const missingConstraints = Array.from(missingSet);
  for (const field of missingConstraints) {
    const basePrompt = CLARIFICATION_MESSAGES[field];
    if (basePrompt && !clarificationPrompts.includes(basePrompt)) {
      clarificationPrompts.push(basePrompt);
    }
  }

  return {
    constraints: merged,
    missingConstraints,
    clarificationPrompts,
  };
}

function matchesTimeOfDay(localHour: number, preference: PreferredTimeOfDay): boolean {
  if (preference === 'morning') return localHour >= 6 && localHour < 12;
  if (preference === 'afternoon') return localHour >= 12 && localHour < 18;
  if (preference === 'evening') return localHour >= 18 && localHour < 22;
  return true;
}

function preferenceLabel(preference: PreferredTimeOfDay): string {
  if (preference === 'morning') return '上午';
  if (preference === 'afternoon') return '下午';
  if (preference === 'evening') return '晚间';
  return '全天';
}

export type CoordinateScheduleOptions = {
  extracted: ExtractedEventConstraints;
  overrides?: EventCoordinationOverrides;
  defaultTimezone: string;
  participantIds: string[];
  participantTimezones?: Record<string, string>;
  busyIntervals: TimeRange[];
  maxCandidates?: number;
};

export type CoordinateScheduleResult = {
  status: EventCoordinationStatus;
  resolvedConstraints: ExtractedEventConstraints;
  missingConstraints: MissingCoordinationConstraint[];
  clarificationPrompts: string[];
  candidates: CoordinationCandidateSlot[];
};

export function coordinateEventSchedule(
  options: CoordinateScheduleOptions,
): CoordinateScheduleResult {
  const resolution = resolveCoordinationConstraints(
    options.extracted,
    options.overrides,
    options.defaultTimezone,
  );

  if (resolution.missingConstraints.length > 0) {
    return {
      status: 'needs_clarification',
      resolvedConstraints: resolution.constraints,
      missingConstraints: resolution.missingConstraints,
      clarificationPrompts: resolution.clarificationPrompts,
      candidates: [],
    };
  }

  const windowStart = new Date(resolution.constraints.windowStart as string);
  const windowEnd = new Date(resolution.constraints.windowEnd as string);
  const durationMinutes = resolution.constraints.durationMinutes as number;
  const coordinatorTz = resolution.constraints.timezone ?? options.defaultTimezone;
  const workingHours = resolution.constraints.workingHours ?? DEFAULT_WORKING_HOURS;
  const enforceWorkingHours = resolution.constraints.workingHoursOnly !== false;

  const allBlocked: TimeRange[] = [...options.busyIntervals];
  if (enforceWorkingHours) {
    const distinctZones = new Set<string>();
    for (const participantId of options.participantIds) {
      const tz = options.participantTimezones?.[participantId] ?? coordinatorTz;
      distinctZones.add(tz);
    }
    for (const tz of distinctZones) {
      allBlocked.push(
        ...buildNonWorkingBlockedIntervals(windowStart, windowEnd, {
          timeZone: tz,
          startHour: workingHours.startHour,
          endHour: workingHours.endHour,
        }),
      );
    }
  }

  const rawSlots = findAvailableTimeSlots({
    windowStart,
    windowEnd,
    durationMinutes,
    busyIntervals: allBlocked,
    workingHoursOnly: false,
    stepMinutes: 30,
  });

  if (rawSlots.length === 0) {
    return {
      status: 'no_common_slots',
      resolvedConstraints: resolution.constraints,
      missingConstraints: [],
      clarificationPrompts: [],
      candidates: [],
    };
  }

  const preference = resolution.constraints.preferredTimeOfDay;
  const scored: CoordinationCandidateSlot[] = rawSlots.map((slot) => {
    const start = new Date(slot.startAt);
    const localStart = getLocalDateParts(start, coordinatorTz);
    const matchesPref = matchesTimeOfDay(localStart.hour, preference);
    const score = preference === 'any' ? 0.85 : matchesPref ? 0.95 : 0.65;
    const reasonParts: string[] = ['所有已授权参与者均空闲'];
    if (enforceWorkingHours) {
      reasonParts.push(
        `符合各参与者当地时间段（${workingHours.startHour}:00-${workingHours.endHour}:00）`,
      );
    }
    if (preference !== 'any') {
      reasonParts.push(
        matchesPref
          ? `符合${preferenceLabel(preference)}时段偏好`
          : `非首选${preferenceLabel(preference)}时段，作为备选`,
      );
    }
    return {
      startAt: slot.startAt,
      endAt: slot.endAt,
      score,
      reason: reasonParts.join('；'),
    };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return Date.parse(a.startAt) - Date.parse(b.startAt);
  });

  const limit = Math.min(Math.max(options.maxCandidates ?? 10, 1), 50);

  return {
    status: 'candidates_ready',
    resolvedConstraints: resolution.constraints,
    missingConstraints: [],
    clarificationPrompts: [],
    candidates: scored.slice(0, limit),
  };
}
