// Cleans a lead list exported from an event app, LinkedIn or a spreadsheet, then prepares HubSpot batches.
//   - Header names vary ("E-mail", "Email Address", "Company Name"...) → mapped through aliases
//   - Rows without a valid email are rejected with the reason (they come back in the report)
//   - The same person twice in the file → merged into one row (blanks filled from the other copy)
//     HubSpot's batch upsert fails the whole batch if one email appears twice in it, so this is required.
//   - Output: one item per batch of 100 (HubSpot's batch limit)
const BATCH_SIZE = 100;
const form = $('Upload Lead List').first().json;
const source = String(form['List Source'] || 'CSV import').trim();

const keyOf = (k) => String(k).toLowerCase().replace(/^﻿/, '').replace(/[^a-z0-9]/g, '');
const ALIASES = {
  email: ['email', 'emailaddress', 'e-mail', 'workemail', 'businessemail', 'mail'],
  firstname: ['firstname', 'first', 'givenname', 'fname'],
  lastname: ['lastname', 'last', 'surname', 'familyname', 'lname'],
  fullname: ['name', 'fullname', 'contactname'],
  company: ['company', 'companyname', 'organization', 'organisation', 'account'],
  jobtitle: ['jobtitle', 'title', 'position', 'role'],
  phone: ['phone', 'phonenumber', 'mobile', 'mobilephone', 'tel', 'telephone'],
  city: ['city', 'town'],
  country: ['country', 'countryregion'],
};

const rows = $input.all().map((i) => i.json);
const valid = new Map(); // email → properties
const rejects = [];
let duplicatesMerged = 0;

rows.forEach((raw, index) => {
  const rowNumber = index + 2; // +1 for the header, +1 because sheets start at 1
  const flat = Object.fromEntries(Object.entries(raw).map(([k, v]) => [keyOf(k), String(v ?? '').replace(/\s+/g, ' ').trim()]));
  if (!Object.values(flat).some(Boolean)) return; // blank line at the end of the file
  const get = (f) => ALIASES[f].map((a) => flat[keyOf(a)]).find(Boolean) || '';

  const emailAddr = get('email').toLowerCase().replace(/^mailto:/, '').replace(/[<>]/g, '');
  if (!emailAddr) { rejects.push({ row: rowNumber, email: '', reason: 'missing email', data: JSON.stringify(raw) }); return; }
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(emailAddr)) { rejects.push({ row: rowNumber, email: emailAddr, reason: 'invalid email', data: JSON.stringify(raw) }); return; }

  let first = get('firstname');
  let last = get('lastname');
  if (!first && !last && get('fullname')) {
    const parts = get('fullname').split(' ');
    first = parts.shift();
    last = parts.join(' ');
  }

  const props = { email: emailAddr, firstname: first, lastname: last, company: get('company'), jobtitle: get('jobtitle'), phone: get('phone'), city: get('city'), country: get('country') };
  for (const k of Object.keys(props)) if (!props[k]) delete props[k]; // never send blanks over existing CRM data

  if (valid.has(emailAddr)) {
    duplicatesMerged += 1;
    const kept = valid.get(emailAddr);
    for (const [k, v] of Object.entries(props)) if (!kept[k]) kept[k] = v;
  } else {
    valid.set(emailAddr, props);
  }
});

const contacts = [...valid.values()];
const stats = { source, uploaded_by: form['Your Email'] || '', total_rows: rows.length, valid: contacts.length, rejected: rejects.length, duplicates_merged: duplicatesMerged };

if (!contacts.length) return [{ json: { has_batches: false, stats, rejects } }];

const batches = [];
for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
  const chunk = contacts.slice(i, i + BATCH_SIZE);
  batches.push({
    json: {
      has_batches: true,
      batch: batches.length + 1,
      emails: chunk.map((c) => c.email),
      request_body: { inputs: chunk.map((p) => ({ idProperty: 'email', id: p.email, properties: p })) },
      // Report data travels on the first item only.
      ...(batches.length === 0 ? { stats, rejects } : {}),
    },
  });
}
return batches;
