import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONFIG, COLOR, codeFrom, note, webhook, respond, switchOn, http, sheetsWrite, connections, workflow,
} from '../../scripts/lib.mjs';

const code = codeFrom(path.dirname(fileURLToPath(import.meta.url)));
const LOG_FIELDS = ['received_at', 'verdict', 'ip', 'email', 'reasons_text', 'message_excerpt'];
const logFrom = "{ ...$json, reasons_text: $json.reasons.join('; ') }";

const n = {
  hook: note(webhook('Secure Intake Webhook', 'secure-intake', '5c2e9a41-7d3b-4e10-8f6a-1b2c3d4e5f02', { rawBody: true }), 'POST /webhook/secure-intake · raw body'),
  verify: note(code('Verify Signature', 'verify-signature.js'), 'HMAC-SHA256 · timing-safe · 5 min window'),
  filter: note(code('Spam & Duplicate Filter', 'spam-filter.js'), 'Honeypot · speed · rate limit · dedupe'),
  route: note(switchOn('Route by Verdict', '={{ $json.verdict }}', ['rejected', 'rate_limited', 'spam', 'duplicate', 'accepted']), '5 outcomes'),
  r401: note(respond('Respond 401', 401, '={{ JSON.stringify({ ok: false, error: "unauthorized" }) }}'), 'No details leaked'),
  r429: note(respond('Respond 429', 429, '={{ JSON.stringify({ ok: false, error: "too many requests" }) }}'), 'Slow down'),
  rSpam: note(respond('Respond 200 (spam)', 200, '={{ JSON.stringify({ ok: true }) }}'), 'Looks normal to the bot'),
  rDup: note(respond('Respond 200 (duplicate)', 200, '={{ JSON.stringify({ ok: true, duplicate: true }) }}'), 'Idempotent'),
  rOk: note(respond('Respond 202', 202, '={{ JSON.stringify({ ok: true }) }}'), 'Accepted'),
  log: note(sheetsWrite('Log Blocked Request', 'Spam Log', { fields: LOG_FIELDS, from: logFrom }), 'Tab "Spam Log" · review weekly'),
  forward: note(http('Forward to Lead Pipeline', {
    method: 'POST',
    url: `${CONFIG.N8N_URL}/webhook/lead-form`,
    body: '={{ JSON.stringify($json.forward_body) }}',
  }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 2000, onError: 'continueErrorOutput' }), '→ project 01 webhook'),
  failed: note(sheetsWrite('Log Forward Failure', 'Gateway Failures', {
    fields: ['received_at', 'email', 'payload', 'error'],
    from: "{ ...$('Spam & Duplicate Filter').item.json, payload: JSON.stringify($('Spam & Duplicate Filter').item.json.forward_body), error: $json.error?.message || $json.error }",
  }), 'Tab "Gateway Failures" · replay'),
};

const { c, connect, chain } = connections();
chain(n.hook, n.verify, n.filter, n.route);
[n.r401, n.r429, n.rSpam, n.rDup, n.rOk].forEach((r, i) => connect(n.route, r, i));
connect(n.r429, n.log);
connect(n.rSpam, n.log);
connect(n.rOk, n.forward);
connect(n.forward, n.failed, 1);

export default [{
  file: 'workflow.json',
  workflow: workflow('02 · Secure Webhook Gateway: signature, spam, rate limit, duplicates', {
    connections: c,
    overview: `# 🛡️ 02 · Secure Webhook Gateway
**Sits in front of the lead pipeline. Only signed, human, first-time submissions reach the CRM.**

### Problem it solves
A public webhook URL gets found. Bots post junk, the same form is submitted twice, the provider retries on timeouts. Each one becomes a fake or duplicate CRM contact that someone deletes by hand.

### Checks, in order
1. **Signature** (HMAC-SHA256, timing-safe, 5-min replay window) → 401
2. **Rate limit** 5 / IP / 10 min → 429
3. **Spam**: honeypot, filled in < 3 s, disposable domain, link count, spam phrases → 200 (silent)
4. **Duplicate**: same submission id, or same email + message within 10 min → 200
5. Otherwise → 202 and forwarded to **01**

### Setup
- Env: \`WEBHOOK_SECRET\`, \`NODE_FUNCTION_ALLOW_BUILTIN=crypto\`, \`N8N_BLOCK_ENV_ACCESS_IN_NODE=false\`
- 🔑 **Google Sheets** → *Log Blocked Request*, *Log Forward Failure*

### Why spam gets 200
A 4xx tells the bot it was detected, and it adapts. A normal 200 does not.`,
    stages: [
      { title: '① Receive', color: COLOR.green, body: 'Raw body kept for the signature.', nodes: [n.hook] },
      { title: '② Verify & filter', color: COLOR.orange, body: 'Signature first, then spam and duplicate rules.', nodes: [n.verify, n.filter, n.route] },
      { title: '③ Respond', color: COLOR.blue, body: 'Each outcome gets the right HTTP status.', nodes: [[n.r401, n.r429, n.rSpam, n.rDup, n.rOk]] },
      { title: '④ Log & forward', color: COLOR.purple, body: 'Blocked requests logged.\nGood ones forwarded to 01.', nodes: [[n.log, n.forward]] },
      { title: '⑤ Failure path', color: COLOR.red, body: 'Pipeline down → keep the payload for replay.', nodes: [n.failed] },
    ],
  }),
}];
