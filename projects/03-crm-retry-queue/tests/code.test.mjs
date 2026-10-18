import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCode } from '../../../scripts/harness.mjs';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => path.join(dir, 'src', f);
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();

test('picks only pending rows that are due, oldest first', async () => {
  const rows = [
    { queue_id: 'Q2', status: 'pending', created_at: ago(30), next_retry_at: ago(1), email: 'b@x.com', payload: '{"email":"b@x.com"}', attempts: '1' },
    { queue_id: 'Q1', status: 'pending', created_at: ago(90), next_retry_at: ago(5), email: 'a@x.com', payload: '{"email":"a@x.com"}', attempts: '2' },
    { queue_id: 'Q3', status: 'pending', created_at: ago(10), next_retry_at: ago(-20), email: 'c@x.com', payload: '{}' },
    { queue_id: 'Q4', status: 'resolved', created_at: ago(200), next_retry_at: '', email: 'd@x.com', payload: '{}' },
    {},  // empty sheet row (alwaysOutputData)
  ];
  const out = await runCode(src('pick-due.js'), { items: rows });
  assert.deepEqual(out.map((r) => r.queue_id), ['Q1', 'Q2']);
  assert.equal(out[0].attempts, 2);
  assert.equal(out[0].request_body.inputs[0].idProperty, 'email');
});

const pick = { queue_id: 'Q1', email: 'a@x.com', attempts: 2, source_workflow: '01' };
const fail = (error, attempts = 2) => runCode(src('next-retry.js'), {
  mode: 'each', items: [{ error }], nodes: { 'Pick Due Retries': [{ ...pick, attempts }] },
});

test('429 is retried later with backoff', async () => {
  const [out] = await fail({ message: 'Too many requests', httpCode: '429' });
  assert.equal(out.status, 'pending');
  assert.equal(out.attempts, 3);
  const delayMin = (Date.parse(out.next_retry_at) - Date.now()) / 60000;
  assert.ok(delayMin >= 59 && delayMin <= 61.1, `third attempt waits ~60 min, got ${delayMin}`);
  assert.equal(out.escalate, false);
});

test('400 is dead immediately and escalated', async () => {
  const [out] = await fail({ message: 'Bad request - Property values were not valid', httpCode: '400' });
  assert.equal(out.status, 'dead');
  assert.equal(out.escalate, true);
});

// Error item exactly as n8n's HTTP Request node emitted it on 2026-10-18 (no httpCode field).
const liveInvalidEmail = {
  message: 'Bad request - please check your parameters',
  name: 'NodeApiError',
  description: 'Property values were not valid: [{"isValid":false,"message":"Email address bad is invalid","error":"INVALID_EMAIL","name":"email"}]',
  context: {},
  cause: { name: 'AxiosError', message: '400 - "{\\"status\\":\\"error\\",\\"category\\":\\"VALIDATION_ERROR\\"}"' },
};

test('live n8n error shape: status code is read from cause.message', async () => {
  const [out] = await fail(liveInvalidEmail, 0);
  assert.equal(out.last_error_code, '400');
  assert.equal(out.error_kind, 'permanent');
  assert.equal(out.status, 'dead');
  assert.equal(out.escalate, true);
});

test('401 keeps retrying but escalates on the first failure only', async () => {
  const [first] = await fail({ message: 'Authentication credentials not found', httpCode: '401' }, 0);
  assert.equal(first.status, 'pending');
  assert.equal(first.escalate, true);
  const [second] = await fail({ message: '401 - unauthorized' }, 1);
  assert.equal(second.escalate, false);
});

test('gives up after 6 attempts', async () => {
  const [out] = await fail({ message: 'ETIMEDOUT' }, 5);
  assert.equal(out.status, 'dead');
  assert.equal(out.next_retry_at, '');
});

test('resolved row keeps the HubSpot id', async () => {
  const [out] = await runCode(src('mark-resolved.js'), {
    mode: 'each', items: [{ status: 'COMPLETE', results: [{ id: '9001', new: true }] }], nodes: { 'Pick Due Retries': [pick] },
  });
  assert.equal(out.status, 'resolved');
  assert.equal(out.hubspot_contact_id, '9001');
});
