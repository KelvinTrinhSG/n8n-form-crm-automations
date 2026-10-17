import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COLOR, codeFrom, note, formTrigger, field, extractCsv, ifTrue, hubspot, sheetsWrite, email, connections, workflow,
} from '../../scripts/lib.mjs';

const code = codeFrom(path.dirname(fileURLToPath(import.meta.url)));

const upsert = hubspot('HubSpot · Batch Upsert', 'POST', '/crm/v3/objects/contacts/batch/upsert',
  '={{ JSON.stringify($json.request_body) }}', { onError: 'continueRegularOutput' });
// One request per second: well under HubSpot's 100 requests / 10 s, leaves room for other workflows.
upsert.parameters.options.batching = { batch: { batchSize: 1, batchInterval: 1000 } };

const n = {
  form: note(formTrigger('Upload Lead List', 'import-leads', '2b9c7e15-4f8a-4d36-b1e2-7a6c5d4e3f07',
    'Import a lead list into HubSpot', 'Upload a CSV (event, webinar, LinkedIn export). You will get an email with the result.', [
      field('Lead List (CSV)', 'file', { requiredField: true, acceptFileTypes: '.csv', multipleFiles: false }),
      field('List Source', 'text', { requiredField: true, placeholder: 'e.g. SaaS Expo Austin 2026' }),
      field('Your Email', 'email', { requiredField: true }),
    ]), 'Internal form · /form/import-leads'),
  parse: note(extractCsv('Parse CSV', '={{ Object.keys($binary)[0] }}'), 'Header row → one item per row'),
  clean: note(code('Clean, Validate & Dedupe', 'clean-rows.js'), 'Aliases · reject bad · merge duplicates · 100/batch'),
  any: note(ifTrue('Any Valid Rows?', '={{ $json.has_batches }}'), 'Empty file still gets a report'),
  upsert: note(upsert, '1 batch/s · 3 retries · failures reported'),
  report: note(code('Build Import Report', 'import-report.js'), 'Created · updated · rejected'),
  mail: note(email('Email Report to Uploader', { to: '={{ $json.email_to }}' }), 'To the person who uploaded'),
  split: note(code('Split Rejected Rows', 'rejected-rows.js'), 'One item per bad row'),
  log: note(sheetsWrite('Log Rejected Rows', 'Import Rejects', { fields: ['imported_at', 'source', 'row', 'email', 'reason', 'data'] }), 'Tab "Import Rejects" · fix & re-upload'),
};

const { c, connect, chain } = connections();
chain(n.form, n.parse, n.clean, n.any);
connect(n.any, n.upsert, 0);
connect(n.any, n.report, 1);
connect(n.upsert, n.report);
connect(n.report, n.mail);
connect(n.report, n.split);
connect(n.split, n.log);

export default [{
  file: 'workflow.json',
  workflow: workflow('07 · Bulk CSV Import: clean → dedupe → HubSpot batch upsert → report', {
    connections: c,
    overview: `# 📤 07 · Bulk CSV Import
**After an event, upload the lead list once. The workflow cleans it, imports it without duplicates and emails a report.**

### Problem it solves
A 400-row CSV from a trade show: mixed headers, blank lines, typos, the same person twice, people who are already customers. Cleaning in Excel and importing by hand takes hours and still creates duplicates.

### What it does
1. Internal form: upload CSV + source name
2. Map any header naming to HubSpot fields
3. **Reject** rows without a valid email (reason kept)
4. **Merge** duplicates inside the file
5. HubSpot **batch upsert** by email, 100 per call, 1 call/s
6. Report: created / updated / rejected → email + **Import Rejects** tab

### Why dedupe before HubSpot
One duplicated email inside a batch makes HubSpot reject **the whole batch**.

### Never lose rows
A failed batch (after 3 retries) is listed email by email in the report. Partial errors (207) are reported too.

### Setup
- 🔑 **HubSpot App Token**, **Google Sheets**, **SMTP**`,
    stages: [
      { title: '① Upload', color: COLOR.green, body: 'n8n form with a file field.', nodes: [n.form] },
      { title: '② Clean', color: COLOR.orange, body: 'Parse, map, validate, dedupe, batch.', nodes: [n.parse, n.clean, n.any] },
      { title: '③ Import', color: COLOR.purple, body: 'Upsert by email, rate-limited.', nodes: [n.upsert] },
      { title: '④ Report', color: COLOR.blue, body: 'Email the uploader, log rejects.', nodes: [n.report, [n.mail, n.split], n.log] },
    ],
  }),
}];
