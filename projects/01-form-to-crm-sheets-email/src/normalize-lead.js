// Turns a raw website form submission into one clean, validated lead.
// Works with any form builder: field names are matched through aliases (Email, email, your-email, ...),
// so switching from Webflow to Typeform or Elementor only means adding an alias here.
const req = $input.first().json;
const body = req.body && typeof req.body === 'object' ? req.body : {};
const query = req.query || {};

const keyOf = (k) => String(k).toLowerCase().trim().replace(/[\s-]+/g, '_');
const ALIASES = {
  email: ['email', 'e-mail', 'email address', 'work email', 'your-email'],
  first_name: ['first name', 'firstname', 'fname', 'given name'],
  last_name: ['last name', 'lastname', 'lname', 'surname', 'family name'],
  full_name: ['name', 'full name', 'fullname', 'your-name', 'contact name'],
  phone: ['phone', 'phone number', 'mobile', 'tel', 'your-phone'],
  company: ['company', 'company name', 'organization', 'organisation', 'business'],
  job_title: ['job title', 'jobtitle', 'title', 'role', 'position'],
  website: ['website', 'company website', 'url', 'domain'],
  message: ['message', 'comments', 'inquiry', 'how can we help', 'your-message', 'notes'],
  consent: ['consent', 'gdpr', 'marketing consent', 'opt in', 'accept terms'],
};

const flat = {};
for (const [k, v] of Object.entries(body)) flat[keyOf(k)] = v;
const pick = (fieldName) => {
  for (const alias of ALIASES[fieldName]) {
    const v = flat[keyOf(alias)];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).replace(/\s+/g, ' ').trim();
  }
  return '';
};

const errors = [];
const warnings = [];

// "JOHN SMITH" or "john smith" → "John Smith". Mixed case ("McDonald") is left alone.
const fixCase = (s) => (s && (s === s.toUpperCase() || s === s.toLowerCase())
  ? s.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase())
  : s);

// ---------- email ----------
const TYPO_DOMAINS = { 'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.co': 'gmail.com', 'hotmial.com': 'hotmail.com', 'yahooo.com': 'yahoo.com', 'outlook.con': 'outlook.com' };
let email = pick('email').toLowerCase().replace(/^mailto:/, '');
const [localPart, domainPart = ''] = email.split('@');
if (TYPO_DOMAINS[domainPart]) {
  warnings.push(`email domain corrected: ${domainPart} → ${TYPO_DOMAINS[domainPart]}`);
  email = `${localPart}@${TYPO_DOMAINS[domainPart]}`;
}
if (!email) errors.push('email is required');
else if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) errors.push(`email is not valid: ${email}`);
const emailDomain = email.split('@')[1] || '';

// ---------- name ----------
let firstName = pick('first_name');
let lastName = pick('last_name');
if (!firstName && !lastName) {
  const parts = pick('full_name').split(' ').filter(Boolean);
  firstName = parts.shift() || '';
  lastName = parts.join(' ');
}
firstName = fixCase(firstName);
lastName = fixCase(lastName);
if (!firstName) warnings.push('no name given');

// ---------- phone: digits only, E.164 style when the country is obvious ----------
const DEFAULT_COUNTRY_CODE = '1'; // US/Canada. Change for your market.
const rawPhone = pick('phone');
let phone = '';
if (rawPhone) {
  const digits = rawPhone.replace(/[^\d]/g, '');
  if (rawPhone.trim().startsWith('+')) phone = `+${digits}`;
  else if (rawPhone.trim().startsWith('00')) phone = `+${digits.slice(2)}`;
  else if (digits.length === 10) phone = `+${DEFAULT_COUNTRY_CODE}${digits}`;
  else if (digits.length === 11 && digits.startsWith(DEFAULT_COUNTRY_CODE)) phone = `+${digits}`;
  else phone = digits;
  const len = phone.replace('+', '').length;
  if (len < 8 || len > 15) {
    warnings.push(`phone looks wrong, kept as typed: ${rawPhone}`);
    phone = rawPhone;
  }
}

// ---------- company website: from the form, or guessed from a business email domain ----------
const FREE_MAIL = ['gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com'];
let website = pick('website').toLowerCase();
if (website) {
  website = website.replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/.*$/, '');
  website = `https://${website}`;
} else if (emailDomain && !FREE_MAIL.includes(emailDomain)) {
  website = `https://${emailDomain}`;
}

// ---------- message ----------
const MAX_MESSAGE = 5000;
let message = pick('message');
if (message.length > MAX_MESSAGE) {
  warnings.push(`message cut to ${MAX_MESSAGE} characters`);
  message = message.slice(0, MAX_MESSAGE);
}

const consentRaw = pick('consent').toLowerCase();
const consent = ['true', 'yes', 'on', '1', 'checked', 'y'].includes(consentRaw);

const fromBodyOrQuery = (k) => String(flat[k] ?? query[k] ?? '').trim();
const receivedAt = new Date().toISOString();

return [{
  json: {
    valid: errors.length === 0,
    errors,
    warnings,
    received_at: receivedAt,
    lead: {
      submission_id: fromBodyOrQuery('submission_id') || `S-${Date.now().toString(36).toUpperCase()}`,
      email,
      first_name: firstName,
      last_name: lastName,
      phone,
      company: pick('company'),
      job_title: pick('job_title'),
      website,
      message,
      consent,
      form_name: fromBodyOrQuery('form_name') || fromBodyOrQuery('form') || 'website',
      page_url: fromBodyOrQuery('page_url'),
      utm_source: fromBodyOrQuery('utm_source'),
      utm_medium: fromBodyOrQuery('utm_medium'),
      utm_campaign: fromBodyOrQuery('utm_campaign'),
    },
  },
}];
