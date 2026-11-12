import jwt from 'jsonwebtoken';
import { randomToken, sha256, signAccessToken, verifyAccessToken } from '../../src/utils/tokens.js';
import { parsePagination } from '../../src/utils/pagination.js';

describe('tokens', () => {
  it('sha256 is deterministic and hex', () => {
    expect(sha256('abc')).toBe(sha256('abc'));
    expect(sha256('abc')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('randomToken has the requested size and is unique', () => {
    expect(randomToken(32)).toHaveLength(64);
    expect(randomToken()).not.toBe(randomToken());
  });

  it('access token round-trips and carries subject and role', () => {
    const payload = verifyAccessToken(signAccessToken({ _id: 'u1', role: 'seller' }));
    expect(payload.sub).toBe('u1');
    expect(payload.role).toBe('seller');
  });

  it('rejects a token signed with another secret', () => {
    const forged = jwt.sign({ role: 'admin' }, 'another-secret-another-secret-12345', {
      subject: 'u1',
    });
    expect(() => verifyAccessToken(forged)).toThrow();
  });
});

describe('pagination', () => {
  it('caps limit at 50 and defaults page to 1', () => {
    expect(parsePagination({ limit: '999', page: '0' })).toEqual({ page: 1, limit: 50, skip: 0 });
  });
  it('computes skip', () => {
    expect(parsePagination({ page: '3', limit: '10' }).skip).toBe(20);
  });
});
