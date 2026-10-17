// Finds leads whose response clock has passed an SLA level, counting business minutes only.
//   level "rep"     → 60 business minutes without contact → remind the owner
//   level "manager" → 240 business minutes without contact → escalate to the sales manager
// Business hours: Mon–Fri 09:00–18:00 America/New_York, minus holidays. A lead sent Friday 17:30
// is 30 minutes old at Monday 09:00, not 63 hours.
const TZ = 'America/New_York';
const OPEN_MIN = 9 * 60;
const CLOSE_MIN = 18 * 60;
const WORKDAYS = [1, 2, 3, 4, 5];
const HOLIDAYS = ['2026-11-26', '2026-12-25', '2027-01-01', '2027-01-18', '2027-05-31', '2027-07-05'];
const LEVELS = [{ level: 'rep', after: 60 }, { level: 'manager', after: 240 }];
const LOOKBACK_DAYS = 5;
const RANK = { '': 0, rep: 1, manager: 2, met: 3 };

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hour12: false, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});
const local = (ms) => {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return {
    day: `${p.year}-${p.month}-${p.day}`,
    dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday),
    min: (Number(p.hour) % 24) * 60 + Number(p.minute),
  };
};
// Walks the interval in 5-minute steps. Uses real instants, so DST changes are handled by Intl.
const businessMinutes = (fromMs, toMs) => {
  const STEP = 5;
  let total = 0;
  for (let t = fromMs; t < toMs; t += STEP * 60000) {
    const l = local(t);
    if (WORKDAYS.includes(l.dow) && !HOLIDAYS.includes(l.day) && l.min >= OPEN_MIN && l.min < CLOSE_MIN) {
      total += Math.min(STEP, (toMs - t) / 60000);
    }
  }
  return Math.round(total);
};

const now = Date.now();
const candidates = [];
for (const { json: row } of $input.all()) {
  const submitted = Date.parse(row.last_submitted_at);
  if (!row.email || !row.hubspot_contact_id || !Number.isFinite(submitted)) continue;
  if (now - submitted > LOOKBACK_DAYS * 86400000) continue;
  const current = String(row.sla_level || '').toLowerCase();
  if (current === 'met' || current === 'manager') continue;

  const elapsed = businessMinutes(submitted, now);
  const due = [...LEVELS].reverse().find((l) => elapsed >= l.after);
  if (!due || RANK[due.level] <= RANK[current]) continue;
  candidates.push({
    email: row.email,
    name: [row.first_name, row.last_name].filter(Boolean).join(' '),
    company: row.company || '',
    hubspot_contact_id: String(row.hubspot_contact_id),
    submitted_at: row.last_submitted_at,
    business_minutes: elapsed,
    due_level: due.level,
  });
}

if (!candidates.length) return [];
const batch = candidates.slice(0, 100); // HubSpot batch read limit
return [{
  json: {
    candidates: batch,
    request_body: {
      properties: ['hubspot_owner_id', 'hs_lead_status', 'notes_last_contacted', 'hs_last_sales_activity_timestamp', 'lifecyclestage'],
      inputs: batch.map((c) => ({ id: c.hubspot_contact_id })),
    },
  },
}];
