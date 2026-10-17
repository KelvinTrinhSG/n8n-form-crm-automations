import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COLOR, codeFrom, note, schedule, sheetsRead, sheetsWrite, hubspot, connections, workflow,
} from '../../scripts/lib.mjs';

const code = codeFrom(path.dirname(fileURLToPath(import.meta.url)));
const ROW_FIELDS = ['hubspot_id', 'email', 'name', 'company', 'job_title', 'phone', 'lifecycle_stage', 'lead_status', 'owner_id',
  'deals', 'created', 'last_modified', 'days_since_sales_activity', 'synced_at'];

const search = hubspot('HubSpot · Search Changed Contacts', 'POST', '/crm/v3/objects/contacts/search',
  '={{ JSON.stringify($json.request_body) }}', { onError: 'stopWorkflow' });
// Follow paging.next.after until HubSpot stops returning it. 250 ms between pages keeps us under
// the search endpoint's per-second limit; 50 pages = 5,000 contacts per run at most.
search.parameters.options.pagination = {
  pagination: {
    paginationMode: 'updateAParameterInEachRequest',
    parameters: { parameters: [{ type: 'body', name: 'after', value: '={{ $response.body.paging?.next?.after }}' }] },
    paginationCompleteWhen: 'other',
    completeExpression: '={{ !$response.body.paging?.next?.after }}',
    limitPagesFetched: true,
    maxRequests: 50,
    requestInterval: 250,
  },
};

const n = {
  cron: note(schedule('Every Hour', '5 * * * *'), 'Minute 5 of every hour'),
  state: note(sheetsRead('Read Sync State', 'Sync State'), 'Tab "Sync State" · key/value'),
  build: note(code('Build Search Request', 'build-search.js'), 'lastmodifieddate ≥ cursor'),
  search: note(search, 'Paginated · 100/page · max 50 pages'),
  map: note(code('Map Rows', 'map-rows.js'), 'Flatten pages · dedupe · labels'),
  write: note(sheetsWrite('Upsert CRM Contacts Sheet', 'CRM Contacts', { operation: 'appendOrUpdate', match: 'hubspot_id', fields: ROW_FIELDS }), 'Tab "CRM Contacts" · key = hubspot_id'),
  cursor: note(code('Compute Next Cursor', 'next-cursor.js'), 'Only after a successful write'),
  save: note(sheetsWrite('Save Sync State', 'Sync State', { operation: 'appendOrUpdate', match: 'key', fields: ['key', 'value', 'rows_synced', 'updated_at'] }), 'Cursor moves forward'),
};

const { c, chain } = connections();
chain(n.cron, n.state, n.build, n.search, n.map, n.write, n.cursor, n.save);

export default [{
  file: 'workflow.json',
  workflow: workflow('06 · Incremental Sync: HubSpot contacts → Google Sheets (cursor + pagination)', {
    connections: c,
    overview: `# 🔄 06 · HubSpot → Sheets Incremental Sync
**A Google Sheet that mirrors HubSpot contacts, refreshed every hour, without re-downloading everything.**

### Problem it solves
Managers and finance want CRM data in a spreadsheet for pivots and Looker Studio. Someone exports a CSV every Monday, so the sheet is always stale.

### How it works
1. Read the **cursor** (last \`lastmodifieddate\` synced)
2. HubSpot **search**: changed since cursor, oldest first, **paginated**
3. Flatten pages, **dedupe**, translate internal values to labels
4. **Upsert** rows by \`hubspot_id\`
5. Save the new cursor, **only after** the write succeeded

### Edge cases handled
- Contact edited while paging → appears twice → newest kept
- Same-millisecond edits → \`GTE\` + upsert, never skipped
- Search cap (10,000) → backlog caught up over several runs
- First run / reset → last 30 days

### Why one-way
Two-way sync needs conflict rules (who wins if both changed?). HubSpot stays the source of truth; the sheet is read-only reporting.

### Setup
- 🔑 **HubSpot App Token** (\`crm.objects.contacts.read\`), **Google Sheets**`,
    stages: [
      { title: '① Schedule', color: COLOR.green, body: 'Hourly.', nodes: [n.cron] },
      { title: '② Where did we stop?', color: COLOR.orange, body: 'Cursor from the Sync State tab.', nodes: [n.state, n.build] },
      { title: '③ Fetch changes', color: COLOR.purple, body: 'All pages, rate-limited.', nodes: [n.search, n.map] },
      { title: '④ Write & advance', color: COLOR.blue, body: 'Upsert rows, then move the cursor.', nodes: [n.write, n.cursor, n.save] },
    ],
  }),
}];
