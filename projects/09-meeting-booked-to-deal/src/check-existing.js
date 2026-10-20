// Idempotency + reschedule handling, using the "Meetings" sheet as memory.
//   Same invitee already in the sheet → Calendly retried the webhook → stop (no second deal).
//   Reschedule whose old row is already "Moved" → Calendly retried the reschedule webhook → stop.
//     (The lookup is by the OLD invitee, so the new row is not in `rows`. Without this check a retry
//     re-sent the "Rescheduled" email and could overwrite a later "Canceled" row. Found in a live test.)
//   Reschedule of a known booking → reuse its deal, do not create a new one.
//   Otherwise → new booking.
const ev = $('Verify & Parse Event').first().json;
const rows = $input.all().map((i) => i.json).filter((r) => r.invitee_uri);

if (rows.some((r) => r.invitee_uri === ev.invitee_uri)) return [];

const previous = ev.old_invitee_uri && rows.find((r) => r.invitee_uri === ev.old_invitee_uri);
if (previous && previous.status === 'Moved') return [];
if (previous && previous.deal_id) {
  return [{
    json: {
      ...ev,
      mode: 'reschedule',
      deal_id: String(previous.deal_id),
      hubspot_contact_id: String(previous.hubspot_contact_id || ''),
      previous_start: previous.start_time,
    },
  }];
}
return [{ json: { ...ev, mode: 'new', deal_id: '', hubspot_contact_id: '', previous_start: '' } }];
