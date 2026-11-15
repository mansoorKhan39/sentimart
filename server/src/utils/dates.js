import { MAX_REPORT_DAYS, REPORT_RANGES } from '../config/constants.js';

export const DAY = 86_400_000;

export const startOfUtcDay = (d) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
// Weeks start on Monday (same as MongoDB's startOfWeek: 'monday').
export const startOfUtcWeek = (d) => {
  const day = startOfUtcDay(d);
  return new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY);
};
export const startOfUtcMonth = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

const TRUNCATE = { day: startOfUtcDay, week: startOfUtcWeek, month: startOfUtcMonth };
const NEXT = {
  day: (d) => new Date(d.getTime() + DAY),
  week: (d) => new Date(d.getTime() + 7 * DAY),
  month: (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)),
};

export const bucketKey = (date) => date.toISOString().slice(0, 10);

// Turns ?range=30d or ?from&to into a UTC window [start, end) and a bucket size for charts.
export function resolveRange({ range = '30d', from, to, interval } = {}, now = new Date()) {
  let start;
  let end;
  if (from || to) {
    end = to ? new Date(startOfUtcDay(to).getTime() + DAY) : now;
    start = from ? startOfUtcDay(from) : startOfUtcDay(new Date(end.getTime() - 29 * DAY));
  } else {
    end = now;
    start = new Date(startOfUtcDay(now).getTime() - (REPORT_RANGES[range] - 1) * DAY);
  }
  const days = Math.ceil((end.getTime() - start.getTime()) / DAY);
  if (days < 1 || days > MAX_REPORT_DAYS) throw new RangeError('Invalid date range');
  const unit = interval ?? (days <= 31 ? 'day' : days <= 140 ? 'week' : 'month');
  return { start, end, unit, days };
}

// Every bucket start inside the window, so charts have no gaps (empty days show as 0).
export function buckets({ start, end, unit }) {
  const out = [];
  for (let d = TRUNCATE[unit](start); d < end; d = NEXT[unit](d)) out.push(d);
  return out;
}
