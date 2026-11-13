import { describe, expect, it } from 'vitest';
import { dayDividers, groupLabel } from './message-time';

const at = (iso: string) => new Date(iso).getTime();

describe('web conversation time labels', () => {
  it('groups items by day and marks the first item of each day', () => {
    expect(
      dayDividers([
        at('2026-11-13T01:00:00'),
        at('2026-11-13T02:00:00'),
        at('2026-11-14T02:00:00'),
      ]),
    ).toEqual([true, false, true]);
  });
  it('labels today and yesterday by name and older days by date', () => {
    const now = at('2026-11-13T12:00:00');
    expect(groupLabel(at('2026-11-13T03:30:00'), now)).toBe('今天 03:30');
    expect(groupLabel(at('2026-11-12T03:30:00'), now)).toBe('昨天 03:30');
    expect(groupLabel(at('2026-11-01T03:30:00'), now)).toBe('11月1日 03:30');
  });
});
