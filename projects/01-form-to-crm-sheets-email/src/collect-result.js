// Merges the form data and the HubSpot response into one row for the "Leads" sheet.
// Runs after either "HubSpot · Update Contact" (returns {id}) or "HubSpot · Create Contact" (batch upsert, returns {results:[{id, new}]}).
const response = $input.first().json;
const payload = $('Build CRM Payload').first().json;
const { lead, warnings, received_at } = $('Normalize & Validate').first().json;

const upserted = (response.results || [])[0];
const contactId = response.id || (upserted && upserted.id) || payload.contact_id;
// The upsert endpoint is race-safe: if the same person submitted twice within seconds,
// the second call updates the contact created by the first one instead of duplicating it.
const action = payload.action === 'create' && upserted && upserted.new === false ? 'update' : payload.action;

return [{
  json: {
    email: lead.email,
    first_name: lead.first_name,
    last_name: lead.last_name,
    phone: lead.phone,
    company: lead.company,
    job_title: lead.job_title,
    website: lead.website,
    message: lead.message,
    consent: lead.consent ? 'yes' : 'no',
    form_name: lead.form_name,
    page_url: lead.page_url,
    utm_source: lead.utm_source,
    utm_medium: lead.utm_medium,
    utm_campaign: lead.utm_campaign,
    hubspot_contact_id: contactId,
    crm_action: action,
    changed_fields: payload.changed_fields.join('; '),
    warnings: warnings.join('; '),
    last_submitted_at: received_at,
    submission_id: lead.submission_id,
    // Reset on every submission so the SLA monitor (project 05) starts a new clock.
    sla_level: '',
    sla_alerted_at: '',
  },
}];
