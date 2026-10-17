// Creates or updates every workflow on an n8n instance through the public API, matched by workflow name.
// Credentials, Sheet URLs and email addresses already set in the n8n UI are kept on update.
// 10a · Error Handler is deployed first and set as the Error Workflow of all the others.
//
// Usage:
//   N8N_URL=http://localhost:5678 N8N_API_KEY=... node scripts/deploy.mjs [01 02 ...]
// Optional (replace the placeholders in the workflow JSON):
//   SHEET_URL=https://docs.google.com/spreadsheets/d/.../edit
//   SALES_EMAIL=sales@yourco.com  OPS_EMAIL=ops@yourco.com  FROM_EMAIL=automation@yourco.com
//   N8N_PUBLIC_URL=https://n8n.yourco.com   (used inside workflows 02 and 10b)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from './lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const { N8N_URL = 'http://localhost:5678', N8N_API_KEY } = env;
if (!N8N_API_KEY) throw new Error('Set N8N_API_KEY');
const only = process.argv.slice(2);

const api = async (method, route, body) => {
  const res = await fetch(`${N8N_URL}/api/v1${route}`, {
    method,
    headers: { 'X-N8N-API-KEY': N8N_API_KEY, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${route} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
};

const REPLACE = [
  [CONFIG.SHEET_URL, env.SHEET_URL],
  [CONFIG.SALES_EMAIL, env.SALES_EMAIL],
  [CONFIG.OPS_EMAIL, env.OPS_EMAIL],
  [CONFIG.FROM_EMAIL, env.FROM_EMAIL],
  [CONFIG.N8N_URL, env.N8N_PUBLIC_URL],
].filter(([, value]) => value);

const files = fs.readdirSync(path.join(root, 'projects')).sort()
  .filter((dir) => !only.length || only.some((o) => dir.startsWith(o)) || dir.startsWith('10'))
  .flatMap((dir) => fs.readdirSync(path.join(root, 'projects', dir))
    .filter((f) => /^workflow.*\.json$/.test(f))
    .map((f) => path.join(root, 'projects', dir, f)));

const load = (file) => {
  let raw = fs.readFileSync(file, 'utf8');
  for (const [from, to] of REPLACE) raw = raw.replaceAll(from, to);
  return JSON.parse(raw);
};

const existing = (await api('GET', '/workflows?limit=250')).data;

const upsert = async (wf) => {
  const current = existing.find((w) => w.name === wf.name);
  if (!current) {
    const created = await api('POST', '/workflows', wf);
    console.log(`created  ${created.id}  ${wf.name}`);
    return created;
  }
  for (const n of wf.nodes) {
    const old = current.nodes.find((o) => o.name === n.name);
    if (!old) continue;
    if (old.credentials) n.credentials = old.credentials;
    if (n.parameters.documentId && !env.SHEET_URL) n.parameters.documentId = old.parameters.documentId;
    if (n.type.endsWith('emailSend')) {
      if (!env.FROM_EMAIL) n.parameters.fromEmail = old.parameters.fromEmail;
      if (!env.SALES_EMAIL && !env.OPS_EMAIL) n.parameters.toEmail = old.parameters.toEmail;
    }
  }
  const updated = await api('PUT', `/workflows/${current.id}`, wf);
  console.log(`updated  ${updated.id}  ${wf.name}`);
  return updated;
};

const workflows = files.map(load);
const handler = workflows.find((w) => w.name.startsWith('10a'));
const handlerSaved = await upsert(handler);
for (const wf of workflows.filter((w) => w !== handler)) {
  wf.settings.errorWorkflow = handlerSaved.id;
  await upsert(wf);
}
