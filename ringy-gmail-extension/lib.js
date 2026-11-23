// Shared by background.js (service worker) and popup.js.

const DEFAULT_SETTINGS = {
  gmailAccount: 0,          // the /u/N/ number in your Gmail URL
  ignoreEmails: "",         // your own addresses, comma separated, so they are never picked as the client
  fallbackName: "there",    // used for {first_name} when no name is found ("Hi there,")
  ownName: "",              // your name, so it's never picked as the client's
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
function extractLeadFromPage(ignoreList, ownName) {
  const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const ignore = (ignoreList || []).map(e => e.toLowerCase());
  const isBad = e => {
    const l = e.toLowerCase();
    const domain = l.split("@")[1] || "";
    return ignore.includes(l) || /(^|\.)ringy\.com$/.test(domain) ||
      /no-?reply|example\.com|sentry|wixpress/.test(l) || /\.(png|jpe?g|gif|svg|webp)$/.test(l);
  };
  const clean = s => (s || "").replace(/\s+/g, " ").trim();
  // Your own name (from settings), so it's never taken for the client's.
  const ownWords = clean(ownName).toLowerCase().split(" ").filter(w => w.length > 1);
  const isOwnName = t => ownWords.length > 0 && clean(t).toLowerCase().split(" ").some(w => ownWords.includes(w));
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
    // Nearest label text in the surrounding form row (Vue/React UIs nest inputs
    // several wrappers deep, with the label beside a wrapper, not the input).
    let node = el;
    for (let i = 0; i < 6 && node.parentElement; i++) {
      node = node.parentElement;
      const t = clean(node.textContent);
      if (t && t.length < 60) { parts.push(t); break; }
      if (t.length >= 60) break;
      const prev = node.previousElementSibling;
      const pt = prev && clean(prev.textContent);
      if (pt && pt.length < 40) { parts.push(pt); break; }
    }
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
  const LABELS = [["first", /^first\s*name\s*\*?:?$/i], ["last", /^last\s*name\s*\*?:?$/i],
                  ["full", /^(full\s*name|name|lead\s*name|contact\s*name|client\s*name)\s*\*?:?$/i],
                  ["email", /^(e-?mail|primary e-?mail)( address)?\s*\*?:?$/i]];
  for (const el of document.querySelectorAll("body *")) {
    if (el.children.length > 1 || !visible(el)) continue;
    const t = clean(el.textContent);
    if (!t || t.length > 30) continue;
    for (const [key, re] of LABELS) {
      if (fields[key] && key !== "email") continue;
      if (!re.test(t)) continue;
      let val = "";
      // Climb out of wrappers that hold only the label, then read the next cell/column.
      let node = el;
      while (node.parentElement && clean(node.parentElement.textContent) === t) node = node.parentElement;
      const sib = node.nextElementSibling || el.nextElementSibling;
      if (sib) {
        const inp = sib.matches("input, textarea") ? sib : sib.querySelector("input, textarea");
        val = clean(inp ? inp.value : sib.textContent);
      }
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

  // 4) No labelled name: look for a name-like heading near the client's email,
  //    working outward so your own name in the app's top bar isn't picked.
  if (!fields.first && !fields.full && emails[0]) {
    const NAME_RE = /^[A-Za-zÀ-ÿ'’.-]{2,}(?: [A-Za-zÀ-ÿ'’.-]{1,}){0,3}$/;
    const NOT_NAME = /^(lead|leads|contact|contacts|details?|info|information|overview|email|phone|notes?|activity|history|status|tags?|dashboard|settings|inbox|calendar|pipeline|tasks?|call|text|sms|send|save|edit|delete|close|cancel|new|add|search|home|reports?|campaigns?|messages?|unknown|n\/a|none|male|female|active|inactive)$/i;
    let anchor = [...document.querySelectorAll("input, textarea")].find(i => clean(i.value) === emails[0]);
    if (!anchor) {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n; (n = w.nextNode());) if (n.nodeValue.includes(emails[0])) { anchor = n.parentElement; break; }
    }
    let box = anchor;
    for (let i = 0; box && i < 6 && !fields.full; i++) {
      box = box.parentElement;
      // Never search the whole page: that's where the app's own header lives.
      if (!box || box === document.body || box === document.documentElement || box.matches("main")) break;
      let best = null, bestSize = 0;
      for (const el of box.querySelectorAll("*")) {
        if (el.children.length || !visible(el) || el.closest("nav, header, aside, [role=banner], [role=navigation], button, a[href^='mailto'], option, select")) continue;
        const t = clean(el.textContent);
        if (!NAME_RE.test(t) || t.split(" ").some(w => NOT_NAME.test(w)) || isOwnName(t)) continue;
        if (/\d/.test(t)) continue;
        const cs = getComputedStyle(el);
        const size = parseFloat(cs.fontSize) + (parseInt(cs.fontWeight) >= 600 ? 2 : 0);
        if (size > bestSize) { best = t; bestSize = size; }
      }
      // Only trust it if it stands out (bigger or bolder than body text).
      if (best && bestSize >= 16) fields.full = best;
    }
  }

  // 5) Last resort: dana.whitfield@... gives "Dana".
  if (!fields.first && !fields.full && emails[0]) {
    const local = emails[0].split("@")[0];
    const m = local.match(/^([a-z]{2,})[._-]([a-z]{2,})/i);
    if (m && !/^(info|sales|contact|admin|office|support|hello|team|mail)$/i.test(m[1])) { fields.first = m[1]; fields.last = m[2]; }
  }

  if (isOwnName(fields.first) && !fields.last) fields.first = "";
  if (isOwnName(fields.full)) fields.full = "";
  let first = fields.first, last = fields.last, full = fields.full;
  if (!full && (first || last)) full = clean(`${first} ${last}`);
  if (full && !first) { const p = full.split(" "); first = p[0]; last ||= p.slice(1).join(" "); }

  return { firstName: first, lastName: last, fullName: full, email: emails[0] || "", allEmails: emails };
}

async function getLead(tabId, settings) {
  const ignore = settings.ignoreEmails.split(/[,\s]+/).filter(Boolean);
  const [res] = await chrome.scripting.executeScript({
    target: { tabId }, func: extractLeadFromPage, args: [ignore, settings.ownName || ""]
  });
  return res && res.result;
}

function titleCase(s) {
  return (s || "").toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fillPlaceholders(text, lead, settings, html) {
  const first = titleCase(lead.firstName) || settings.fallbackName;
  const v = {
    first_name: first,
    last_name: titleCase(lead.lastName),
    full_name: titleCase(lead.fullName) || first,
    email: lead.email || ""
  };
  return (text || "").replace(/\{(first_name|last_name|full_name|email)\}/gi,
    (_, k) => html ? escapeHtml(v[k.toLowerCase()]) : v[k.toLowerCase()]);
}

// Templates saved before formatting was supported are plain text.
function templateHtml(body) {
  body = body || "";
  if (/<[a-z][\s\S]*>/i.test(body)) return body;
  return escapeHtml(body).replace(/\n/g, "<br>");
}

// The address and subject go in the Gmail link; the formatted body can't
// (links only carry plain text), so gmail.js pastes it into the draft.
function gmailComposeUrl(lead, template, settings) {
  const p = new URLSearchParams({ view: "cm", fs: "1" });
  if (lead.email) p.set("to", lead.email);
  if (template && template.subject) p.set("su", fillPlaceholders(template.subject, lead, settings, false));
  return `https://mail.google.com/mail/u/${Number(settings.gmailAccount) || 0}/?${p.toString()}`;
}

async function openDraft(lead, template, settings, index) {
  const tab = await chrome.tabs.create({ url: gmailComposeUrl(lead, template, settings), index });
  if (template && (template.body || "").trim()) {
    const html = fillPlaceholders(templateHtml(template.body), lead, settings, true);
    await chrome.storage.session.set({ ["pending-" + tab.id]: { html, at: Date.now() } });
  }
  return tab;
}
