/** Chronological chat timeline with centered timestamp separators (Halo style). */
export type TimelineEntry<T> =
  { kind: 'time'; key: string; label: string } | { kind: 'item'; key: string; item: T };

const GAP_MS = 5 * 60 * 1000;

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function hhmm(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** 今天 19:38 / 昨天 19:38 / 11月10日 19:38 / 2025年11月10日 19:38, in the browser's local zone. */
export function formatChatTimestamp(at: number, now: number): string {
  const date = new Date(at);
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(date, today)) return `今天 ${hhmm(date)}`;
  if (sameDay(date, yesterday)) return `昨天 ${hhmm(date)}`;
  const day = `${date.getMonth() + 1}月${date.getDate()}日`;
  if (date.getFullYear() === today.getFullYear()) return `${day} ${hhmm(date)}`;
  return `${date.getFullYear()}年${day} ${hhmm(date)}`;
}

/** Sort by time (stable) and insert a separator before the first item and after 5-minute gaps. */
export function buildTimeline<T extends { key: string; createdAt: number }>(
  items: T[],
  now: number,
): TimelineEntry<T>[] {
  const sorted = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.createdAt - b.item.createdAt || a.index - b.index)
    .map(({ item }) => item);
  const entries: TimelineEntry<T>[] = [];
  let previous: number | undefined;
  for (const item of sorted) {
    if (previous === undefined || item.createdAt - previous >= GAP_MS)
      entries.push({
        kind: 'time',
        key: `time-${item.key}`,
        label: formatChatTimestamp(item.createdAt, now),
      });
    entries.push({ kind: 'item', key: item.key, item });
    previous = item.createdAt;
  }
  return entries;
}

/** Header recall pill: show the last user message once it has scrolled above the header. */
export function recallVisible(
  lastUserBottom: number | null,
  viewportTop: number,
  headerHeight: number,
) {
  if (lastUserBottom === null) return false;
  return lastUserBottom < viewportTop + headerHeight;
}

/** Distance from the bottom under which the transcript counts as "at the latest message". */
export function isNearBottom(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  threshold = 70,
) {
  return scrollHeight - scrollTop - clientHeight < threshold;
}
