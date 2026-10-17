// Builds the internal notification email. Every value typed by the visitor is HTML-escaped,
// so a message containing <script> or a fake link cannot inject markup into the sales inbox.
const row = $input.first().json;
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const name = [row.first_name, row.last_name].filter(Boolean).join(' ') || row.email;
const isNew = row.crm_action === 'create';
const badge = isNew ? '🆕 New contact' : '🔁 Returning contact';

const line = (label, value) => (value ? `<tr><td style="padding:4px 12px 4px 0;color:#666">${esc(label)}</td><td style="padding:4px 0">${esc(value)}</td></tr>` : '');
const campaign = [row.utm_source, row.utm_medium, row.utm_campaign].filter(Boolean).join(' / ');

const html = `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:600px">
  <h2 style="margin:0 0 4px">${esc(name)}${row.company ? ` · ${esc(row.company)}` : ''}</h2>
  <p style="margin:0 0 16px;color:#555">${badge} · form: ${esc(row.form_name)}</p>
  <table style="border-collapse:collapse">
    ${line('Email', row.email)}
    ${line('Phone', row.phone)}
    ${line('Job title', row.job_title)}
    ${line('Website', row.website)}
    ${line('Campaign', campaign)}
    ${line('Page', row.page_url)}
    ${line('HubSpot ID', row.hubspot_contact_id)}
  </table>
  <h3 style="margin:16px 0 4px">Message</h3>
  <p style="white-space:pre-wrap;background:#f6f6f6;padding:12px;border-radius:6px;margin:0">${esc(row.message) || '<i>(no message)</i>'}</p>
  ${row.changed_fields ? `<p style="color:#555"><b>CRM fields updated:</b> ${esc(row.changed_fields)}</p>` : ''}
  ${row.warnings ? `<p style="color:#b45309"><b>⚠️ Check:</b> ${esc(row.warnings)}</p>` : ''}
</div>`;

return [{
  json: {
    email_subject: `${isNew ? 'New lead' : 'Returning lead'}: ${name}${row.company ? ` (${row.company})` : ''}`,
    email_html: html,
  },
}];
