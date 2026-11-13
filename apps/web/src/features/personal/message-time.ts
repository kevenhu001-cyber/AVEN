/* 会话时间分隔文案：与参考图一致按天分组，同日只显示时间。 */
const pad = (value: number) => value.toString().padStart(2, '0');

export function dayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function groupLabel(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const key = dayKey(timestamp);
  if (key === dayKey(now)) return `今天 ${time}`;
  if (key === dayKey(now - 24 * 60 * 60 * 1000)) return `昨天 ${time}`;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}

/* 按天分组：返回每项是否需要显示时间分隔（与上一项不同日期）。 */
export function dayDividers(timestamps: number[]): boolean[] {
  const flags: boolean[] = [];
  let previous = '';
  for (const timestamp of timestamps) {
    const key = dayKey(timestamp);
    flags.push(key !== previous);
    previous = key;
  }
  return flags;
}
