/**
 * The request deadline that keeps running while the answer is read (R3): a
 * server that sends its headers and then stalls must still time out.
 */
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { DeadlineError, withDeadline } from '@/api/deadline';

let server: Server;
let base = '';

before(async () => {
  server = createServer((req, res) => {
    if (req.url === '/stall') {
      // Headers and the first bytes, then nothing: the shape that used to hang.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{"subsonic-response":');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

describe('withDeadline', () => {
  it('gives the answer back when it arrives in time', async () => {
    const json = await withDeadline(1000, async (signal) => (await fetch(`${base}/ok`, { signal })).json());
    assert.deepEqual(json, { ok: true });
  });

  it('times out a body that stalls after the headers', async () => {
    const started = Date.now();
    await assert.rejects(
      withDeadline(200, async (signal) => {
        const res = await fetch(`${base}/stall`, { signal });
        assert.equal(res.status, 200); // the headers did arrive
        return res.json();
      }),
      DeadlineError,
    );
    assert.ok(Date.now() - started < 2000);
  });

  it('passes other failures through as they are', async () => {
    await assert.rejects(
      withDeadline(1000, async () => {
        throw new TypeError('not a timeout');
      }),
      TypeError,
    );
  });
});
