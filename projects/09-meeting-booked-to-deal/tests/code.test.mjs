import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runCode } from '../../../scripts/harness.mjs';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => path.join(dir, 'src', f);
const KEY = 'calendly-test-key';
const created = JSON.parse(fs.readFileSync(path.join(dir, 'samples', 'invitee-created.json'), 'utf8'));

const signed = (body, { key = KEY, t = Math.floor(Date.now() / 1000) } = {}) => {
  const raw = JSON.stringify(body);
  const v1 = crypto.createHmac('sha256', key).update(`${t}.${raw}`).digest('hex');
  return { json: { headers: { 'calendly-webhook-signature': `t=${t},v1=${v1}` }, body }, binary: { data: { data: Buffer.from(raw).toString('base64') } } };
};
const parse = (item) => runCode(src('verify-parse.js'), { items: [item], env: { CALENDLY_SIGNING_KEY: KEY } }).then((r) => r[0]);

test('valid booking is parsed with answers mapped to CRM fields', async () => {
  const ev = await parse(signed(created));
  assert.equal(ev.valid, true);
  assert.equal(ev.kind, 'booked');
  assert.equal(ev.company, 'Vela Logistics');
  assert.deepEqual(ev.contact_properties, { email: 'marco.rossi@vela-logistics.com', firstname: 'Marco', lastname: 'Rossi', company: 'Vela Logistics', phone: '+39 02 1234 5678' });
  assert.equal(ev.deal_name, 'Vela Logistics · 30-min Demo');
});

test('bad signature is rejected', async () => {
  assert.equal((await parse(signed(created, { key: 'wrong' }))).reason, 'bad signature');
});

test('the cancel half of a reschedule is ignored, a real cancel is not', async () => {
  const resched = { event: 'invitee.canceled', payload: { ...created.payload, rescheduled: true } };
  assert.equal((await parse(signed(resched))).kind, 'ignored');
  const cancel = { event: 'invitee.canceled', payload: { ...created.payload, cancellation: { reason: 'Budget frozen', canceled_by: 'Marco Rossi' } } };
  assert.equal((await parse(signed(cancel))).kind, 'canceled');
});

test('webhook retry for a known invitee stops the flow', async () => {
  const ev = await parse(signed(created));
  const out = await runCode(src('check-existing.js'), { items: [{ invitee_uri: ev.invitee_uri, deal_id: '1' }], nodes: { 'Verify & Parse Event': [ev] } });
  assert.deepEqual(out, []);
});

test('reschedule reuses the old deal and writes two rows, one email', async () => {
  const body = { event: 'invitee.created', payload: { ...created.payload, uri: 'https://api.calendly.com/scheduled_events/EV2/invitees/INV2', old_invitee: created.payload.uri } };
  const ev = await parse(signed(body));
  const [checked] = await runCode(src('check-existing.js'), {
    items: [{ invitee_uri: created.payload.uri, deal_id: '8800', hubspot_contact_id: '501', start_time: '2026-10-20T14:00:00Z' }],
    nodes: { 'Verify & Parse Event': [ev] },
  });
  assert.equal(checked.mode, 'reschedule');
  assert.equal(checked.deal_id, '8800');

  const rows = await runCode(src('build-meeting.js'), { nodes: { 'Check Existing Booking': [checked] } });
  assert.deepEqual(rows.map((r) => [r.status, r.deal_id]), [['Rescheduled', '8800'], ['Moved', '8800']]);
  assert.match(rows[0].email_subject, /^🔁 Rescheduled/);
});

test('retry of an already processed reschedule stops the flow', async () => {
  const body = { event: 'invitee.created', payload: { ...created.payload, uri: 'https://api.calendly.com/scheduled_events/EV2/invitees/INV2', old_invitee: created.payload.uri } };
  const ev = await parse(signed(body));
  const out = await runCode(src('check-existing.js'), {
    items: [{ invitee_uri: created.payload.uri, status: 'Moved', deal_id: '8800', hubspot_contact_id: '501' }],
    nodes: { 'Verify & Parse Event': [ev] },
  });
  assert.deepEqual(out, []);
});

test('new booking takes ids from the HubSpot responses', async () => {
  const ev = await parse(signed(created));
  const [checked] = await runCode(src('check-existing.js'), { items: [{}], nodes: { 'Verify & Parse Event': [ev] } });
  const [row] = await runCode(src('build-meeting.js'), {
    nodes: { 'Check Existing Booking': [checked], 'HubSpot · Upsert Contact': [{ results: [{ id: '601' }] }], 'HubSpot · Create Deal': [{ id: '9900' }] },
  });
  assert.equal(row.status, 'Booked');
  assert.equal(row.deal_id, '9900');
  assert.equal(row.hubspot_contact_id, '601');
});

test('cancellation without a known deal still notifies, without a deal update', async () => {
  const cancel = await parse(signed({ event: 'invitee.canceled', payload: { ...created.payload, cancellation: { reason: 'Went with another vendor', canceled_by: 'Marco Rossi' } } }));
  const [out] = await runCode(src('build-cancellation.js'), { items: [{}], nodes: { 'Verify & Parse Event': [cancel] } });
  assert.equal(out.has_deal, false);
  assert.equal(out.status, 'Canceled');
  assert.match(out.cancel_reason, /Went with another vendor/);
});
