// A real cancellation (not a reschedule): update the sheet row, move the deal, tell the host.
// The deal goes to CANCELED_STAGE. Many teams use "closedlost"; set your own "Meeting canceled" stage id here.
const CANCELED_STAGE = 'closedlost';
const TZ = 'America/New_York';
const ev = $('Verify & Parse Event').first().json;
const row = $input.all().map((i) => i.json).find((r) => r.invitee_uri === ev.invitee_uri) || {};
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = ev.start_time ? `${new Date(ev.start_time).toLocaleString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET` : '';
const dealId = String(row.deal_id || '');

return [{
  json: {
    invitee_uri: ev.invitee_uri,
    status: 'Canceled',
    email: ev.email,
    name: ev.name,
    company: row.company || ev.company,
    meeting_name: ev.meeting_name,
    start_time: ev.start_time,
    host_email: ev.host_email,
    hubspot_contact_id: row.hubspot_contact_id || '',
    deal_id: dealId,
    rescheduled_from: row.rescheduled_from || '',
    cancel_reason: `${ev.canceled_by ? `${ev.canceled_by}: ` : ''}${ev.cancel_reason || 'no reason given'}`,
    utm_source: row.utm_source || ev.utm_source,
    updated_at: new Date().toISOString(),
    has_deal: Boolean(dealId),
    deal_update: { properties: { dealstage: CANCELED_STAGE, closed_lost_reason: `Meeting canceled: ${ev.cancel_reason || 'no reason given'}`.slice(0, 250) } },
    email_to: ev.host_email,
    email_subject: `❌ Canceled: ${ev.name} · ${when}`,
    email_html: `<p><b>${esc(ev.name)}</b> &lt;${esc(ev.email)}&gt; canceled <b>${esc(ev.meeting_name)}</b> on ${when}.</p>`
      + `<p>Reason: ${esc(ev.cancel_reason || 'no reason given')}${ev.canceled_by ? ` (by ${esc(ev.canceled_by)})` : ''}</p>`
      + `<p>${dealId ? `Deal ${esc(dealId)} moved to "${CANCELED_STAGE}".` : 'No deal found for this booking (booked before the automation, or never synced).'} Worth a follow-up email to rebook.</p>`,
  },
}];
