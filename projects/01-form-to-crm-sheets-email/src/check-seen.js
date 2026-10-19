// Second line of defence against duplicates (the first is 02 · Secure Webhook Gateway).
// If the caller sent its own submission_id and we already processed it in the last 24 h,
// skip the CRM, the sheet and the sales email. Ids we generated ourselves (no id sent) are never "seen".
// Note: static data is saved when the execution ends, so two calls arriving within a few seconds
// can both pass. That gap is closed in 02; for high traffic use Redis SET NX instead.
const item = $input.first().json;
const req = $('Lead Form Webhook').first().json;
const sentId = String((req.body && req.body.submission_id) || (req.query && req.query.submission_id) || '').trim();

const state = $getWorkflowStaticData('global');
state.processed = state.processed || {};   // submission_id → processed at (ms)
const now = Date.now();
const DAY_MS = 24 * 3600 * 1000;
for (const [id, t] of Object.entries(state.processed)) if (now - t > DAY_MS) delete state.processed[id];

const seenAt = sentId ? state.processed[sentId] : undefined;
if (sentId && !seenAt) state.processed[sentId] = now;

return [{ json: { ...item, duplicate: Boolean(seenAt), seen_seconds_ago: seenAt ? Math.round((now - seenAt) / 1000) : null } }];
