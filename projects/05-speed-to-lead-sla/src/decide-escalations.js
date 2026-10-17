// Checks HubSpot before alerting anyone: the sheet can be out of date, the CRM is the truth.
// A lead counts as contacted if, after it was submitted, the rep logged a call/email/meeting
// (hs_last_sales_activity_timestamp, notes_last_contacted) or moved the lead status past NEW/OPEN.
// Output: one item per lead with the new sla_level, plus who should be told.
const MANAGER_EMAIL = 'sales@example.com';
const candidates = $('Find SLA Candidates').first().json.candidates;
const crm = Object.fromEntries(($('HubSpot · Batch Read Contacts').first().json.results || []).map((r) => [String(r.id), r.properties || {}]));
const reps = Object.fromEntries($input.all().map((i) => i.json).filter((r) => r.hubspot_owner_id).map((r) => [String(r.hubspot_owner_id), r]));
const UNTOUCHED = ['', 'NEW', 'OPEN'];

const now = new Date().toISOString();
return candidates.map((c) => {
  const p = crm[c.hubspot_contact_id];
  const submitted = Date.parse(c.submitted_at);
  const after = (v) => v && Date.parse(v) > submitted;
  const contacted = p && (after(p.hs_last_sales_activity_timestamp) || after(p.notes_last_contacted) || !UNTOUCHED.includes(String(p.hs_lead_status || '').toUpperCase()));

  if (contacted) return { json: { ...c, sla_level: 'met', sla_alerted_at: now, notify: false } };

  const owner = p && reps[String(p.hubspot_owner_id || '')];
  // No owner, or owner not in the reps sheet: nobody will get a "rep" reminder, so go to the manager.
  const level = !owner ? 'manager' : c.due_level;
  const recipient = level === 'rep' ? owner.email : MANAGER_EMAIL;
  return {
    json: {
      ...c,
      sla_level: level,
      sla_alerted_at: now,
      notify: true,
      recipient,
      owner_name: owner ? owner.name : '(no owner)',
      missing_from_crm: !p,
    },
  };
});
