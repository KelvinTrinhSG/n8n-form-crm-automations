import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runCode } from '../../../scripts/harness.mjs';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => path.join(dir, 'src', f);
const SECRET = 'test-secret';

const signedRequest = (bodyObj, { secret = SECRET, ts = Math.floor(Date.now() / 1000) } = {}) => {
  const raw = JSON.stringify(bodyObj);
  const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex');
  return {
    json: { headers: { 'x-signature': sig, 'x-timestamp': String(ts), 'x-forwarded-for': '203.0.113.7' }, body: bodyObj },
    binary: { data: { data: Buffer.from(raw).toString('base64') } },
  };
};
const verify = (item, env = { WEBHOOK_SECRET: SECRET }) => runCode(src('verify-signature.js'), { items: [item], env });

test('accepts a correctly signed request', async () => {
  const [out] = await verify(signedRequest({ email: 'a@b.com' }));
  assert.equal(out.verdict, 'ok');
});

test('rejects a wrong secret, an old timestamp and a missing secret', async () => {
  assert.equal((await verify(signedRequest({ a: 1 }, { secret: 'other' })))[0].verdict, 'rejected');
  const [old] = await verify(signedRequest({ a: 1 }, { ts: Math.floor(Date.now() / 1000) - 3600 }));
  assert.match(old.reason, /too old/);
  const [noSecret] = await verify(signedRequest({ a: 1 }), {});
  assert.match(noSecret.reason, /misconfigured/);
});

test('accepts the Typeform signature format', async () => {
  const raw = '{"event_id":"01H","form_response":{}}';
  const sig = 'sha256=' + crypto.createHmac('sha256', SECRET).update(raw).digest('base64');
  const [out] = await verify({ json: { headers: { 'typeform-signature': sig }, body: JSON.parse(raw) }, binary: { data: { data: Buffer.from(raw).toString('base64') } } });
  assert.equal(out.verdict, 'ok');
});

const filter = (body, staticData = {}, ip = '198.51.100.1') =>
  runCode(src('spam-filter.js'), { items: [{ verdict: 'ok', headers: { 'x-forwarded-for': ip }, body }], staticData });

test('honeypot alone is enough to mark spam, and it is stripped before forwarding', async () => {
  const [out] = await filter({ email: 'bot@x.com', website_url: 'http://spam.example' });
  assert.equal(out.verdict, 'spam');
});

test('one weak signal passes, two weak signals are spam', async () => {
  const [one] = await filter({ email: 'joe@mailinator.com', message: 'Hi, need a quote' });
  assert.equal(one.verdict, 'accepted');
  const [two] = await filter({ email: 'joe@mailinator.com', message: 'We offer SEO services for you', _rendered_at: Date.now() - 500 });
  assert.equal(two.verdict, 'spam');
  assert.equal(two.reasons.length, 3);
});

test('detects a double submit and rate-limits one IP', async () => {
  const state = {};
  const body = { email: 'ann@acme.com', message: 'Please call me', _rendered_at: Date.now() - 20000 };
  assert.equal((await filter(body, state))[0].verdict, 'accepted');
  const [dup] = await filter(body, state);
  assert.equal(dup.verdict, 'duplicate');
  assert.equal(dup.forward_body._rendered_at, undefined);

  const flood = {};
  let last;
  for (let i = 0; i < 6; i++) [last] = await filter({ email: `u${i}@acme.com`, message: `m${i}` }, flood, '192.0.2.9');
  assert.equal(last.verdict, 'rate_limited');
});
