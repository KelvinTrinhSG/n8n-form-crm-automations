// Validates the AI answer before anything touches the CRM.
//   - Unknown intent / missing confidence / broken JSON → "needs_review", never auto-created.
//   - The sender address from the email header is the identity. The AI never decides the email.
//   - Only sales inquiries and partnerships with confidence ≥ 0.6 go to HubSpot.
const MIN_CONFIDENCE = 0.6;
const INTENTS = ['sales_inquiry', 'partnership', 'support', 'job_application', 'vendor_pitch', 'spam', 'other'];
const URGENCY = ['low', 'medium', 'high'];
const mail = $('Thread Check').item.json;

let ai = {};
let aiStatus = 'ok';
try {
  ai = JSON.parse($json.choices[0].message.content);
} catch (e) {
  aiStatus = `needs_review: ${$json.error ? 'OpenAI call failed' : 'AI response was not valid JSON'}`;
}

const str = (v, max = 120) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const intent = INTENTS.includes(ai.intent) ? ai.intent : '';
const confidence = Math.max(0, Math.min(1, Number(ai.confidence) || 0));
if (aiStatus === 'ok' && !intent) aiStatus = 'needs_review: unknown intent';

// A phone the AI "found" must contain enough digits to be real.
const phone = str(ai.phone, 40);
const phoneOk = phone.replace(/\D/g, '').length >= 7;
const nameFromHeader = mail.sender_name.split(' ');

const properties = {
  email: mail.sender_email,
  firstname: str(ai.first_name, 60) || nameFromHeader[0] || '',
  lastname: str(ai.last_name, 60) || nameFromHeader.slice(1).join(' '),
  company: str(ai.company),
  jobtitle: str(ai.job_title),
  phone: phoneOk ? phone : '',
  website: str(ai.website),
};
for (const k of Object.keys(properties)) if (!properties[k]) delete properties[k];

const toCrm = aiStatus === 'ok' && ['sales_inquiry', 'partnership'].includes(intent) && confidence >= MIN_CONFIDENCE;

return {
  json: {
    ...mail,
    intent: intent || 'unknown',
    confidence,
    urgency: URGENCY.includes(ai.urgency) ? ai.urgency : 'low',
    need_summary: str(ai.need_summary, 300),
    ai_status: aiStatus,
    route: toCrm ? 'crm' : 'review',
    properties,
  },
};
