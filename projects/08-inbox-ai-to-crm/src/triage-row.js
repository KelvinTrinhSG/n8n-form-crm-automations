// One row per parsed email in the "Email Triage" tab, whichever branch it took.
// Review rows are the to-do list for a human; CRM rows are the audit trail.
const p = $('Parse AI Result').item.json;
let contactId = '';
try { contactId = $('Build Note').item.json.contact_id || ''; } catch (e) { /* review branch: no contact */ }

return {
  json: {
    received_at: p.received_at,
    message_id: p.message_id,
    from: p.sender_email,
    subject: p.subject,
    intent: p.intent,
    confidence: p.confidence,
    urgency: p.urgency,
    need_summary: p.need_summary,
    // "crm" but no contact id = HubSpot failed after retries; the row becomes a manual to-do.
    route: p.route === 'crm' && !contactId ? 'crm_failed' : p.route,
    ai_status: p.ai_status,
    hubspot_contact_id: contactId,
  },
};
