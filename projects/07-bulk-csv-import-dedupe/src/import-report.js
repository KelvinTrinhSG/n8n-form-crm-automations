// Summarises the import for the person who uploaded the file:
// created vs updated (HubSpot's "new" flag), rejected rows with reasons, failed batches.
// Runs after the batch upsert (one item per batch, same order) or directly when no row was valid.
const prepared = $('Clean, Validate & Dedupe').all().map((i) => i.json);
const { stats, rejects } = prepared[0];
const responses = prepared[0].has_batches ? $input.all().map((i) => i.json) : [];

let created = 0;
let updated = 0;
const failed = [...rejects];
responses.forEach((res, i) => {
  const batch = prepared[i];
  if (res.error) {
    // The whole batch failed (after 3 retries): report every email in it so nothing is silently lost.
    const message = typeof res.error === 'object' ? res.error.message : String(res.error);
    batch.emails.forEach((e) => failed.push({ row: '', email: e, reason: `batch ${batch.batch} failed: ${message}`.slice(0, 300), data: '' }));
    return;
  }
  for (const r of res.results || []) (r.new ? created++ : updated++);
  // 207 Multi-Status: some inputs failed inside an otherwise successful batch.
  for (const e of res.errors || []) failed.push({ row: '', email: (e.context?.ids || []).join(', '), reason: e.message, data: '' });
});

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sample = failed.slice(0, 20).map((f) => `<tr><td>${esc(f.row)}</td><td>${esc(f.email)}</td><td>${esc(f.reason)}</td></tr>`).join('');

return [{
  json: {
    email_to: stats.uploaded_by,
    email_subject: `Import finished: ${created} created, ${updated} updated, ${failed.length} need attention (${stats.source})`,
    email_html: `<div style="font-family:Arial;font-size:14px">
<h3 style="margin:0">Lead import · ${esc(stats.source)}</h3>
<table cellpadding="4">
<tr><td>Rows in file</td><td><b>${stats.total_rows}</b></td></tr>
<tr><td>New contacts created</td><td><b>${created}</b></td></tr>
<tr><td>Existing contacts updated</td><td><b>${updated}</b></td></tr>
<tr><td>Duplicates merged in the file</td><td><b>${stats.duplicates_merged}</b></td></tr>
<tr><td>Rejected / failed</td><td><b>${failed.length}</b></td></tr>
</table>
${failed.length ? `<p>Full list in the <b>Import Rejects</b> tab. First ${Math.min(20, failed.length)}:</p><table border="1" cellpadding="4" style="border-collapse:collapse"><tr><th>Row</th><th>Email</th><th>Reason</th></tr>${sample}</table>` : '<p>✅ Every row was imported.</p>'}
</div>`,
    rejects: failed.map((f) => ({ ...f, source: stats.source, imported_at: new Date().toISOString() })),
  },
}];
