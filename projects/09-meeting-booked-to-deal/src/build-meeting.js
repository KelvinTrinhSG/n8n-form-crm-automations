// Builds the "Meetings" sheet rows and the email to the host.
// New booking: 1 row. Reschedule: the new row + the old row marked "Moved".
const TZ = 'America/New_York';
const b = $('Check Existing Booking').first().json;

// These nodes only ran for new bookings; on a reschedule the ids come from the sheet.
let contactId = b.hubspot_contact_id;
let dealId = b.deal_id;
try { contactId = $('HubSpot · Upsert Contact').first().json.results[0].id; } catch (e) { /* reschedule */ }
try { dealId = $('HubSpot · Create Deal').first().json.id; } catch (e) { /* reschedule */ }

const when = (iso) => (iso ? `${new Date(iso).toLocaleString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET` : '');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const now = new Date().toISOString();
const isReschedule = b.mode === 'reschedule';

const row = {
  invitee_uri: b.invitee_uri,
  status: isReschedule ? 'Rescheduled' : 'Booked',
  email: b.email,
  name: b.name,
  company: b.company,
  meeting_name: b.meeting_name,
  start_time: b.start_time,
  host_email: b.host_email,
  hubspot_contact_id: contactId,
  deal_id: dealId,
  rescheduled_from: isReschedule ? b.old_invitee_uri : '',
  cancel_reason: '',
  utm_source: b.utm_source,
  updated_at: now,
};

const qa = b.answers.map((x) => `<li><b>${esc(x.q)}</b><br>${esc(x.a)}</li>`).join('');
const subject = isReschedule
  ? `🔁 Rescheduled: ${b.name} → ${when(b.start_time)} (was ${when(b.previous_start)})`
  : `📅 New meeting: ${b.name}${b.company ? ` (${b.company})` : ''} · ${when(b.start_time)}`;
const html = `<div style="font-family:Arial;font-size:14px">
<p><b>${esc(b.name)}</b> &lt;${esc(b.email)}&gt;${b.company ? ` · ${esc(b.company)}` : ''}</p>
<p>${esc(b.meeting_name)} · <b>${when(b.start_time)}</b>${b.join_url ? ` · <a href="${esc(b.join_url)}">join link</a>` : ''}</p>
${isReschedule ? `<p>Moved from ${when(b.previous_start)}. Same deal kept.</p>` : '<p>Deal created in HubSpot (stage: Appointment scheduled).</p>'}
<p>HubSpot deal ID: ${esc(dealId)} · contact ID: ${esc(contactId)}</p>
${qa ? `<h4 style="margin:12px 0 4px">Their answers</h4><ul>${qa}</ul>` : ''}
</div>`;

const items = [{ json: { ...row, email_to: b.host_email, email_subject: subject, email_html: html } }];
if (isReschedule) {
  items.push({ json: { ...row, invitee_uri: b.old_invitee_uri, status: 'Moved', start_time: b.previous_start, rescheduled_from: '' } });
}
return items;
