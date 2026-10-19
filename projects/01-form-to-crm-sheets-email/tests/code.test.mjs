import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runCode } from '../../../scripts/harness.mjs';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => path.join(dir, 'src', f);
const sample = (f) => JSON.parse(fs.readFileSync(path.join(dir, 'samples', f), 'utf8'));

test('normalizes a messy Webflow-style submission', async () => {
  const [out] = await runCode(src('normalize-lead.js'), { items: [{ body: sample('webflow-submission.json'), query: {} }] });
  assert.equal(out.valid, true);
  assert.equal(out.lead.email, 'jane.doe@gmail.com');           // trimmed, lowercased, typo fixed
  assert.equal(out.lead.first_name, 'Jane');                     // "JANE DOE" split + recased
  assert.equal(out.lead.last_name, 'Doe');
  assert.equal(out.lead.phone, '+14155550123');                  // (415) 555-0123 → E.164
  assert.equal(out.lead.website, 'https://brightdesk.io');      // scheme added, path removed
  assert.equal(out.lead.utm_source, 'google');
  assert.match(out.warnings.join(), /gmial\.com → gmail\.com/);
});

test('rejects a submission without a valid email', async () => {
  const [out] = await runCode(src('normalize-lead.js'), { items: [{ body: { name: 'Bob', email: 'bob@' } }] });
  assert.equal(out.valid, false);
  assert.match(out.errors[0], /not valid/);
});

test('guesses the website from a business email domain only', async () => {
  const [biz] = await runCode(src('normalize-lead.js'), { items: [{ body: { 'Work Email': 'tom@acme-tools.com' } }] });
  assert.equal(biz.lead.website, 'https://acme-tools.com');
  const [free] = await runCode(src('normalize-lead.js'), { items: [{ body: { email: 'tom@yahoo.com' } }] });
  assert.equal(free.lead.website, '');
});

const lead = { email: 'jane@brightdesk.io', first_name: 'Jane', last_name: 'Doe', company: 'BrightDesk', website: 'https://brightdesk.io', phone: '+14155550123', job_title: 'COO', message: 'Need a demo' };

test('new contact: all fields + lifecycle lead', async () => {
  const [out] = await runCode(src('build-crm-payload.js'), { items: [{ total: 0, results: [] }], nodes: { 'Normalize & Validate': [{ lead }] } });
  assert.equal(out.action, 'create');
  assert.equal(out.properties.lifecyclestage, 'lead');
  assert.equal(out.properties.firstname, 'Jane');
});

test('existing customer: no blank overwrite, no stage downgrade, sales-edited name kept', async () => {
  const existing = { id: '501', properties: { email: lead.email, firstname: 'Janet', lastname: 'Doe', company: '', phone: '+14155550000', lifecyclestage: 'customer' } };
  const [out] = await runCode(src('build-crm-payload.js'), {
    items: [{ total: 1, results: [existing] }],
    nodes: { 'Normalize & Validate': [{ lead: { ...lead, job_title: '' } }] },
  });
  assert.equal(out.action, 'update');
  assert.equal(out.contact_id, '501');
  assert.equal(out.properties.firstname, undefined);      // kept "Janet"
  assert.equal(out.properties.company, 'BrightDesk');     // was empty → filled
  assert.equal(out.properties.phone, '+14155550123');     // form wins
  assert.equal(out.properties.jobtitle, undefined);       // blank never sent
  assert.equal(out.properties.lifecyclestage, undefined); // customer stays customer
});

test('upsert that found an existing contact is reported as update', async () => {
  const [row] = await runCode(src('collect-result.js'), {
    items: [{ results: [{ id: '777', new: false }] }],
    nodes: {
      'Build CRM Payload': [{ action: 'create', contact_id: '', changed_fields: [] }],
      'Normalize & Validate': [{ lead: { ...lead, consent: true }, warnings: [], received_at: '2026-10-17T10:00:00.000Z' }],
    },
  });
  assert.equal(row.crm_action, 'update');
  assert.equal(row.hubspot_contact_id, '777');
  assert.equal(row.consent, 'yes');
});

test('notification email escapes visitor input', async () => {
  const [out] = await runCode(src('build-email.js'), { items: [{ ...lead, message: '<script>alert(1)</script>', crm_action: 'create', form_name: 'contact' }] });
  assert.ok(!out.email_html.includes('<script>'));
  assert.ok(out.email_html.includes('&lt;script&gt;'));
  assert.equal(out.email_subject, 'New lead: Jane Doe (BrightDesk)');
});

test('failed sync keeps the payload even when the search step failed', async () => {
  const [row] = await runCode(src('prepare-failed-sync.js'), {
    items: [{ error: { message: 'The service is receiving too many requests from you', httpCode: '429' } }],
    nodes: { 'Normalize & Validate': [{ lead }] },
    prevNode: 'HubSpot · Find Contact',
  });
  assert.equal(row.status, 'pending');
  assert.equal(row.last_error_code, '429');
  assert.equal(row.stage, 'HubSpot · Find Contact');
  assert.equal(JSON.parse(row.payload).email, lead.email);
});

test('a resent submission_id is skipped; generated ids never count as seen', async () => {
  const staticData = {};
  const run = (body) => runCode(src('check-seen.js'), {
    items: [{ valid: true, lead }], staticData, nodes: { 'Lead Form Webhook': [{ body, query: {} }] },
  });
  const [first] = await run({ email: lead.email, submission_id: 'gw-123' });
  const [again] = await run({ email: lead.email, submission_id: 'gw-123' });
  const [noId1] = await run({ email: lead.email });
  const [noId2] = await run({ email: lead.email });
  assert.equal(first.duplicate, false);
  assert.equal(again.duplicate, true);
  assert.equal(noId1.duplicate, false);
  assert.equal(noId2.duplicate, false);
  assert.deepEqual(Object.keys(staticData.processed), ['gw-123']);
});

test('failed sync reads the status code from the live n8n error shape (cause.message)', async () => {
  const [row] = await runCode(src('prepare-failed-sync.js'), {
    items: [{ error: {
      message: 'Bad request - please check your parameters',
      description: 'No properties found to update, please provide at least one.',
      cause: { name: 'AxiosError', message: '400 - "{\\"status\\":\\"error\\",\\"category\\":\\"VALIDATION_ERROR\\"}"' },
    } }],
    nodes: { 'Normalize & Validate': [{ lead }] },
    prevNode: 'HubSpot · Update Contact',
  });
  assert.equal(row.last_error_code, '400');
});
