// Skips replies in a thread this workflow already handled (the lead is in the CRM, sales owns the conversation).
// Input: the message_id column of the "Email Triage" tab (read once per poll).
// Emails come from "Pre-filter Email"; a reply whose In-Reply-To/References contains a logged
// message_id is skipped. A reply to OUR email (campaign, quote) is not in the log, so it goes to the AI.
// Why the sheet and not workflow static data: with a long-running trigger (IMAP), each execution starts
// from the trigger's in-memory copy of static data, so one execution never saw what the previous one saved.
const handled = new Set($input.all().map((i) => String(i.json.message_id || '').trim()).filter(Boolean));

return $('Pre-filter Email').all().map((item) => {
  const e = { ...item.json };
  if (e.worth_parsing && (e.thread_refs || []).some((id) => handled.has(id))) {
    e.worth_parsing = false;
    e.skip_reason = 'reply in a thread we already handled';
  }
  return { json: e };
});
