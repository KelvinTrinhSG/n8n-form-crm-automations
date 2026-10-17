// Runs only after the sheet write succeeded, so a failed write never moves the cursor forward
// (the same contacts are fetched again next run instead of being skipped).
// The cursor is the newest lastmodifieddate actually received, not "now": HubSpot's search index lags a few
// seconds, and using the clock would skip contacts that were changed just before the run.
const rows = $('Map Rows').all().map((i) => i.json);
const newest = Math.max(...rows.map((r) => Date.parse(r.last_modified)).filter(Number.isFinite));

return [{
  json: {
    key: 'contacts_last_modified',
    value: new Date(newest).toISOString(),
    rows_synced: rows.length,
    updated_at: new Date().toISOString(),
  },
}];
