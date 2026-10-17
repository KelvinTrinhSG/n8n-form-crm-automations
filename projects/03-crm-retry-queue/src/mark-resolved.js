// Success branch: the contact is now in HubSpot. Close the queue row.
const row = $('Pick Due Retries').item.json;
const result = ($json.results || [])[0] || {};

return {
  json: {
    queue_id: row.queue_id,
    attempts: row.attempts + 1,
    status: 'resolved',
    next_retry_at: '',
    resolved_at: new Date().toISOString(),
    hubspot_contact_id: result.id || '',
    last_error: '',
  },
};
