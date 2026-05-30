// Content script — runs in aistudio.google.com page context
// All API calls happen here so browser auto-includes google.com cookies

(function () {
  let appletId = null;
  let fabEl    = null;   // floating action button
  let labelEl  = null;   // text label inside FAB
  let tooltipEl = null;  // hover tooltip

  function getAppletId() {
    const m = window.location.pathname.match(/\/apps\/([a-f0-9-]+)/);
    return m ? m[1] : null;
  }

  function formatTime(ts) {
    if (!ts) return "–";
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  // state: "idle" | "syncing" | "success" | "uptodate" | "error"
  function setStatus(state, tooltip) {
    if (!fabEl) return;

    const cfg = {
      idle:     { icon: iconSync(),    label: "Sync",    color: "rgba(255,255,255,0.10)", border: "rgba(255,255,255,0.14)", text: "#e2e8f0" },
      syncing:  { icon: iconSpin(),    label: "Syncing", color: "rgba(56,189,248,0.10)",  border: "rgba(56,189,248,0.25)",  text: "#7dd3fc" },
      success:  { icon: iconCheck(),   label: "Synced",  color: "rgba(52,211,153,0.12)",  border: "rgba(52,211,153,0.3)",   text: "#6ee7b7" },
      uptodate: { icon: iconCheck(),   label: "Up to date", color: "rgba(255,255,255,0.08)", border: "rgba(255,255,255,0.12)", text: "#94a3b8" },
      error:    { icon: iconX(),       label: "Error",   color: "rgba(248,113,113,0.12)", border: "rgba(248,113,113,0.3)",  text: "#fca5a5" },
    };
    const c = cfg[state] || cfg.idle;

    fabEl.disabled = state === "syncing";
    fabEl.style.background   = c.color;
    fabEl.style.borderColor  = c.border;
    fabEl.style.color        = c.text;
    fabEl.style.cursor       = state === "syncing" ? "default" : "pointer";

    // Icon + label inside button
    fabEl.innerHTML = `
      <span style="display:inline-flex;align-items:center;gap:0">
        ${c.icon}
        <span id="fab-label" style="
          max-width:0; overflow:hidden; white-space:nowrap;
          transition:max-width 0.25s ease, opacity 0.25s ease, margin 0.25s ease;
          opacity:0; font-size:12px; font-weight:500; letter-spacing:0.01em;
          margin-left:0;
        ">${c.label}</span>
      </span>`;

    labelEl = fabEl.querySelector("#fab-label");

    // Tooltip text
    if (tooltipEl) tooltipEl.textContent = tooltip || "";
  }

  // ── SVG icons ────────────────────────────────────────────────────────────
  function svgWrap(path, w = 15, h = 15) {
    return `<svg width="${w}" height="${h}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  }
  function iconSync() {
    return svgWrap(`<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
      <polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>`);
  }
  function iconCheck() {
    return svgWrap(`<polyline points="20 6 9 17 4 12"/>`);
  }
  function iconX() {
    return svgWrap(`<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`);
  }
  function iconSpin() {
    return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
      stroke-linecap="round" style="animation:gs-spin 0.75s linear infinite">
      <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
    </svg>`;
  }

  // ── Core sync logic ──────────────────────────────────────────────────────

  async function cacheFileForInterceptor(base64) {
    try {
      const rawBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const hashBuf  = await crypto.subtle.digest("SHA-256", rawBytes);
      const sha256   = Array.from(new Uint8Array(hashBuf))
        .map(b => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem("git_sync_file_" + sha256, base64);
    } catch (_) { /* silent */ }
  }

  async function runSync() {
    if (!appletId) throw new Error("No applet ID");
    if (!chrome?.storage?.sync) throw new Error("Extension context lost — reload the page (F5)");

    const settings = await chrome.storage.sync.get(["githubToken", "githubRepo", "githubBranch"]);
    const { githubToken, githubRepo, githubBranch = "main" } = settings;

    if (!githubToken || !githubRepo) throw new Error("Configure token and repo in the extension popup");
    const [owner, repo] = githubRepo.split("/");
    if (!owner || !repo) throw new Error("Invalid repo format — use owner/repo");

    const authHeader = await getAuthHeader();
    const latestSha  = await getLatestCommitSha(owner, repo, githubBranch, githubToken);

    const storageKey = `lastSyncSha_${appletId}`;
    const stored     = await chrome.storage.local.get(storageKey);
    if (stored[storageKey] === latestSha) {
      return { message: "Already up to date", sha: latestSha };
    }

    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("git_sync_file_")) localStorage.removeItem(key);
    }

    const files = await getFileTree(owner, repo, latestSha, githubToken);
    for (const file of files) {
      let base64;
      try {
        base64 = await getFileContent(owner, repo, file.path, githubToken, file.sha);
      } catch (e) {
        throw new Error(`${file.path}: ${e.message}`);
      }
      try {
        await writeFile(appletId, authHeader, file.path, base64);
      } catch (e) {
        throw new Error(`Write failed — ${file.path}: ${e.message}`);
      }
      await cacheFileForInterceptor(base64);
    }

    await chrome.storage.local.set({ [storageKey]: latestSha, lastSyncTime: Date.now() });
    return { message: `Synced ${files.length} files`, sha: latestSha };
  }

  // ── Background message handler ────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "SYNC" && msg.appletId === appletId) {
      runSync()
        .then(result => {
          if (!result.message.startsWith("Already")) {
            setStatus("success", `${result.message} — reloading…`);
            setTimeout(() => location.reload(), 2000);
          } else {
            setStatus("uptodate", `Up to date · ${formatTime(Date.now())}`);
            setTimeout(() => setStatus("idle", `Last: ${formatTime(Date.now())}`), 3000);
          }
          sendResponse({ ok: true, ...result });
        })
        .catch(err => {
          setStatus("error", err.message);
          sendResponse({ ok: false, error: err.message });
        });
      return true;
    }
  });

  // ── Create FAB ────────────────────────────────────────────────────────────
  function createUI() {
    if (!document.getElementById("gs-styles")) {
      const style = document.createElement("style");
      style.id = "gs-styles";
      style.textContent = `
        @keyframes gs-spin { to { transform: rotate(360deg); } }

        #gs-fab {
          position: fixed;
          bottom: 24px;
          right: 24px;
          z-index: 99999;
          height: 36px;
          min-width: 36px;
          padding: 0 10px;
          border-radius: 18px;
          border: 1px solid rgba(255,255,255,0.14);
          background: rgba(255,255,255,0.10);
          color: #e2e8f0;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: background 0.2s, border-color 0.2s, color 0.2s,
                      box-shadow 0.2s, padding 0.25s;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          outline: none;
        }
        #gs-fab:hover:not(:disabled) {
          box-shadow: 0 4px 16px rgba(0,0,0,0.4);
          filter: brightness(1.12);
        }
        #gs-fab:hover #fab-label {
          max-width: 80px !important;
          opacity: 1 !important;
          margin-left: 6px !important;
        }

        #gs-tooltip {
          position: fixed;
          bottom: 68px;
          right: 24px;
          z-index: 99999;
          background: #1e293b;
          color: #94a3b8;
          font-size: 11px;
          padding: 5px 10px;
          border-radius: 7px;
          border: 1px solid rgba(255,255,255,0.09);
          box-shadow: 0 4px 14px rgba(0,0,0,0.4);
          white-space: nowrap;
          pointer-events: none;
          opacity: 0;
          transform: translateY(4px);
          transition: opacity 0.15s ease, transform 0.15s ease;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          max-width: 280px;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        #gs-fab:hover ~ #gs-tooltip,
        #gs-fab:focus ~ #gs-tooltip {
          opacity: 1;
          transform: translateY(0);
        }
      `;
      document.head.appendChild(style);
    }

    fabEl = document.createElement("button");
    fabEl.id = "gs-fab";

    tooltipEl = document.createElement("div");
    tooltipEl.id = "gs-tooltip";

    const wrapper = document.createElement("div");
    wrapper.id = "git-sync-widget";
    wrapper.style.cssText = "position:fixed;bottom:24px;right:24px;z-index:99999;";
    wrapper.appendChild(fabEl);
    wrapper.appendChild(tooltipEl);
    document.body.appendChild(wrapper);

    fabEl.addEventListener("click", async () => {
      setStatus("syncing", "Syncing…");
      try {
        const result = await runSync();
        if (result.message.startsWith("Already")) {
          setStatus("uptodate", `Up to date · ${formatTime(Date.now())}`);
          setTimeout(() => setStatus("idle", `Last: ${formatTime(Date.now())}`), 3000);
        } else {
          setStatus("success", `${result.message} · reloading…`);
          setTimeout(() => location.reload(), 2000);
        }
      } catch (err) {
        setStatus("error", err.message);
      }
    });

    chrome.storage.local.get("lastSyncTime", ({ lastSyncTime }) => {
      const detail = lastSyncTime ? `Last sync: ${formatTime(lastSyncTime)}` : "Not synced yet";
      setStatus("idle", detail);
    });
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  function init() {
    appletId = getAppletId();
    if (!appletId || document.getElementById("git-sync-widget")) return;

    // Check user preference before creating UI
    chrome.storage.sync.get("showButton", ({ showButton }) => {
      if (showButton === false) return;
      createUI();
    });
  }

  if (document.readyState === "complete") init();
  else window.addEventListener("load", init);

  // Re-init on SPA navigation
  let lastPath = location.pathname;
  const navObserver = new MutationObserver(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      document.getElementById("git-sync-widget")?.remove();
      document.getElementById("gs-styles")?.remove();
      fabEl = null; labelEl = null; tooltipEl = null;
      setTimeout(init, 500);
    }
  });
  navObserver.observe(document.body, { childList: true, subtree: true });
})();
