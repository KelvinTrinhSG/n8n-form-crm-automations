// Picks the queue rows that are due for another attempt.
// A row is due when status = pending and next_retry_at is in the past.
// At most MAX_PER_RUN rows per run, oldest first, so a long outage does not hit HubSpot's rate limit on recovery.
const MAX_PER_RUN = 50;
const now = Date.now();

const rows = $input.all()
  .map((i) => i.json)
  .filter((r) => r.queue_id && String(r.status).toLowerCase() === 'pending')
  .filter((r) => !r.next_retry_at || Date.parse(r.next_retry_at) <= now)
  .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
  .slice(0, MAX_PER_RUN);

return rows.map((r) => {
  let properties = null;
  try { properties = JSON.parse(r.payload); } catch (e) { /* sent as-is; HubSpot answers 400 → marked dead */ }
  return {
    json: {
      queue_id: r.queue_id,
      email: r.email,
      attempts: Number(r.attempts) || 0,
      created_at: r.created_at,
      source_workflow: r.source_workflow,
      request_body: {
        inputs: [{ idProperty: 'email', id: r.email, properties: properties || { invalid_payload: r.payload } }],
      },
    },
  };
});
