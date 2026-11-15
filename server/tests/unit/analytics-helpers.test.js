import { sentimentIndex } from '../../src/services/analytics.service.js';
import { sellerApprovalEmail } from '../../src/services/email.service.js';
import { csvCell, toCsv } from '../../src/utils/csv.js';
import { buckets, resolveRange, startOfUtcWeek } from '../../src/utils/dates.js';

describe('date ranges', () => {
  const now = new Date('2026-11-15T10:30:00Z');

  it('picks the bucket size from the length of the range', () => {
    expect(resolveRange({ range: '7d' }, now)).toMatchObject({ days: 7, unit: 'day' });
    expect(resolveRange({ range: '30d' }, now)).toMatchObject({ days: 30, unit: 'day' });
    expect(resolveRange({ range: '90d' }, now)).toMatchObject({ unit: 'week' });
    expect(resolveRange({ range: '365d' }, now)).toMatchObject({ unit: 'month' });
  });

  it('starts at the beginning of a UTC day and includes today', () => {
    const { start, end } = resolveRange({ range: '7d' }, now);
    expect(start.toISOString()).toBe('2026-11-09T00:00:00.000Z');
    expect(end).toEqual(now);
  });

  it('supports explicit from/to (to is inclusive) and an explicit interval', () => {
    const r = resolveRange({ from: new Date('2026-11-01'), to: new Date('2026-11-10'), interval: 'week' }, now);
    expect(r.days).toBe(10);
    expect(r.unit).toBe('week');
    expect(r.end.toISOString()).toBe('2026-11-11T00:00:00.000Z');
  });

  it('rejects empty or oversized windows', () => {
    expect(() => resolveRange({ from: new Date('2026-11-10'), to: new Date('2026-11-01') }, now)).toThrow(RangeError);
    expect(() => resolveRange({ from: new Date('2024-01-01'), to: new Date('2026-11-01') }, now)).toThrow(RangeError);
  });

  it('weeks start on Monday', () => {
    expect(startOfUtcWeek(new Date('2026-11-15T10:00:00Z')).toISOString()).toBe('2026-11-09T00:00:00.000Z');
    expect(startOfUtcWeek(new Date('2026-11-09T00:00:00Z')).toISOString()).toBe('2026-11-09T00:00:00.000Z');
  });

  it('creates one bucket per unit with no gaps', () => {
    expect(buckets(resolveRange({ from: new Date('2026-11-01'), to: new Date('2026-11-10') }, now))).toHaveLength(10);
    const months = buckets(resolveRange({ from: new Date('2026-01-15'), to: new Date('2026-04-02'), interval: 'month' }, now));
    expect(months.map((d) => d.toISOString().slice(0, 7))).toEqual(['2026-01', '2026-02', '2026-03', '2026-04']);
  });
});

describe('csv', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(12.5)).toBe('12.5');
  });

  it('defuses spreadsheet formulas (CSV injection) but leaves numbers alone', () => {
    expect(csvCell('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(csvCell('+1234')).toBe("'+1234");
    expect(csvCell('-cmd')).toBe("'-cmd");
    expect(csvCell('@user')).toBe("'@user");
    expect(csvCell(-5)).toBe('-5');
  });

  it('builds a UTF-8 file with a BOM, a header row and CRLF line ends', () => {
    const csv = toCsv([{ key: 'a', label: 'col_a' }, { key: 'b', label: 'col_b' }], [{ a: 1, b: 'x,y' }, { a: 2, b: 'z' }]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv.slice(1)).toBe('col_a,col_b\r\n1,"x,y"\r\n2,z\r\n');
  });
});

describe('sentiment gauge', () => {
  it('maps the -1..1 score to 0..100 (50 is neutral)', () => {
    expect(sentimentIndex(-1)).toBe(0);
    expect(sentimentIndex(0)).toBe(50);
    expect(sentimentIndex(0.4)).toBe(70);
    expect(sentimentIndex(1)).toBe(100);
    expect(sentimentIndex(null)).toBeNull();
  });
});

describe('sellerApprovalEmail', () => {
  const seller = { email: 's@example.com', name: 'S', seller: { businessName: 'Ali <Traders>' } };
  it('tells an approved seller they can list products', () => {
    const mail = sellerApprovalEmail(seller, 'approved');
    expect(mail.subject).toContain('approved');
    expect(mail.html).toContain('Ali &lt;Traders&gt;');
  });
  it('shows the reason on rejection, escaped', () => {
    const mail = sellerApprovalEmail(seller, 'rejected', 'Missing <b>documents</b>');
    expect(mail.html).toContain('Missing &lt;b&gt;documents&lt;/b&gt;');
    expect(mail.html).toContain('hidden');
  });
});
