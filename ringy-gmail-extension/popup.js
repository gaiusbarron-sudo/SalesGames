(async () => {
  const $ = id => document.getElementById(id);
  const settings = await loadSettings();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.action.setBadgeText({ text: "" });

  let lead = { firstName: "", lastName: "", fullName: "", email: "", allEmails: [] };
  try { lead = (await getLead(tab.id, settings)) || lead; } catch (e) { /* not scriptable */ }

  $("name").value = lead.firstName || "";
  $("email").value = lead.email || "";
  for (const e of lead.allEmails || []) {
    const o = document.createElement("option"); o.value = e; $("emails").appendChild(o);
  }
  $("warn").hidden = !!lead.email;
  $("email").addEventListener("input", () => { $("warn").hidden = !!$("email").value.trim(); });

  async function send(template) {
    const edited = Object.assign({}, lead, { firstName: $("name").value.trim(), email: $("email").value.trim() });
    if (edited.firstName !== lead.firstName) { edited.fullName = edited.firstName; edited.lastName = ""; }
    await chrome.tabs.create({ url: gmailComposeUrl(edited, template, settings), index: tab.index + 1 });
    window.close();
  }

  const all = [...settings.templates.map((t, i) => ({ t, key: String(i + 1), label: t.name || `Template ${i + 1}` })),
               { t: null, key: "0", label: "Blank email (use a Gmail template yourself)" }];
  for (const { t, key, label } of all) {
    const b = document.createElement("button");
    b.innerHTML = `<span></span><kbd>${key}</kbd>`;
    b.firstChild.textContent = label;
    b.addEventListener("click", () => send(t));
    $("btns").appendChild(b);
  }
  document.addEventListener("keydown", e => {
    if (e.target.tagName === "INPUT" && !e.altKey) return;
    const hit = all.find(x => x.key === e.key);
    if (hit) { e.preventDefault(); send(hit.t); }
  });
  $("btns").firstChild.focus();
  $("opts").addEventListener("click", e => { e.preventDefault(); chrome.runtime.openOptionsPage(); });
})();
