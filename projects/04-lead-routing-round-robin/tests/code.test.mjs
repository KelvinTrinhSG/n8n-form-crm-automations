import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCode } from '../../../scripts/harness.mjs';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => path.join(dir, 'src', f);

const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const reps = [
  { name: 'Alice', email: 'alice@example.com', hubspot_owner_id: 51001, active: 'TRUE', territories: 'US,CA', segments: 'smb' },
  { name: 'Ben', email: 'ben@example.com', hubspot_owner_id: 51002, active: 'TRUE', territories: 'US,CA', segments: 'smb' },
  { name: 'Chloe', email: 'chloe@example.com', hubspot_owner_id: 51003, active: 'TRUE', territories: 'GB,DE', segments: 'smb', out_of_office_until: tomorrow },
  { name: 'Daniel', email: 'daniel@example.com', hubspot_owner_id: 51004, active: 'TRUE', territories: '*', segments: 'enterprise' },
  { name: 'Eva', email: 'eva@example.com', hubspot_owner_id: 51005, active: 'TRUE', territories: '*', segments: 'smb,enterprise' },
  { name: 'Frank', email: 'frank@example.com', hubspot_owner_id: 51006, active: 'FALSE', territories: 'US', segments: 'smb' },
];
const route = (body, staticData = {}) => runCode(src('choose-owner.js'), { items: reps, nodes: { 'Route Lead Webhook': [{ body }] }, staticData });

test('US small business rotates between the two US reps, skipping inactive Frank', async () => {
  const state = {};
  const owners = [];
  for (let i = 0; i < 4; i++) owners.push((await route({ email: `l${i}@x.com`, country: 'United States', employees: '20' }, state))[0].owner.email);
  assert.deepEqual(owners, ['alice@example.com', 'ben@example.com', 'alice@example.com', 'ben@example.com']);
});

test('enterprise lead goes to enterprise reps only', async () => {
  const [out] = await route({ email: 'cto@big.com', country: 'US', employees: '2,500' });
  assert.equal(out.segment, 'enterprise');
  assert.ok(['daniel@example.com', 'eva@example.com'].includes(out.owner.email));
});

test('UK lead falls back to the global pool while the UK rep is out of office', async () => {
  const [out] = await route({ email: 'a@shop.co.uk', country: 'UK', employees: '10' });
  assert.equal(out.owner.email, 'eva@example.com');
  assert.match(out.rule, /global pool/);
});

test('out-of-office date works in the formats Google Sheets returns (US date, serial number)', async () => {
  const [y, m, d] = tomorrow.split('-');
  const serial = String(Math.round((Date.parse(tomorrow) - Date.UTC(1899, 11, 30)) / 86400000));
  for (const value of [`${Number(m)}/${Number(d)}/${y}`, serial]) {
    const withDate = reps.map((r) => (r.name === 'Chloe' ? { ...r, out_of_office_until: value } : r));
    const [out] = await runCode(src('choose-owner.js'), { items: withDate, nodes: { 'Route Lead Webhook': [{ body: { email: 'a@shop.co.uk', country: 'UK' } }] } });
    assert.equal(out.owner.email, 'eva@example.com', `Chloe must be skipped when the date reads "${value}"`);
  }
  const back = reps.map((r) => (r.name === 'Chloe' ? { ...r, out_of_office_until: '1/2/2020' } : r));
  const [out] = await runCode(src('choose-owner.js'), { items: back, nodes: { 'Route Lead Webhook': [{ body: { email: 'a@shop.co.uk', country: 'UK' } }] } });
  assert.equal(out.owner.email, 'chloe@example.com');
});

test('existing HubSpot owner is never replaced', async () => {
  const [out] = await route({ email: 'x@y.com', country: 'US', current_owner_id: '51004' });
  assert.equal(out.changed, false);
  assert.equal(out.owner.name, 'Daniel');
  assert.match(out.assigned_at, /Z$/, 'kept-owner rows are timestamped in UTC like the others');
  const [mail] = await runCode(src('build-emails.js'), { nodes: { 'Choose Owner': [out] } });
  assert.match(mail.email_subject, /^Your contact got back in touch/);
  assert.equal(mail.email_to, 'daniel@example.com');
});

test('no match → unassigned, and the manager gets the email', async () => {
  const [choice] = await runCode(src('choose-owner.js'), { items: reps.slice(0, 2), nodes: { 'Route Lead Webhook': [{ body: { email: 'a@b.de', country: 'Germany' } }] } });
  assert.equal(choice.assigned, false);
  const [mail] = await runCode(src('build-emails.js'), { nodes: { 'Choose Owner': [choice] } });
  assert.match(mail.email_subject, /Unassigned lead/);
});
