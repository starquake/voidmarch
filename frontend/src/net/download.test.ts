import assert from 'node:assert/strict';
import { test } from 'node:test';

import { download } from './download.ts';

/** A fetch that answers with body in the given chunks, or with status and no body. */
function fake(chunks: number[][], status = 200): typeof fetch {
  return () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new Uint8Array(chunk));
        }
        controller.close();
      },
    });

    return Promise.resolve(new Response(status === 200 ? body : null, { status }));
  };
}

test('it counts the bytes in as each chunk arrives, and returns them all', async () => {
  const seen: number[] = [];
  const body = await download('/static/x', (bytes) => seen.push(bytes), fake([[1, 2], [3], [4, 5, 6]]));
  assert.deepEqual(seen, [2, 3, 6]);
  assert.deepEqual([...body], [1, 2, 3, 4, 5, 6]);
});

test('an empty body counts nothing', async () => {
  const seen: number[] = [];
  const body = await download('/static/x', (bytes) => seen.push(bytes), fake([]));
  assert.deepEqual(seen, []);
  assert.equal(body.byteLength, 0);
});

test('a failed response is an error', async () => {
  await assert.rejects(download('/static/x', () => undefined, fake([], 404)), /error downloading \/static\/x: 404/);
});

test('a response without a stream is read whole', async () => {
  const fetcher: typeof fetch = () => Promise.resolve({ ok: true, body: null, arrayBuffer: () => Promise.resolve(new Uint8Array([7, 8]).buffer) } as Response);
  assert.deepEqual([...(await download('/static/x', () => undefined, fetcher))], [7, 8]);
});
