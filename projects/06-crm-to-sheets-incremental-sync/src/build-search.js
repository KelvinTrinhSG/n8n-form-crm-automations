// Builds the HubSpot search request for contacts changed since the last successful sync.
// The cursor lives in the "Sync State" tab (key/value), so it is visible and can be reset by hand:
// clear the value to re-sync the last INITIAL_DAYS days.
const INITIAL_DAYS = 30;
const KEY = 'contacts_last_modified';

const state = $input.all().map((i) => i.json).find((r) => r.key === KEY);
const saved = state && Date.parse(state.value);
const since = Number.isFinite(saved) ? saved : Date.now() - INITIAL_DAYS * 86400000;

return [{
  json: {
    since_iso: new Date(since).toISOString(),
    request_body: {
      // GTE, not GT: two contacts can share the cursor millisecond. Re-reading one row is harmless
      // because the sheet write is an upsert by hubspot_id.
      filterGroups: [{ filters: [{ propertyName: 'lastmodifieddate', operator: 'GTE', value: String(since) }] }],
      sorts: [{ propertyName: 'lastmodifieddate', direction: 'ASCENDING' }],
      properties: ['email', 'firstname', 'lastname', 'company', 'jobtitle', 'phone', 'lifecyclestage', 'hs_lead_status',
        'hubspot_owner_id', 'createdate', 'lastmodifieddate', 'hs_last_sales_activity_timestamp', 'num_associated_deals'],
      limit: 100,
    },
  },
}];
