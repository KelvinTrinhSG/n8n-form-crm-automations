// Builds the email: to the assigned rep, or to the sales manager when nobody could be assigned.
const r = $('Choose Owner').first().json;
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const who = r.name || r.email;
const details = `<p><b>${esc(who)}</b>${r.company ? ` · ${esc(r.company)}` : ''}<br>${esc(r.email)}<br>`
  + `Country: ${esc(r.country || '?')} · Employees: ${esc(r.employees || '?')} · Segment: ${esc(r.segment)}<br>`
  + `HubSpot contact: ${esc(r.contact_id)}</p>`;

// Existing owner kept: this is their contact getting back in touch, not a new lead.
if (r.assigned && !r.changed) {
  return [{
    json: {
      ...r,
      email_to: r.owner.email,
      email_subject: `Your contact got back in touch: ${who}${r.company ? ` (${r.company})` : ''}`,
      email_html: `<p>Hi ${esc(String(r.owner.name).split(' ')[0])}, someone you already own in HubSpot just contacted us again. No reassignment was made.</p>${details}<p style="color:#666">Rule: ${esc(r.rule)}</p>`,
    },
  }];
}
if (r.assigned) {
  return [{
    json: {
      ...r,
      email_to: r.owner.email,
      email_subject: `New lead assigned to you: ${who}${r.company ? ` (${r.company})` : ''}`,
      email_html: `<p>Hi ${esc(String(r.owner.name).split(' ')[0])}, this lead is yours. Please reply within 1 business hour.</p>${details}<p style="color:#666">Rule: ${esc(r.rule)}</p>`,
    },
  }];
}
return [{
  json: {
    ...r,
    email_to: '',
    email_subject: `⚠️ Unassigned lead: ${who}`,
    email_html: `<p>No rep matched this lead, so it needs a manual owner in HubSpot.</p>${details}<p style="color:#b45309">Reason: ${esc(r.rule)}</p>`,
  },
}];
