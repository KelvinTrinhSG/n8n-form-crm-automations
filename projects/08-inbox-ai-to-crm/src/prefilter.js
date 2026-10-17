// Cheap rules before any AI call: most of a shared inbox is not a new lead.
// Skipped: our own domain, no-reply senders, auto-replies, bounces, newsletters, replies to existing threads.
// Also strips quoted history and signatures so the AI only reads what the sender actually wrote.
const OWN_DOMAINS = ['example.com'];
const MAX_BODY = 4000;
const m = $json;

// IMAP "resolved" format: from = { value: [{ address, name }] }. "simple" format: from = '"Name" <a@b.com>'.
const parseFrom = (from) => {
  if (from && typeof from === 'object' && from.value) return { address: from.value[0]?.address || '', name: from.value[0]?.name || '' };
  const s = String(from || '');
  const match = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/);
  return match ? { name: match[1].trim(), address: match[2] } : { name: '', address: s.trim() };
};
const sender = parseFrom(m.from);
const senderEmail = sender.address.toLowerCase();
const domain = senderEmail.split('@')[1] || '';
const subject = String(m.subject || '').trim();
const headers = Object.fromEntries(Object.entries(m.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v && v.value !== undefined ? v.value : v)]));
const header = (k) => headers[k] || '';

let text = String(m.text || m.textPlain || '');
if (!text && (m.html || m.textHtml)) text = String(m.html || m.textHtml).replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
text = text
  .split(/\r?\n/)
  .filter((l) => !l.trim().startsWith('>'))
  .join('\n')
  .split(/\n(?:On .{5,200} wrote:|-----Original Message-----|From: .+\nSent: )/)[0]
  .split(/\n-- ?\n|\nSent from my (?:iPhone|Android)/)[0]
  .replace(/\n{3,}/g, '\n\n')
  .trim()
  .slice(0, MAX_BODY);

let skip = '';
if (!senderEmail) skip = 'no sender';
else if (OWN_DOMAINS.includes(domain)) skip = 'internal sender';
else if (/^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?|bounce)/i.test(senderEmail)) skip = 'automated sender';
else if (header('auto-submitted') && header('auto-submitted') !== 'no') skip = 'auto-submitted';
else if (header('x-autoreply') || header('x-autorespond') || /^(out of office|automatic reply|auto(matic)?[- ]reply|abwesenheit)/i.test(subject)) skip = 'auto-reply';
else if (/^(undeliver|delivery status|mail delivery failed)/i.test(subject)) skip = 'bounce';
else if (header('list-unsubscribe') || /^(bulk|list|junk)$/i.test(header('precedence'))) skip = 'newsletter or bulk mail';
else if (/^(re|aw|sv|fw|fwd):/i.test(subject) || header('in-reply-to')) skip = 'reply in an existing thread';
else if (text.length < 15) skip = 'empty body';

return {
  json: {
    worth_parsing: !skip,
    skip_reason: skip,
    message_id: m.messageId || header('message-id') || '',
    received_at: m.date ? new Date(m.date).toISOString() : new Date().toISOString(),
    sender_email: senderEmail,
    sender_name: sender.name,
    sender_domain: domain,
    subject,
    body_text: text,
  },
};
