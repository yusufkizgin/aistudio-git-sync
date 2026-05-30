// Background handles only alarms and routing — AI Studio API calls are in content.js

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "SYNC_FROM_POPUP") {
    // Find AI Studio tab and forward sync request to content script
    chrome.tabs.query({ url: "https://aistudio.google.com/apps/*" }, (tabs) => {
      if (!tabs.length) {
        sendResponse({ ok: false, error: "No AI Studio app tab found — open aistudio.google.com/apps/... first" });
        return;
      }
      chrome.tabs.sendMessage(tabs[0].id, { type: "SYNC", appletId: msg.appletId }, (res) => {
        sendResponse(res || { ok: false, error: "No response from content script" });
      });
    });
    return true;
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "auto-sync") return;
  const { appletId } = await chrome.storage.local.get("appletId");
  if (!appletId) return;

  const tabs = await chrome.tabs.query({ url: "https://aistudio.google.com/apps/*" });
  if (!tabs.length) return;
  chrome.tabs.sendMessage(tabs[0].id, { type: "SYNC", appletId });
});

chrome.storage.onChanged.addListener(async (changes) => {
  if (!("autoSyncInterval" in changes)) return;
  await chrome.alarms.clear("auto-sync");
  const interval = changes.autoSyncInterval.newValue;
  if (interval > 0) chrome.alarms.create("auto-sync", { periodInMinutes: interval });
});
