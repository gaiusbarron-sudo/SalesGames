importScripts("lib.js");

chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  const m = /^template-(\d)$/.exec(command);
  if (!m || !tab) return;
  const settings = await loadSettings();
  const template = settings.templates[Number(m[1]) - 1];
  let lead = { firstName: "", lastName: "", fullName: "", email: "" };
  try {
    lead = (await getLead(tab.id, settings)) || lead;
  } catch (e) {
    // Page can't be scripted (e.g. chrome:// page); still open the draft.
  }
  await chrome.tabs.create({ url: gmailComposeUrl(lead, template, settings), index: tab.index + 1 });
  // Flag a missing address on the toolbar icon so it's noticed before sending.
  chrome.action.setBadgeText({ text: lead.email ? "" : "!" });
  chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
});
