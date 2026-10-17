import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runCode } from '../../../scripts/harness.mjs';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => path.join(dir, 'src', f);

// Tiny CSV reader for the sample file (n8n's Extract From File does this in the real workflow).
const readCsv = (file) => {
  const [header, ...lines] = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  const cols = header.split(',');
  return lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
};
const form = { 'List Source': 'SaaS Expo 2026', 'Your Email': 'me@example.com' };

test('sample CSV: 3 contacts, 2 rejects, 1 merged duplicate, blank line ignored', async () => {
  const rows = readCsv(path.join(dir, 'samples', 'expo-leads.csv'));
  const out = await runCode(src('clean-rows.js'), { items: rows, nodes: { 'Upload Lead List': [form] } });
  assert.equal(out.length, 1);
  const { stats, rejects, request_body } = out[0];
  assert.deepEqual({ valid: stats.valid, rejected: stats.rejected, merged: stats.duplicates_merged }, { valid: 3, rejected: 2, merged: 1 });
  assert.deepEqual(rejects.map((r) => [r.row, r.reason]), [[5, 'invalid email'], [8, 'missing email']]);
  const maria = request_body.inputs.find((i) => i.id === 'maria.lopez@northwind.io').properties;
  assert.equal(maria.jobtitle, 'Head of Sales');          // first copy wins, blanks filled from second
  const tom = request_body.inputs.find((i) => i.id === 'tom.becker@contoso.de').properties;
  assert.equal(tom.jobtitle, undefined);                  // blank never sent
});

test('splits 250 contacts into batches of 100, report data on the first only', async () => {
  const rows = Array.from({ length: 250 }, (_, i) => ({ Email: `p${i}@acme.com` }));
  const out = await runCode(src('clean-rows.js'), { items: rows, nodes: { 'Upload Lead List': [form] } });
  assert.deepEqual(out.map((b) => b.request_body.inputs.length), [100, 100, 50]);
  assert.ok(out[0].stats && !out[1].stats);
});

test('report counts created/updated and lists every email of a failed batch', async () => {
  const prepared = [
    { has_batches: true, batch: 1, emails: ['a@x.com', 'b@x.com'], stats: { source: 'S', uploaded_by: 'me@example.com', total_rows: 4, duplicates_merged: 0 }, rejects: [{ row: 3, email: '', reason: 'missing email' }] },
    { has_batches: true, batch: 2, emails: ['c@x.com'] },
  ];
  const responses = [
    { status: 'COMPLETE', results: [{ id: '1', new: true }, { id: '2', new: false }] },
    { error: { message: '502 - Bad Gateway' } },
  ];
  const [out] = await runCode(src('import-report.js'), { items: responses, nodes: { 'Clean, Validate & Dedupe': prepared } });
  assert.match(out.email_subject, /1 created, 1 updated, 2 need attention/);
  assert.equal(out.rejects.find((r) => r.email === 'c@x.com').reason.startsWith('batch 2 failed'), true);
});

test('file with no valid rows still produces a report', async () => {
  const prepared = [{ has_batches: false, stats: { source: 'S', uploaded_by: 'me@example.com', total_rows: 1, duplicates_merged: 0 }, rejects: [{ row: 2, email: 'x', reason: 'invalid email' }] }];
  const [out] = await runCode(src('import-report.js'), { items: prepared, nodes: { 'Clean, Validate & Dedupe': prepared } });
  assert.match(out.email_subject, /0 created, 0 updated, 1 need attention/);
});
