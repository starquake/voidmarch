import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RegisterError, nameProblem, register } from './name.ts';

test('names follow the server rules', () => {
  for (const name of ['Mo', 'Joost-2', 'space_pilot', 'Zoë', '  Sanne  ', 'x'.repeat(16)]) {
    assert.equal(nameProblem(name), undefined, name);
  }
  assert.match(nameProblem('') ?? '', /Pick a name/);
  assert.match(nameProblem('   ') ?? '', /Pick a name/);
  assert.match(nameProblem('x'.repeat(17)) ?? '', /at most 16/);
  assert.match(nameProblem('Mo!') ?? '', /letters, digits/);
  assert.match(nameProblem('<b>') ?? '', /letters, digits/);
});

const reply =
  (status: number, body: unknown): typeof fetch =>
  () =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));

test('register posts the trimmed name and returns the token', async () => {
  let sent: RequestInit | undefined;
  const fetcher = ((_url: string, init?: RequestInit) => {
    sent = init;

    return Promise.resolve(new Response(JSON.stringify({ token: 'tok' }), { status: 201 }));
  }) as typeof fetch;

  assert.equal(await register('  Mo ', fetcher), 'tok');
  assert.equal(sent?.body, JSON.stringify({ name: 'Mo' }));
  assert.equal((sent.headers as Record<string, string>)['Content-Type'], 'application/json');
});

test('register passes on the server refusal', async () => {
  await assert.rejects(register('Mo', reply(400, { error: 'a name is 1 to 16 letters' })), (err: unknown) => {
    assert.ok(err instanceof RegisterError);
    assert.match(err.message, /a name is/);

    return true;
  });
  await assert.rejects(register('Mo', reply(500, {})), /500/);
});
