const $ = id => document.getElementById(id);

// ── Tab switching ─────────────────────────────────────────────────────────

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    $("tab-" + tab).classList.add("active");
    if (tab === "history") renderHistory();
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────

function showStatus(msg, isError) {
  const strip = $("status-strip");
  $("status-text").textContent = msg;
  strip.className = isError ? "err" : "ok";
  strip.style.display = "flex";
}

function hideStatus() {
  $("status-strip").style.display = "none";
}

async function getActiveAppletId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const url  = tabs[0]?.url || "";
  const m    = url.match(/aistudio\.google\.com\/apps\/([a-f0-9-]+)/);
  return m ? m[1] : null;
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60)  return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Load saved settings ───────────────────────────────────────────────────

chrome.storage.sync.get(
  ["githubToken", "githubRepo", "githubBranch", "showButton"],
  (s) => {
    if (s.githubToken) $("token").value = s.githubToken;
    if (s.githubRepo)  $("repo").value  = s.githubRepo;
    $("branch").value = s.githubBranch || "main";
    $("showButton").checked = s.showButton !== false;
  }
);

chrome.storage.local.get("autoSyncInterval", (s) => {
  $("interval").value = s.autoSyncInterval || 0;
});

// ── Token visibility toggle ───────────────────────────────────────────────

$("toggleToken").addEventListener("click", () => {
  const inp = $("token");
  const showing = inp.type === "text";
  inp.type = showing ? "password" : "text";
  $("eyeIcon").innerHTML = showing
    ? `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`
    : `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
      <line x1="1" y1="1" x2="23" y2="23"/>`;
});

// ── Save settings ─────────────────────────────────────────────────────────

$("saveBtn").addEventListener("click", async () => {
  const token      = $("token").value.trim();
  const repo       = $("repo").value.trim();
  const branch     = $("branch").value.trim() || "main";
  const interval   = parseInt($("interval").value) || 0;
  const showButton = $("showButton").checked;

  if (!token) { showStatus("GitHub token is required", true); return; }
  if (!repo)  { showStatus("Repository is required", true); return; }
  if (!repo.includes("/")) {
    showStatus("Repo must be owner/repo format", true); return;
  }

  await chrome.storage.sync.set({ githubToken: token, githubRepo: repo, githubBranch: branch, showButton });
  await chrome.storage.local.set({ autoSyncInterval: interval });

  await chrome.alarms.clear("auto-sync");
  if (interval > 0) chrome.alarms.create("auto-sync", { periodInMinutes: interval });

  showStatus(
    interval > 0
      ? `Saved — auto-sync every ${interval} min`
      : "Settings saved",
    false
  );
  setTimeout(hideStatus, 3000);
});

// ── Sync Now ──────────────────────────────────────────────────────────────

$("syncBtn").addEventListener("click", async () => {
  const appletId = await getActiveAppletId();
  if (!appletId) {
    showStatus("Open an AI Studio app first", true);
    return;
  }

  const btn = $("syncBtn");
  btn.disabled = true;
  btn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
         style="animation:spin 0.8s linear infinite">
      <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
    </svg> Syncing…`;
  showStatus("Syncing from GitHub…", false);

  await chrome.storage.local.set({ appletId });
  chrome.runtime.sendMessage({ type: "SYNC_FROM_POPUP", appletId }, (res) => {
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
        <polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
      </svg> Sync Now`;

    if (!res) {
      showStatus("No response — reload the AI Studio tab (F5)", true);
      return;
    }
    if (res.ok) {
      const sha = res.sha ? ` (${res.sha.substring(0, 7)})` : "";
      showStatus(`✓ ${res.message}${sha}`, false);
    } else {
      showStatus(`✗ ${res.error}`, true);
    }
  });
});

// ── History tab ───────────────────────────────────────────────────────────

function svgIcon(path, color, size = 11) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

function renderHistory() {
  chrome.storage.local.get("syncHistory", ({ syncHistory }) => {
    const history = syncHistory || [];

    // Aggregate stats
    const total     = history.length;
    const successes = history.filter(e => e.ok).length;
    const files     = history.reduce((sum, e) => sum + (e.ok && !e.uptodate ? e.files : 0), 0);
    const rate      = total > 0 ? Math.round((successes / total) * 100) : null;

    $("stat-total").textContent = total || "–";
    $("stat-files").textContent = files > 999 ? `${(files / 1000).toFixed(1)}k` : (files || "–");
    $("stat-rate").textContent  = rate !== null ? `${rate}%` : "–";

    // History list
    const list = $("history-list");
    if (!history.length) {
      list.innerHTML = `<div class="history-empty">No syncs yet</div>`;
      return;
    }

    list.innerHTML = history.map(entry => {
      let iconClass, iconSvg, mainHtml;

      if (!entry.ok) {
        iconClass = "err";
        iconSvg   = svgIcon(`<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`, "#f87171");
        mainHtml  = `<span style="color:#f87171;font-size:11px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                       ${entry.error || "Unknown error"}
                     </span>`;
      } else if (entry.uptodate) {
        iconClass = "uptodate";
        iconSvg   = svgIcon(`<polyline points="20 6 9 17 4 12"/>`, "#64748b");
        mainHtml  = `${entry.sha ? `<span class="hi-sha">${entry.sha}</span>` : ""}
                     <span class="hi-files">Up to date</span>`;
      } else {
        iconClass = "ok";
        iconSvg   = svgIcon(`<polyline points="20 6 9 17 4 12"/>`, "#34d399");
        mainHtml  = `${entry.sha ? `<span class="hi-sha">${entry.sha}</span>` : ""}
                     <span class="hi-files">${entry.files} file${entry.files !== 1 ? "s" : ""}</span>`;
      }

      return `
        <div class="history-item">
          <div class="hi-icon ${iconClass}">${iconSvg}</div>
          <div class="hi-body">
            <div class="hi-main">${mainHtml}</div>
          </div>
          <div class="hi-time">${timeAgo(entry.ts)}</div>
        </div>`;
    }).join("");
  });
}

$("clearHistory").addEventListener("click", () => {
  chrome.storage.local.remove("syncHistory", renderHistory);
});

// ── Spin keyframe ─────────────────────────────────────────────────────────

const st = document.createElement("style");
st.textContent = "@keyframes spin { to { transform: rotate(360deg); } }";
document.head.appendChild(st);
