// Decides "create" or "update" and builds the HubSpot properties to send.
// Data rules (agreed with sales, written down in the README):
//   1. Never overwrite CRM data with a blank value.
//   2. Name and company are only filled when empty in the CRM (sales may have corrected them).
//   3. Phone, job title and message come from the latest submission, so the form wins.
//   4. Lifecycle stage only moves forward: a "customer" is never pushed back to "lead".
const { lead } = $('Normalize & Validate').first().json;
const search = $input.first().json;
const existing = (search.results || [])[0];
const current = existing ? existing.properties || {} : {};

const fromForm = {
  email: lead.email,
  firstname: lead.first_name,
  lastname: lead.last_name,
  company: lead.company,
  website: lead.website,
  phone: lead.phone,
  jobtitle: lead.job_title,
  message: lead.message,
};
const FILL_IF_EMPTY = ['firstname', 'lastname', 'company', 'website'];
const FORM_WINS = ['phone', 'jobtitle', 'message'];

const properties = {};
const changed = [];
for (const [key, value] of Object.entries(fromForm)) {
  if (!value) continue; // rule 1
  if (!existing) { properties[key] = value; continue; }
  const old = current[key] || '';
  if (old === value) continue;
  if (FILL_IF_EMPTY.includes(key) && old) continue; // rule 2
  if (FILL_IF_EMPTY.includes(key) || FORM_WINS.includes(key)) {
    properties[key] = value;
    changed.push(old ? `${key}: "${old}" → "${value}"` : `${key}: set to "${value}"`);
  }
}

// Rule 4. HubSpot's default stages, in order.
const STAGES = ['subscriber', 'lead', 'marketingqualifiedlead', 'salesqualifiedlead', 'opportunity', 'customer', 'evangelist'];
const currentStage = STAGES.indexOf(current.lifecyclestage || '');
if (!existing) {
  properties.lifecyclestage = 'lead';
  properties.hs_lead_status = 'NEW';
} else if (currentStage < STAGES.indexOf('lead')) {
  properties.lifecyclestage = 'lead';
  changed.push(`lifecyclestage: "${current.lifecyclestage || '(empty)'}" → "lead"`);
}

return [{
  json: {
    action: existing ? 'update' : 'create',
    contact_id: existing ? existing.id : '',
    current_lifecycle: current.lifecyclestage || '',
    current_owner_id: current.hubspot_owner_id || '',
    properties,
    changed_fields: changed,
  },
}];
