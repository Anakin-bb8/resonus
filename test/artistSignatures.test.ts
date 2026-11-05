import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseArtistSignature } from '@/lib/artistSignatures';

const imageUrl = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/signature.svg';
const source = { url: 'https://commons.wikimedia.org/wiki/File:Signature.svg' };
const license = { status: 'known', name: 'PD-signature', url: 'https://commons.wikimedia.org/wiki/Template:PD-signature' };
const response = (item: object = {}) => ({ signatures: [{ asset: { url: imageUrl, width: 1000, height: 300 }, source, license, ...item }] });

describe('artist signature provider boundary', () => {
  it('accepts a documented public-domain asset and preserves source and licence', () => {
    const parsed = parseArtistSignature(response());
    assert.equal(parsed?.imageUrl, imageUrl);
    assert.equal(parsed?.aspect, 1000 / 300);
    assert.ok(parsed?.attribution.includes(source.url));
    assert.ok(parsed?.attribution.includes(license.url));
  });
  it('accepts known CC0 assets', () => {
    assert.ok(parseArtistSignature(response({ license: { status: 'known', name: 'CC0 1.0' } })));
  });
  it('rejects unknown rights and licences without an implemented credit policy', () => {
    for (const value of [null, {}, { status: 'unknown', name: 'PD-signature' }, { status: 'known', name: 'CC BY-SA 4.0' }]) {
      assert.equal(parseArtistSignature(response({ license: value })), null);
    }
  });
  it('requires a source record', () => {
    assert.equal(parseArtistSignature(response({ source: null })), null);
  });
  it('accepts the configured provider but rejects unrelated image hosts', () => {
    const payload = response({ asset: 'https://custom.example/signature.svg' });
    assert.equal(parseArtistSignature(payload), null);
    assert.ok(parseArtistSignature(payload, 'https://custom.example'));
  });
  it('rejects executable, insecure and credentialed asset URLs', () => {
    for (const asset of ['javascript:alert(1)', 'http://upload.wikimedia.org/a.svg', 'https://user:pass@upload.wikimedia.org/a.svg']) {
      assert.equal(parseArtistSignature(response({ asset })), null);
    }
  });
  it('does not guess missing or ambiguous artist responses', () => {
    for (const value of [null, {}, { matches: [{ name: 'Other artist' }] }, { signatures: [] }]) {
      assert.equal(parseArtistSignature(value), null);
    }
  });
  it('bounds extreme artwork proportions', () => {
    assert.equal(parseArtistSignature(response({ asset: { url: imageUrl, width: 1e30, height: 1 } }))?.aspect, 12);
  });
});
