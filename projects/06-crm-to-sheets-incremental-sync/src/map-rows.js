// Flattens every page returned by the paginated search into one sheet row per contact.
// Internal HubSpot values are turned into the labels people see in HubSpot.
const STAGE = {
  subscriber: 'Subscriber', lead: 'Lead', marketingqualifiedlead: 'MQL', salesqualifiedlead: 'SQL',
  opportunity: 'Opportunity', customer: 'Customer', evangelist: 'Evangelist', other: 'Other',
};
const STATUS = {
  NEW: 'New', OPEN: 'Open', IN_PROGRESS: 'In progress', OPEN_DEAL: 'Open deal', UNQUALIFIED: 'Unqualified',
  ATTEMPTED_TO_CONTACT: 'Attempted to contact', CONNECTED: 'Connected', BAD_TIMING: 'Bad timing',
};
const SEARCH_CAP = 10000; // HubSpot search returns at most 10,000 results per query

const pages = $input.all().map((i) => i.json);
const total = Number(pages[0]?.total) || 0;
const byId = new Map(); // a contact edited during paging can appear on two pages: keep the newest
for (const page of pages) {
  for (const r of page.results || []) {
    const prev = byId.get(r.id);
    if (!prev || Date.parse(r.properties.lastmodifieddate) >= Date.parse(prev.properties.lastmodifieddate)) byId.set(r.id, r);
  }
}

const now = Date.now();
const day = (v) => (v ? String(v).slice(0, 10) : '');
const rows = [...byId.values()].map(({ id, properties: p }) => {
  const lastActivity = Date.parse(p.hs_last_sales_activity_timestamp);
  return {
    json: {
      hubspot_id: String(id),
      email: p.email || '',
      name: [p.firstname, p.lastname].filter(Boolean).join(' '),
      company: p.company || '',
      job_title: p.jobtitle || '',
      phone: p.phone || '',
      lifecycle_stage: STAGE[p.lifecyclestage] || p.lifecyclestage || '',
      lead_status: STATUS[p.hs_lead_status] || p.hs_lead_status || '',
      owner_id: p.hubspot_owner_id || '',
      deals: Number(p.num_associated_deals) || 0,
      created: day(p.createdate),
      last_modified: p.lastmodifieddate,
      days_since_sales_activity: Number.isFinite(lastActivity) ? Math.floor((now - lastActivity) / 86400000) : '',
      synced_at: new Date(now).toISOString(),
    },
  };
});

if (total > SEARCH_CAP) {
  // The next run continues from the newest lastmodifieddate seen, so a big backlog is caught up over several runs.
  rows.forEach((r) => { r.json.sync_note = `backlog: ${total} changed contacts, synced in parts`; });
}
return rows;
