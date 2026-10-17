import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCode } from '../../../scripts/harness.mjs';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => path.join(dir, 'src', f);

test('uses the saved cursor, or the last 30 days on first run', async () => {
  const [saved] = await runCode(src('build-search.js'), { items: [{ key: 'contacts_last_modified', value: '2026-10-01T00:00:00.000Z' }] });
  assert.equal(saved.request_body.filterGroups[0].filters[0].value, String(Date.parse('2026-10-01T00:00:00.000Z')));
  const [first] = await runCode(src('build-search.js'), { items: [{}] });
  const days = (Date.now() - Date.parse(first.since_iso)) / 86400000;
  assert.ok(Math.abs(days - 30) < 0.01);
});

const contact = (id, modified, extra = {}) => ({ id, properties: { email: `${id}@x.com`, firstname: 'F', lastname: String(id), lastmodifieddate: modified, lifecyclestage: 'salesqualifiedlead', hs_lead_status: 'IN_PROGRESS', ...extra } });

test('flattens pages, keeps the newest copy of a contact seen twice, maps labels', async () => {
  const pages = [
    { total: 3, results: [contact('1', '2026-10-10T10:00:00Z'), contact('2', '2026-10-10T11:00:00Z')], paging: { next: { after: '2' } } },
    { total: 3, results: [contact('3', '2026-10-10T12:00:00Z'), contact('1', '2026-10-10T13:00:00Z', { company: 'NewCo' })] },
  ];
  const rows = await runCode(src('map-rows.js'), { items: pages });
  assert.equal(rows.length, 3);
  const one = rows.find((r) => r.hubspot_id === '1');
  assert.equal(one.company, 'NewCo');
  assert.equal(one.lifecycle_stage, 'SQL');
  assert.equal(one.lead_status, 'In progress');
});

test('next cursor = newest lastmodifieddate received, not the clock', async () => {
  const [out] = await runCode(src('next-cursor.js'), {
    items: [{}],
    nodes: { 'Map Rows': [{ last_modified: '2026-10-10T10:00:00Z' }, { last_modified: '2026-10-10T13:00:00.123Z' }] },
  });
  assert.equal(out.value, '2026-10-10T13:00:00.123Z');
  assert.equal(out.rows_synced, 2);
});
