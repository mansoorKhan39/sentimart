import crypto from 'node:crypto';
import { detectImageType } from '../../src/utils/imageType.js';
import { escapeRegex, slugify } from '../../src/utils/strings.js';
import { signParams } from '../../src/services/upload.service.js';

describe('slugify', () => {
  it('makes URL-safe slugs', () => {
    expect(slugify('Home & Kitchen')).toBe('home-kitchen');
    expect(slugify('  Café   Déco  ')).toBe('cafe-deco');
  });
  it('returns an empty string when nothing usable is left', () => {
    expect(slugify('!!!')).toBe('');
  });
});

describe('escapeRegex', () => {
  it('neutralises regex metacharacters', () => {
    const pattern = new RegExp(escapeRegex('.*(a+)+$'), 'i');
    expect(pattern.test('x.*(a+)+$y')).toBe(true);
    expect(pattern.test('aaaa')).toBe(false);
  });
});

describe('detectImageType', () => {
  const pad = Buffer.alloc(16);
  it('recognises JPEG, PNG and WebP by signature', () => {
    expect(detectImageType(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), pad]))).toBe('image/jpeg');
    expect(
      detectImageType(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pad])),
    ).toBe('image/png');
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), pad]);
    expect(detectImageType(webp)).toBe('image/webp');
  });
  it('rejects other content, even if the file name says .png', () => {
    expect(detectImageType(Buffer.from('%PDF-1.7 this is a pdf file'))).toBeNull();
    expect(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(detectImageType(Buffer.alloc(4))).toBeNull();
  });
});

describe('cloudinary signature', () => {
  it('sorts params alphabetically, joins with & and appends the secret (sha1)', () => {
    const expected = crypto
      .createHash('sha1')
      .update('folder=sentimart/products&timestamp=1700000000my-secret')
      .digest('hex');
    expect(signParams({ timestamp: 1700000000, folder: 'sentimart/products' }, 'my-secret')).toBe(expected);
  });
});
