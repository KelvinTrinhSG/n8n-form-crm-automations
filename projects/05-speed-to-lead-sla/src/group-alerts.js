// One email per recipient listing all of their overdue leads, instead of one email per lead.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtAge = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);

const groups = {};
for (const { json: l } of $input.all()) {
  if (!l.notify) continue;
  (groups[l.recipient] ||= []).push(l);
}

return Object.entries(groups).map(([to, leads]) => {
  const isManager = leads.some((l) => l.sla_level === 'manager');
  leads.sort((a, b) => b.business_minutes - a.business_minutes);
  const rows = leads.map((l) => `<tr><td>${esc(l.name || l.email)}</td><td>${esc(l.company)}</td><td>${esc(l.email)}</td>`
    + `<td>${esc(l.owner_name)}</td><td style="text-align:right">${fmtAge(l.business_minutes)}</td></tr>`).join('');
  const intro = isManager
    ? 'These leads have waited more than 4 business hours without any logged contact.'
    : 'These leads are yours and have waited more than 1 business hour. Please call or email them, then log it in HubSpot.';
  return {
    json: {
      email_to: to,
      email_subject: `${isManager ? '🚨 SLA breach' : '⏰ Reminder'}: ${leads.length} lead${leads.length > 1 ? 's' : ''} waiting`,
      email_html: `<p>${intro}</p><table cellpadding="6" style="border-collapse:collapse;font-family:Arial;font-size:13px" border="1">`
        + '<tr style="background:#f3f4f6"><th>Lead</th><th>Company</th><th>Email</th><th>Owner</th><th>Waiting (business time)</th></tr>'
        + `${rows}</table><p style="color:#666">Business hours: Mon–Fri 9:00–18:00 ET.</p>`,
    },
  };
});
