// Runs on Gmail. If this tab was opened by the extension, paste the
// formatted template into the draft, above the signature Gmail adds.
(async () => {
  let html;
  try { html = await chrome.runtime.sendMessage("ringy-take-pending"); } catch (e) { return; }
  if (!html) return;

  const findBody = () => [...document.querySelectorAll('div[contenteditable="true"][role="textbox"], div[g_editable="true"]')]
    .find(el => el.offsetWidth || el.offsetHeight);

  let body;
  for (let i = 0; i < 100 && !(body = findBody()); i++) await new Promise(r => setTimeout(r, 200));
  if (!body) return;
  await new Promise(r => setTimeout(r, 400)); // let Gmail finish adding the signature

  // Strip anything that could run code; keep formatting, links and images.
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, iframe, object, embed, meta, link").forEach(n => n.remove());
  doc.querySelectorAll("*").forEach(n => {
    for (const a of [...n.attributes]) {
      if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) n.removeAttribute(a.name);
    }
  });
  const clean = doc.body.innerHTML;

  body.focus();
  const range = document.createRange();
  range.setStart(body, 0);
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  // execCommand goes through Gmail's editor so it registers the change and
  // saves the draft; fall back to a direct insert if it refuses.
  if (!document.execCommand("insertHTML", false, clean + "<br>")) {
    const frag = range.createContextualFragment(clean + "<br>");
    body.insertBefore(frag, body.firstChild);
    body.dispatchEvent(new InputEvent("input", { bubbles: true }));
  }
  // Leave the cursor at the top so you can edit straight away.
  body.scrollTop = 0;
})();
