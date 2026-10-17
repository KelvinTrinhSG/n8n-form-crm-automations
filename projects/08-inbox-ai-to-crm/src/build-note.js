// Logs the original email on the contact's timeline as a HubSpot note, so the rep sees the context
// without opening the shared inbox. Association type 202 = note → contact (HubSpot-defined).
const p = $('Parse AI Result').item.json;
const contactId = ($json.results || [])[0]?.id;
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

return {
  json: {
    contact_id: contactId,
    request_body: {
      properties: {
        hs_timestamp: p.received_at,
        hs_note_body: `<p><b>📧 Inbound email:</b> ${esc(p.subject)}</p>`
          + `<p><b>AI summary:</b> ${esc(p.need_summary)} (intent: ${esc(p.intent)}, urgency: ${esc(p.urgency)}, confidence: ${p.confidence})</p>`
          + `<pre style="white-space:pre-wrap">${esc(p.body_text)}</pre>`,
      },
      associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] }],
    },
  },
};
