// Shared helpers used by every projects/*/workflow.mjs to describe an n8n workflow in a few lines.
// The JavaScript of Code nodes lives in real .js files (projects/*/src) so it can be reviewed and tested.
// Layout: every workflow gets an overview sticky note plus one colored sticky per stage,
// and every node gets a one-line subtitle on the canvas.
import fs from 'node:fs';
import path from 'node:path';

// Placeholders. deploy.mjs swaps them for real values from environment variables.
export const CONFIG = {
  SHEET_URL: 'https://docs.google.com/spreadsheets/d/PASTE_YOUR_SPREADSHEET_ID/edit',
  SALES_EMAIL: 'sales@example.com',
  OPS_EMAIL: 'ops@example.com',
  FROM_EMAIL: 'automation@example.com',
  N8N_URL: 'http://localhost:5678',
  TIMEZONE: 'America/New_York',
};

// Columns of the shared "Failed Syncs" sheet (written by 01, processed by 03, reported by 10).
export const QUEUE_FIELDS = ['queue_id', 'created_at', 'source_workflow', 'stage', 'email', 'payload', 'attempts',
  'status', 'next_retry_at', 'last_error_code', 'last_error', 'resolved_at', 'hubspot_contact_id'];

export const COLOR ={ yellow: 1, orange: 2, red: 3, green: 4, blue: 5, purple: 6 };

const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const node = (name, type, typeVersion, parameters, extra = {}) =>
  ({ id: slug(name), name, type, typeVersion, position: [0, 0], parameters, ...extra });

// Shows a short subtitle under the node on the canvas.
export const note = (n, text) => Object.assign(n, { notes: text, notesInFlow: true });

// Returns a `code(name, file, mode)` helper bound to one project's src folder.
export const codeFrom = (projectDir) => (name, file, mode = 'all') => node(name, 'n8n-nodes-base.code', 2, {
  ...(mode === 'each' ? { mode: 'runOnceForEachItem' } : {}),
  jsCode: fs.readFileSync(path.join(projectDir, 'src', file), 'utf8'),
});

// ---------- triggers ----------
export const webhook = (name, pathSlug, webhookId, { rawBody = false, method = 'POST' } = {}) =>
  node(name, 'n8n-nodes-base.webhook', 2, {
    httpMethod: method,
    path: pathSlug,
    responseMode: 'responseNode',
    options: rawBody ? { rawBody: true } : {},
  }, { webhookId });

export const schedule = (name, cron) => node(name, 'n8n-nodes-base.scheduleTrigger', 1.2, {
  rule: { interval: [{ field: 'cronExpression', expression: cron }] },
});

export const formTrigger = (name, pathSlug, webhookId, title, description, fields) => node(name, 'n8n-nodes-base.formTrigger', 2.2, {
  formTitle: title,
  formDescription: description,
  formFields: { values: fields },
  options: { path: pathSlug, appendAttribution: false },
}, { webhookId });

export const field = (label, type = 'text', opts = {}) => {
  const f = { fieldLabel: label, fieldType: type, ...opts };
  if (opts.options) { f.fieldOptions = { values: opts.options.map((o) => ({ option: o })) }; delete f.options; }
  return f;
};

export const errorTrigger = (name) => node(name, 'n8n-nodes-base.errorTrigger', 1, {});

export const imapTrigger = (name) => node(name, 'n8n-nodes-base.emailReadImap', 2, {
  mailbox: 'INBOX',
  postProcessAction: 'read',
  format: 'resolved',
  dataPropertyAttachmentsPrefixName: 'attachment_',
  options: { customEmailConfig: '["UNSEEN"]' },
});

// ---------- responses & routing ----------
export const respond = (name, status, bodyExpr) => node(name, 'n8n-nodes-base.respondToWebhook', 1.1, {
  respondWith: 'json',
  responseBody: bodyExpr,
  options: { responseCode: status },
});

const condition = (leftValue, operator, rightValue = '') => ({
  id: slug(`${leftValue}-${operator.operation}-${rightValue}`),
  leftValue,
  rightValue,
  operator,
});
const conditions = (list) => ({
  options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
  conditions: list,
  combinator: 'and',
});

// Output 0 = true, output 1 = false.
export const ifTrue = (name, expr) => node(name, 'n8n-nodes-base.if', 2.2, {
  conditions: conditions([condition(expr, { type: 'boolean', operation: 'true', singleValue: true })]),
  options: {},
});

// One output per key (in order), matched by string equality on `expr`.
export const switchOn = (name, expr, keys) => node(name, 'n8n-nodes-base.switch', 3.2, {
  rules: {
    values: keys.map((k) => ({
      conditions: conditions([condition(expr, { type: 'string', operation: 'equals' }, k)]),
      renameOutput: true,
      outputKey: k,
    })),
  },
  options: {},
});

// ---------- HTTP APIs ----------
export const http = (name, { method = 'GET', url, body, credential, generic, query, options = {} }, extra = {}) =>
  node(name, 'n8n-nodes-base.httpRequest', 4.2, {
    method,
    url,
    ...(credential ? { authentication: 'predefinedCredentialType', nodeCredentialType: credential } : {}),
    ...(generic ? { authentication: 'genericCredentialType', genericAuthType: generic } : {}),
    ...(query ? { sendQuery: true, queryParameters: { parameters: Object.entries(query).map(([n, value]) => ({ name: n, value })) } } : {}),
    ...(body ? { sendBody: true, specifyBody: 'json', jsonBody: body } : {}),
    options: { timeout: 30000, ...options },
  }, extra);

// HubSpot private app token (n8n credential type "HubSpot App Token").
// Default: 3 retries for 429/5xx, then the item goes out of the red error output.
export const hubspot = (name, method, pathExpr, body, extra = {}) => http(name, {
  method,
  url: `=https://api.hubapi.com${pathExpr}`,
  body,
  credential: 'hubspotAppToken',
}, { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000, onError: 'continueErrorOutput', ...extra });

export const openAi = (name) => http(name, {
  method: 'POST',
  url: 'https://api.openai.com/v1/chat/completions',
  body: '={{ JSON.stringify($json.requestBody) }}',
  credential: 'openAiApi',
  options: { timeout: 60000 },
}, { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000, onError: 'continueRegularOutput' });

// ---------- Google Sheets ----------
const sheetRef = (tab) => ({
  documentId: { __rl: true, value: CONFIG.SHEET_URL, mode: 'url' },
  sheetName: { __rl: true, value: tab, mode: 'name' },
});

// Writes explicit columns (no auto-mapping, so stray fields never create surprise columns).
// operation: append | appendOrUpdate | update. `match` is the key column for appendOrUpdate/update.
export const sheetsWrite = (name, tab, { operation = 'append', match, fields, from = '$json' }) =>
  node(name, 'n8n-nodes-base.googleSheets', 4.5, {
    operation,
    ...sheetRef(tab),
    columns: {
      mappingMode: 'defineBelow',
      value: Object.fromEntries(fields.map((f) => [f, from === '$json' ? `={{ $json.${f} }}` : `={{ (${from}).${f} }}`])),
      matchingColumns: match ? [match] : [],
      schema: fields.map((f) => ({ id: f, displayName: f, required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true })),
    },
    options: {},
  });

export const sheetsRead = (name, tab, extra = {}) => node(name, 'n8n-nodes-base.googleSheets', 4.5, {
  ...sheetRef(tab),
  options: {},
}, { alwaysOutputData: true, ...extra });

export const sheetsLookup = (name, tab, column, valueExpr) => node(name, 'n8n-nodes-base.googleSheets', 4.5, {
  ...sheetRef(tab),
  filtersUI: { values: [{ lookupColumn: column, lookupValue: valueExpr }] },
  options: {},
}, { alwaysOutputData: true });

// ---------- other nodes ----------
export const email = (name, { to = CONFIG.SALES_EMAIL, subject = '={{ $json.email_subject }}', html = '={{ $json.email_html }}' } = {}, extra = {}) =>
  node(name, 'n8n-nodes-base.emailSend', 2.1, {
    fromEmail: CONFIG.FROM_EMAIL,
    toEmail: to,
    subject,
    emailFormat: 'html',
    html,
    options: { appendAttribution: false },
  }, extra);

export const extractCsv = (name, binaryExpr) => node(name, 'n8n-nodes-base.extractFromFile', 1, {
  operation: 'csv',
  binaryPropertyName: binaryExpr,
  options: {},
});

// ---------- connections ----------
// connect(from, to, output) — output 1 is the false branch of an IF or the error output of a node.
export function connections() {
  const c = {};
  const connect = (from, to, output = 0) => {
    const f = typeof from === 'string' ? from : from.name;
    const t = typeof to === 'string' ? to : to.name;
    c[f] ??= { main: [] };
    while (c[f].main.length <= output) c[f].main.push([]);
    c[f].main[output].push({ node: t, type: 'main', index: 0 });
  };
  const chain = (...nodes) => { for (let i = 0; i < nodes.length - 1; i++) connect(nodes[i], nodes[i + 1]); };
  return { c, connect, chain };
}

// ---------- layout ----------
const STEP_X = 240;
const STEP_Y = 200;
const ROW_Y = 400;
const PAD_X = 70;
const HEADER = 150;
const NODE = 100;
const FOOTER = 130;
const GAP = 40;

const sticky = (name, content, color, [x, y], width, height) => ({
  id: slug(name), name, type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
  position: [x, y], parameters: { content, color, width, height },
});

// Places nodes left-to-right by stage and wraps each stage in a colored sticky note.
// A stage's `nodes` is a list of columns; a column is a node or an array of stacked nodes.
export function layout(title, overview, stages) {
  const maxRows = Math.max(...stages.flatMap((s) => s.nodes.map((c) => (Array.isArray(c) ? c.length : 1))));
  const top = ROW_Y - HEADER - ((maxRows - 1) * STEP_Y) / 2;
  const height = HEADER + NODE + FOOTER + (maxRows - 1) * STEP_Y;

  const notes = [];
  let x = 0;
  for (const [i, s] of stages.entries()) {
    const cols = s.nodes.map((c) => (Array.isArray(c) ? c : [c]));
    cols.forEach((col, ci) => col.forEach((n, ri) => {
      n.position = [x + PAD_X + ci * STEP_X, ROW_Y + (ri - (col.length - 1) / 2) * STEP_Y];
    }));
    const width = PAD_X * 2 + (cols.length - 1) * STEP_X + NODE;
    notes.push(sticky(`Stage ${i + 1} · ${s.title}`, `## ${s.title}\n${s.body}`, s.color, [x, top], width, height));
    x += width + GAP;
  }

  const overviewWidth = 460;
  notes.unshift(sticky(`Overview · ${title}`, overview, COLOR.yellow, [-overviewWidth - GAP, top], overviewWidth, Math.max(height, 640)));
  return notes;
}

// Builds the final workflow object. `stages` drive the layout; every node in them is included.
export function workflow(name, { overview, stages, connections: conn, settings = {} }) {
  const nodes = stages.flatMap((s) => s.nodes.flat());
  return {
    name,
    nodes: [...layout(name.split(' · ').slice(1).join(' · ') || name, overview, stages), ...nodes],
    connections: conn,
    settings: { executionOrder: 'v1', timezone: CONFIG.TIMEZONE, saveManualExecutions: true, ...settings },
  };
}
