// Picks the sales rep who owns a new lead.
// Rules, in order:
//   1. The contact already has an owner in HubSpot → keep it (never steal an account).
//   2. Segment: 500+ employees = enterprise, else smb. Only reps with that segment qualify.
//   3. Territory: reps covering the lead's country beat reps marked "*" (everywhere).
//   4. Skip inactive reps and reps out of office today.
//   5. Among the remaining reps, rotate (round robin). The pointer is kept per pool in static data.
const lead = $('Route Lead Webhook').first().json.body || {};
const reps = $input.all().map((i) => i.json).filter((r) => r.email);
const state = $getWorkflowStaticData('global');
state.pointers = state.pointers || {};

const ENTERPRISE_MIN_EMPLOYEES = 500;
const COUNTRY = {
  'united states': 'US', usa: 'US', 'u.s.': 'US', america: 'US', us: 'US',
  canada: 'CA', ca: 'CA', 'united kingdom': 'GB', uk: 'GB', england: 'GB', gb: 'GB',
  germany: 'DE', deutschland: 'DE', de: 'DE', france: 'FR', fr: 'FR', australia: 'AU', au: 'AU',
  vietnam: 'VN', 'viet nam': 'VN', vn: 'VN', singapore: 'SG', sg: 'SG',
};
const country = COUNTRY[String(lead.country || '').trim().toLowerCase()] || String(lead.country || '').trim().toUpperCase().slice(0, 2);
const employees = Number(String(lead.employees || '').replace(/[^\d]/g, '')) || 0;
const segment = employees >= ENTERPRISE_MIN_EMPLOYEES ? 'enterprise' : 'smb';

const yes = (v) => ['true', 'yes', '1', 'y', 'x'].includes(String(v).trim().toLowerCase());
const list = (v) => String(v || '').split(/[,;]/).map((s) => s.trim().toUpperCase()).filter(Boolean);
const today = new Date().toISOString().slice(0, 10);
// Google Sheets turns a typed "2026-10-24" into a date shown as "10/24/2026" (US locale), or a serial number
// when read unformatted. Normalise all three to YYYY-MM-DD before comparing. Seen live on 2026-10-18.
const pad = (n) => String(n).padStart(2, '0');
const toDay = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // sheet locale is US: month/day/year
  if (m) return `${m[3]}-${pad(m[1])}-${pad(m[2])}`;
  if (/^\d{5}(\.\d+)?$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000).toISOString().slice(0, 10);
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : '';
};
const outOfOffice = (r) => { const d = toDay(r.out_of_office_until); return Boolean(d) && d >= today; };

const base = { contact_id: lead.hubspot_contact_id || '', email: lead.email || '', name: lead.name || '', company: lead.company || '', country, employees, segment };

// Rule 1
if (lead.current_owner_id) {
  const owner = reps.find((r) => String(r.hubspot_owner_id) === String(lead.current_owner_id));
  return [{ json: { ...base, assigned: true, changed: false, rule: 'existing owner kept', owner: owner || { hubspot_owner_id: lead.current_owner_id, name: '(unknown rep)', email: '' } } }];
}

const available = reps
  .filter((r) => yes(r.active) && !outOfOffice(r))
  .filter((r) => list(r.segments).includes(segment.toUpperCase()));
const local = available.filter((r) => list(r.territories).includes(country));
const global = available.filter((r) => list(r.territories).includes('*'));
const pool = (local.length ? local : global).sort((a, b) => String(a.email).localeCompare(String(b.email)));
const rule = local.length ? `${segment} · territory ${country}` : `${segment} · global pool`;

if (!pool.length) {
  return [{ json: { ...base, assigned: false, changed: false, rule: `no available rep for ${segment} / ${country || 'unknown country'}`, owner: null } }];
}

// Rule 5. Pool key includes the members so adding/removing a rep restarts the rotation cleanly.
const poolKey = `${segment}:${local.length ? country : '*'}:${pool.map((r) => r.email).join(',')}`;
const index = (state.pointers[poolKey] || 0) % pool.length;
state.pointers[poolKey] = index + 1;
const owner = pool[index];

return [{
  json: {
    ...base,
    assigned: true,
    changed: true,
    rule: `${rule} · round robin ${index + 1}/${pool.length}`,
    owner: { name: owner.name, email: owner.email, hubspot_owner_id: String(owner.hubspot_owner_id) },
    assigned_at: new Date().toISOString(),
  },
}];
