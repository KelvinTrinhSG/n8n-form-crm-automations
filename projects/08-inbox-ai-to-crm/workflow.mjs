import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COLOR, codeFrom, note, imapTrigger, ifTrue, openAi, hubspot, sheetsWrite, connections, workflow,
} from '../../scripts/lib.mjs';

const code = codeFrom(path.dirname(fileURLToPath(import.meta.url)));
const TRIAGE_FIELDS = ['received_at', 'message_id', 'from', 'subject', 'intent', 'confidence', 'urgency', 'need_summary', 'route', 'ai_status', 'hubspot_contact_id'];

const n = {
  imap: note(imapTrigger('New Email in Inbox'), 'IMAP · UNSEEN · marks as read'),
  pre: note(code('Pre-filter Email', 'prefilter.js', 'each'), 'Skip auto-replies, newsletters, threads'),
  worth: note(ifTrue('Worth Parsing?', '={{ $json.worth_parsing }}'), 'No AI cost for noise'),
  prompt: note(code('Build AI Prompt', 'build-prompt.js', 'each'), 'Email wrapped as data'),
  ai: note(openAi('OpenAI · Classify & Extract'), 'gpt-4.1-mini · JSON · 3 retries'),
  parse: note(code('Parse AI Result', 'parse-ai.js', 'each'), 'Validate · sender = identity'),
  toCrm: note(ifTrue('Send to CRM?', "={{ $json.route === 'crm' }}"), 'Sales/partner · confidence ≥ 0.6'),
  upsert: note(hubspot('HubSpot · Upsert Contact', 'POST', '/crm/v3/objects/contacts/batch/upsert',
    "={{ JSON.stringify({ inputs: [{ idProperty: 'email', id: $json.properties.email, properties: $json.properties }] }) }}"), 'By sender email'),
  noteBody: note(code('Build Note', 'build-note.js', 'each'), 'Email + AI summary'),
  createNote: note(hubspot('HubSpot · Create Note', 'POST', '/crm/v3/objects/notes',
    '={{ JSON.stringify($json.request_body) }}', { onError: 'continueRegularOutput' }), 'On the contact timeline'),
  rowCrm: note(code('Triage Row (CRM)', 'triage-row.js', 'each'), 'Audit row'),
  rowReview: note(code('Triage Row (Review)', 'triage-row.js', 'each'), 'Human to-do'),
  log: note(sheetsWrite('Log to Email Triage', 'Email Triage', { fields: TRIAGE_FIELDS }), 'Tab "Email Triage"'),
};

const { c, connect, chain } = connections();
chain(n.imap, n.pre, n.worth);
connect(n.worth, n.prompt, 0);
chain(n.prompt, n.ai, n.parse, n.toCrm);
connect(n.toCrm, n.upsert, 0);
connect(n.toCrm, n.rowReview, 1);
connect(n.upsert, n.noteBody, 0);
connect(n.upsert, n.rowReview, 1); // HubSpot failed → human to-do, the email is not lost
chain(n.noteBody, n.createNote, n.rowCrm, n.log);
connect(n.rowReview, n.log);

export default [{
  file: 'workflow.json',
  workflow: workflow('08 · Inbox → AI Classify & Extract → HubSpot Contact + Note → Triage Sheet', {
    connections: c,
    overview: `# 📧 08 · Inbox → AI → CRM
**Leads that arrive by plain email (info@, sales@) become HubSpot contacts with the email on their timeline.**

### Problem it solves
Not every lead uses the form. Someone reads the shared inbox, decides what is a real inquiry, retypes the name and company into HubSpot and pastes the email as a note. **≈ 4 min per email**, and inquiries get buried under newsletters.

### Flow
1. IMAP trigger on new (unseen) mail
2. **Rules first**: skip auto-replies, bounces, newsletters, replies, internal mail
3. **AI** classifies intent + extracts name, company, phone
4. **Code validates** the AI output
5. Sales inquiry / partnership, confidence ≥ 0.6 → HubSpot contact + **note**
6. Everything else → **Email Triage** tab for a human

### Safety
- Email is wrapped as data; instructions inside it are ignored
- Identity = header sender, never AI output
- AI failure → \`needs_review\`, not auto-created
- HubSpot failure → review row, the email is not lost

### Setup
- 🔑 **IMAP** (Gmail: App Password, imap.gmail.com:993), **OpenAI**, **HubSpot Service Key** (+ \`crm.objects.contacts.write\`), **Google Sheets**
- Edit \`OWN_DOMAINS\` in *Pre-filter Email*`,
    stages: [
      { title: '① Receive', color: COLOR.green, body: 'Shared inbox over IMAP.', nodes: [n.imap] },
      { title: '② Rules filter', color: COLOR.orange, body: 'Free and instant. Drops most noise.', nodes: [n.pre, n.worth] },
      { title: '③ AI + validation', color: COLOR.purple, body: 'AI suggests. Code decides.', nodes: [n.prompt, n.ai, n.parse, n.toCrm] },
      { title: '④ CRM', color: COLOR.blue, body: 'Contact + note on timeline.\nRed output → review.', nodes: [[n.upsert, n.rowReview], n.noteBody, n.createNote, n.rowCrm, n.log] },
    ],
  }),
}];
