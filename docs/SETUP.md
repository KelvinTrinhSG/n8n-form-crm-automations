# Setup

All ten projects share one n8n instance, one Google Sheet (one tab per purpose) and one HubSpot account.
You can set up only the projects you need. Each project README lists exactly what it uses.

## 1. Requirements

- n8n 1.x or 2.x (self-hosted or cloud). Developed against n8n 2.x.
- Node.js 20+ (only for `build`, `test`, `deploy`; n8n does not need it).
- A HubSpot account. The free CRM is enough for everything except custom deal pipelines.

## 2. n8n environment variables

Only needed for projects that verify webhook signatures (02, 09):

| Variable | Why |
|---|---|
| `NODE_FUNCTION_ALLOW_BUILTIN=crypto` | Code nodes may `require('crypto')` for HMAC checks |
| `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` | Code nodes may read the secrets below via `$env` |
| `WEBHOOK_SECRET=...` | Shared secret with your form provider (02) |
| `CALENDLY_SIGNING_KEY=...` | Signing key of your Calendly webhook subscription (09) |

Restart n8n after changing them. If you cannot change env vars (some n8n Cloud plans), move the secret into an n8n credential and verify the signature with the **Crypto** node instead.

## 3. Credentials (n8n → Credentials → Create)

| Credential | Used by | How |
|---|---|---|
| **HubSpot Service Key** | 01, 03–09 | HubSpot → **Development** → **Keys** → create a **service key** (new accounts can no longer create legacy private apps; an existing private app token works the same way). Scopes: `crm.objects.contacts.read`, `crm.objects.contacts.write`, `crm.objects.deals.read`, `crm.objects.deals.write`. Paste it into n8n's *HubSpot Service Key* credential (internal type `hubspotAppToken`) |
| **Google Sheets OAuth2** | all | Google Cloud project → enable Sheets API + Drive API → OAuth client (Web) with the redirect URL shown by n8n |
| **SMTP** | 01, 03, 04, 05, 07, 09, 10 | Gmail: `smtp.gmail.com`, port 465, SSL, an **App Password** |
| **IMAP** | 08 | Gmail: `imap.gmail.com`, port 993, SSL, same App Password |
| **OpenAI** | 08 | platform.openai.com → API keys (needs prepaid credit) |
| **Header Auth** | 10b | Name `X-N8N-API-KEY`, value = n8n API key (Settings → n8n API) |

## 4. Google Sheet tabs

Create one spreadsheet with these tabs. Put the column names in row 1 exactly as written.
`samples/` folders contain example rows where useful.

| Tab | Written by | Read by | Columns |
|---|---|---|---|
| `Leads` | 01, 05 | 05 | email, first_name, last_name, phone, company, job_title, website, message, consent, form_name, page_url, utm_source, utm_medium, utm_campaign, hubspot_contact_id, crm_action, changed_fields, warnings, last_submitted_at, submission_id, sla_level, sla_alerted_at |
| `Failed Syncs` | 01, 03 | 03, 10b | queue_id, created_at, source_workflow, stage, email, payload, attempts, status, next_retry_at, last_error_code, last_error, resolved_at, hubspot_contact_id |
| `Spam Log` | 02 | – | received_at, verdict, ip, email, reasons_text, message_excerpt |
| `Gateway Failures` | 02 | – | received_at, email, payload, error |
| `Sales Reps` | you | 04, 05 | name, email, hubspot_owner_id, active, territories, segments, out_of_office_until |
| `Assignments` | 04 | – | assigned_at, contact_id, email, company, country, segment, owner_name, owner_email, rule |
| `Sync State` | 06 | 06 | key, value, rows_synced, updated_at |
| `CRM Contacts` | 06 | – | hubspot_id, email, name, company, job_title, phone, lifecycle_stage, lead_status, owner_id, deals, created, last_modified, days_since_sales_activity, synced_at |
| `Import Rejects` | 07 | – | imported_at, source, row, email, reason, data |
| `Email Triage` | 08 | – | received_at, message_id, from, subject, intent, confidence, urgency, need_summary, route, ai_status, hubspot_contact_id |
| `Meetings` | 09 | 09 | invitee_uri, status, email, name, company, meeting_name, start_time, host_email, hubspot_contact_id, deal_id, rescheduled_from, cancel_reason, utm_source, updated_at |
| `Error Log` | 10a | – | occurred_at, workflow, node, category, severity, message, execution_url, execution_mode, alert_sent |

`hubspot_owner_id` for `Sales Reps`: HubSpot → Settings → Users & Teams → click a user → the number in the URL, or `GET /crm/v3/owners`.

## 5. Import the workflows

**Option A: n8n UI.** *Workflows → Import from file*, pick `projects/*/workflow*.json`. Import `10a` first and select it as *Error Workflow* in the settings of the others.

**Option B: API** (creates or updates by name, links the error workflow, keeps credentials set in the UI):

```bash
npm run build      # only after editing src/ or workflow.mjs
N8N_URL=http://localhost:5678 N8N_API_KEY=xxx \
SHEET_URL="https://docs.google.com/spreadsheets/d/.../edit" \
SALES_EMAIL=sales@yourco.com OPS_EMAIL=ops@yourco.com FROM_EMAIL=automation@yourco.com \
node scripts/deploy.mjs            # all projects
node scripts/deploy.mjs 01 03      # only some (10 is always included)
```

⚠️ `deploy.mjs` matches nodes by **name** to keep their credentials. Renaming a node in `workflow.mjs` means re-selecting its credential once in the UI.

## 6. Test

- Code logic: `npm test` runs every `projects/*/tests/*.test.mjs` with sample payloads, no n8n needed.
- Webhooks: open the Webhook node → *Listen for test event*, then send the sample payload with the `curl` command from the project README to the **test** URL (`/webhook-test/...`).
- Error Workflow and workflow static data (rate limits, round robin, alert suppression) only work for **active** workflows, not manual test runs.
