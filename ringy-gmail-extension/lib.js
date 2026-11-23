// Shared by background.js (service worker) and popup.js.

const DEFAULT_SETTINGS = {
  gmailAccount: 0,          // the /u/N/ number in your Gmail URL
  ignoreEmails: "",         // your own addresses, comma separated, so they are never picked as the client
  fallbackName: "there",    // used for {first_name} when no name is found ("Hi there,")
  templates: [
    { name: "Template 1", subject: "", body: "" },
    { name: "Template 2", subject: "", body: "" },
    { name: "Template 3", subject: "", body: "" }
  ]
};

async function loadSettings() {
  const stored = await chrome.storage.local.get("settings");
  const s = Object.assign({}, DEFAULT_SETTINGS, stored.settings || {});
  const t = (s.templates || []).slice(0, 3);
  while (t.length < 3) t.push({ name: `Template ${t.length + 1}`, subject: "", body: "" });
  s.templates = t;
  return s;
}

// Runs INSIDE the Ringy page (injected with chrome.scripting), so it must be
// self-contained: no references to anything outside this function.
function extractLeadFromPage(ignoreList) {
  const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const ignore = (ignoreList || []).map(e => e.toLowerCase());
  const isBad = e => {
    const l = e.toLowerCase();
    const domain = l.split("@")[1] || "";
    return ignore.includes(l) || /(^|\.)ringy\.com$/.test(domain) ||
      /no-?reply|example\.com|sentry|wixpress/.test(l) || /\.(png|jpe?g|gif|svg|webp)$/.test(l);
  };
  const clean = s => (s || "").replace(/\s+/g, " ").trim();
  const visible = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);

  // Label text describing a form field.
  function labelFor(el) {
    const parts = [el.getAttribute("aria-label"), el.getAttribute("placeholder"),
                   el.getAttribute("name"), el.id, el.getAttribute("data-field")];
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) parts.push(l.textContent);
    }
    const wrap = el.closest("label");
    if (wrap) parts.push(wrap.textContent);
    // Nearby label in the same small container (common in Vue/React form rows).
    const box = el.parentElement && el.parentElement.parentElement;
    if (box && box.textContent.length < 80) parts.push(box.textContent);
    return clean(parts.filter(Boolean).join(" | "));
  }

  const fields = { first: "", last: "", full: "", email: "" };
  const emails = [];
  const addEmail = e => { e = clean(e).replace(/^mailto:/i, "").split("?")[0]; if (!e || isBad(e) || emails.includes(e)) return;
    // Skip text-run-together junk like "Emailjo@x.com" when "jo@x.com" is already known.
    if (emails.some(x => e.length > x.length && e.toLowerCase().endsWith(x.toLowerCase()))) return;
    emails.push(e); };

  // 1) Form inputs (lead edit screens).
  for (const el of document.querySelectorAll("input, textarea")) {
    if (!visible(el)) continue;
    const v = clean(el.value);
    if (!v) continue;
    const lab = labelFor(el);
    if (/e-?mail/i.test(lab) && /@/.test(v)) addEmail(v);
    else if (/first[\s_-]*name|fname/i.test(lab)) fields.first ||= v;
    else if (/last[\s_-]*name|lname|surname/i.test(lab)) fields.last ||= v;
    else if (/(^|\W)(full[\s_-]*)?name(\W|$)/i.test(lab) && !/company|business|user/i.test(lab)) fields.full ||= v;
  }

  // 2) "Label: value" display layouts.
  const LABELS = [["first", /^first\s*name:?$/i], ["last", /^last\s*name:?$/i],
                  ["full", /^(full\s*name|name|lead\s*name|contact\s*name):?$/i], ["email", /^e-?mail( address)?:?$/i]];
  for (const el of document.querySelectorAll("body *")) {
    if (el.children.length > 1 || !visible(el)) continue;
    const t = clean(el.textContent);
    if (!t || t.length > 30) continue;
    for (const [key, re] of LABELS) {
      if (fields[key] && key !== "email") continue;
      if (!re.test(t)) continue;
      let val = "";
      const sib = el.nextElementSibling;
      if (sib) val = clean(sib.value || sib.textContent);
      if (!val && el.parentElement) val = clean(el.parentElement.textContent.replace(el.textContent, ""));
      if (!val || val.length > 80) continue;
      if (key === "email") { const m = val.match(EMAIL_RE); if (m) addEmail(m[0]); }
      else fields[key] = val;
    }
  }

  // 3) mailto links, then any address in the visible text.
  for (const a of document.querySelectorAll('a[href^="mailto:"]')) addEmail(a.getAttribute("href"));
  for (const m of (document.body.innerText.match(EMAIL_RE) || [])) addEmail(m);

  // Highlighted text wins: highlight an email or a name to override detection.
  const sel = clean(String(window.getSelection() || ""));
  if (sel) {
    const m = sel.match(EMAIL_RE);
    if (m) emails.unshift(m[0]);
    else if (sel.length < 50) fields.full = sel;
  }

  let first = fields.first, last = fields.last, full = fields.full;
  if (!full && (first || last)) full = clean(`${first} ${last}`);
  if (full && !first) { const p = full.split(" "); first = p[0]; last ||= p.slice(1).join(" "); }

  return { firstName: first, lastName: last, fullName: full, email: emails[0] || "", allEmails: emails };
}

async function getLead(tabId, settings) {
  const ignore = settings.ignoreEmails.split(/[,\s]+/).filter(Boolean);
  const [res] = await chrome.scripting.executeScript({
    target: { tabId }, func: extractLeadFromPage, args: [ignore]
  });
  return res && res.result;
}

function titleCase(s) {
  return (s || "").toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
}

function fillPlaceholders(text, lead, settings) {
  const first = titleCase(lead.firstName) || settings.fallbackName;
  return (text || "")
    .replace(/\{first_name\}/gi, first)
    .replace(/\{last_name\}/gi, titleCase(lead.lastName))
    .replace(/\{full_name\}/gi, titleCase(lead.fullName) || first)
    .replace(/\{email\}/gi, lead.email || "");
}

function gmailComposeUrl(lead, template, settings) {
  const p = new URLSearchParams({ view: "cm", fs: "1" });
  if (lead.email) p.set("to", lead.email);
  if (template) {
    p.set("su", fillPlaceholders(template.subject, lead, settings));
    p.set("body", fillPlaceholders(template.body, lead, settings));
  }
  return `https://mail.google.com/mail/u/${Number(settings.gmailAccount) || 0}/?${p.toString()}`;
}
