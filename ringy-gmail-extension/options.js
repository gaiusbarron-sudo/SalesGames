(async () => {
  const $ = id => document.getElementById(id);
  const s = await loadSettings();

  s.templates.forEach((t, i) => {
    const f = document.createElement("fieldset");
    f.innerHTML = `
      <legend>Template ${i + 1}</legend>
      <label>Name (shown in the picker)</label><input data-k="name">
      <label>Subject</label><input data-k="subject">
      <label>Body</label><div class="editor" contenteditable="true" data-k="body"></div>`;
    for (const el of f.querySelectorAll("input[data-k]")) el.value = t[el.dataset.k] || "";
    f.querySelector(".editor").innerHTML = templateHtml(t.body);
    f.dataset.i = i;
    $("templates").appendChild(f);
  });
  $("fallback").value = s.fallbackName;
  $("ignore").value = s.ignoreEmails;
  $("acct").value = s.gmailAccount;

  $("save").addEventListener("click", async () => {
    const templates = [...document.querySelectorAll("fieldset")].map(f => {
      const o = {};
      for (const el of f.querySelectorAll("input[data-k]")) o[el.dataset.k] = el.value;
      const ed = f.querySelector(".editor");
      o.body = ed.textContent.trim() || ed.querySelector("img") ? ed.innerHTML : "";
      return o;
    });
    await chrome.storage.local.set({ settings: {
      templates,
      fallbackName: $("fallback").value.trim() || "there",
      ignoreEmails: $("ignore").value.trim(),
      gmailAccount: Number($("acct").value) || 0
    }});
    $("saved").hidden = false;
    setTimeout(() => { $("saved").hidden = true; }, 1500);
  });

  $("shortcuts").addEventListener("click", e => {
    e.preventDefault();
    chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
  });
})();
