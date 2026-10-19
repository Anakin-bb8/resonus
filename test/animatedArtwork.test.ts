/**
 * Animated-artwork endpoint: square and tall clips per album, cached per
 * session, nulls for everything else.
 */
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, describe, it } from 'node:test';

import {
  fetchAnimatedArtwork,
  setAnimatedArtworkFetch,
  stripEditionSuffix,
  titlesMatch,
} from '@/lib/animatedArtwork';

describe('fetchAnimatedArtwork', () => {
  let server: Server;
  let hits = 0;
  let base = '';
  after(() => server?.close());

  it('serves square and tall clips', async () => {
    await new Promise<void>((resolve) => {
      server = createServer((req, res) => {
        hits += 1;
        const url = new URL(req.url ?? '', 'http://x');
        // A hand-picked Apple Music URL answers the exact album, no names
        // to check it against: trusted as chosen.
        if (url.pathname.endsWith('/url')) {
          assert.ok((url.searchParams.get('url') ?? '').includes('music.apple.com'));
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({ url: 'https://cdn/picked.m3u8', url_tall: 'https://cdn/picked-tall.m3u8' }),
          );
          return;
        }
        const artist = url.searchParams.get('artist') ?? '';
        const album = url.searchParams.get('album') ?? '';
        res.writeHead(200, { 'content-type': 'application/json' });
        // "Play (Deluxe)" first answers a stranger's cover, then the right
        // one once asked without its packaging.
        if (album === 'Play (Deluxe)') {
          res.end(
            JSON.stringify({
              url: 'https://cdn/x.m3u8',
              url_tall: 'https://cdn/x-tall.m3u8',
              artist: 'Ed Sheeran',
              album: 'X',
            }),
          );
        } else {
          res.end(
            JSON.stringify({
              url: 'https://cdn/play.m3u8',
              url_tall: 'https://cdn/play-tall.m3u8',
              artist,
              album,
            }),
          );
        }
      }).listen(0, '127.0.0.1', () => {
        const address = server.address();
        base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
        resolve();
      });
    });
    assert.deepEqual(await fetchAnimatedArtwork(base, 'An Artist', 'An Album'), {
      square: 'https://cdn/play.m3u8',
      tall: 'https://cdn/play-tall.m3u8',
    });
    // Second ask comes from the session cache: no second request.
    assert.deepEqual(await fetchAnimatedArtwork(base, 'An Artist', 'An Album'), {
      square: 'https://cdn/play.m3u8',
      tall: 'https://cdn/play-tall.m3u8',
    });
    assert.equal(hits, 1);
  });

  it('drops a stranger cover, then finds the deluxe one stripped', async () => {
    const before = hits;
    assert.deepEqual(await fetchAnimatedArtwork(base, 'Ed Sheeran', 'Play (Deluxe)'), {
      square: 'https://cdn/play.m3u8',
      tall: 'https://cdn/play-tall.m3u8',
    });
    assert.equal(hits, before + 2);
  });

  it('asks a hand-picked URL first and trusts it', async () => {
    const before = hits;
    assert.deepEqual(
      await fetchAnimatedArtwork(base, 'Ed Sheeran', 'Play (Deluxe)', 'https://music.apple.com/album/play/123'),
      { square: 'https://cdn/picked.m3u8', tall: 'https://cdn/picked-tall.m3u8' },
    );
    assert.equal(hits, before + 1);
  });

  it('answers null without asking for missing pieces', async () => {
    assert.equal(await fetchAnimatedArtwork('', 'An Artist', 'An Album'), null);
    assert.equal(await fetchAnimatedArtwork(base, '', 'An Album'), null);
    assert.equal(await fetchAnimatedArtwork(base, 'An Artist', ''), null);
    assert.equal(hits, 4);
  });
});

describe('unanswered asks', () => {
  it('are not remembered as albums with no clip', async () => {
    let calls = 0;
    let down = true;
    let now = 1_000_000;
    const realNow = Date.now;
    Date.now = () => now;
    setAnimatedArtworkFetch(async () => {
      calls += 1;
      if (down) throw new Error('no network');
      return {
        ok: true,
        status: 200,
        json: async () => ({ url: 'https://cdn/s.m3u8', url_tall: 'https://cdn/t.m3u8', artist: 'Some One', album: 'Late' }),
      };
    });
    try {
      assert.equal(await fetchAnimatedArtwork('http://art', 'Some One', 'Late'), null);
      // Within the back-off nobody asks again.
      assert.equal(await fetchAnimatedArtwork('http://art', 'Some One', 'Late'), null);
      assert.equal(calls, 1);
      // Past it, with the network back, the album gets its clips.
      down = false;
      now += 3 * 60 * 1000;
      assert.deepEqual(await fetchAnimatedArtwork('http://art', 'Some One', 'Late'), {
        square: 'https://cdn/s.m3u8',
        tall: 'https://cdn/t.m3u8',
      });
      assert.equal(calls, 2);
    } finally {
      Date.now = realNow;
      setAnimatedArtworkFetch((url, init) => fetch(url, init));
    }
  });
});

describe('edition matching', () => {
  it('strips packaging but never the title itself', () => {
    assert.equal(stripEditionSuffix('Play (Deluxe)'), 'Play');
    assert.equal(stripEditionSuffix('Play - Deluxe Edition'), 'Play');
    assert.equal(stripEditionSuffix('X (Remastered 2015)'), 'X');
    assert.equal(stripEditionSuffix('Play'), 'Play');
    assert.equal(stripEditionSuffix("(What's the Story) Morning Glory?"), "(What's the Story) Morning Glory?");
  });

  it('calls the same album the same across editions', () => {
    assert.ok(titlesMatch('Play', 'Play (Deluxe)'));
    assert.ok(titlesMatch('X', 'x'));
    assert.ok(!titlesMatch('Play', 'X'));
    assert.ok(!titlesMatch('Play', '- (Deluxe)'));
  });
});
