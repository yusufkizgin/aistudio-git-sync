# AI Studio Git Sync

A Chrome extension that brings **two-way GitHub sync** to [Google AI Studio](https://aistudio.google.com). AI Studio only supports pushing to GitHub natively — this extension adds the missing direction: pull your GitHub changes directly into a running AI Studio app.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-green)
![License](https://img.shields.io/badge/License-MIT-blue)

---

## Why?

When you edit your AI Studio project locally (Cursor, VS Code, Claude Code, etc.) and push to GitHub, AI Studio has no way to pick up those changes. You'd have to manually re-upload every file. This extension automates that.

**Flow:**
```
Local editor → git push → GitHub → [this extension] → AI Studio
```

---

## Features

- **Sync Now** — pulls the latest commit from GitHub and writes all files into the active AI Studio app in one click
- **Auto-sync** — optionally polls GitHub every N minutes and syncs automatically
- **Up-to-date detection** — skips network calls when the local SHA already matches GitHub (no unnecessary syncs)
- **Binary file support** — images, fonts, and other binary assets sync correctly (uses Git Blobs API, not download URLs)
- **Floating button** — a compact FAB in the bottom-right corner of AI Studio pages; can be hidden from settings
- **Non-intrusive** — doesn't touch the AI Studio UI outside of its own button

---

## Installation

This extension is not on the Chrome Web Store. Install it in **Developer Mode**:

### 1. Download the extension

```bash
git clone https://github.com/yusufkizgin/aistudio-git-sync.git
```

Or download the ZIP from GitHub and extract it.

### 2. Open Chrome Extensions

Navigate to `chrome://extensions` in your browser.

### 3. Enable Developer Mode

Toggle **Developer mode** on (top-right corner).

### 4. Load the extension

Click **Load unpacked** and select the `aistudio-git-sync` folder.

The extension icon will appear in your Chrome toolbar.

---

## Setup

### 1. Create a GitHub Personal Access Token

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens)
2. Click **Generate new token (classic)**
3. Give it a name (e.g. `ai-studio-sync`)
4. Select the **`repo`** scope (read access to your repositories)
5. Click **Generate token** and copy it

### 2. Configure the extension

Click the extension icon in your Chrome toolbar to open the popup.

| Field | Description |
|-------|-------------|
| **Personal Access Token** | Your GitHub PAT (stored locally, never sent anywhere except `api.github.com`) |
| **Repository** | Your repo in `owner/repo` format (e.g. `johndoe/my-ai-app`) |
| **Branch** | Branch to sync from (default: `main`) |
| **Auto-sync** | Interval in minutes to auto-sync in the background (`0` = disabled) |
| **Show button on page** | Toggle the floating sync button on AI Studio pages |

Click **Save** to store your settings.

---

## Usage

1. Open an AI Studio app at `aistudio.google.com/apps/...`
2. Click the floating **Sync** button in the bottom-right corner

   — or —

   Open the extension popup and click **Sync Now**

3. The extension will:
   - Fetch the latest commit SHA from GitHub
   - Compare it to the last synced SHA
   - Download all files and write them into the AI Studio app
   - Reload the page to reflect changes

The button shows real-time status: **Syncing → Synced → (page reloads)** or **Error** with a message.

---

## How It Works

```
GitHub API (commits, trees, blobs)
        ↓
  background.js (service worker)
        ↓
  content.js (message passing)
        ↓
  ApplyFileSystemOperation gRPC endpoint
  (alkalimakersuite-pa.clients6.google.com)
        ↓
  AI Studio app filesystem
```

- **Auth**: The extension generates `SAPISIDHASH` tokens from your `SAPISID` cookie — the same mechanism AI Studio itself uses. No credentials are stored or forwarded.
- **File writes**: Uses AI Studio's internal `ApplyFileSystemOperation` endpoint, which writes files directly into the running app instance.
- **CAS cache**: After writing, file content is cached in `localStorage` so AI Studio's CDN fetches are intercepted and served locally (avoids stale-content issues on page reload).

---

## Permissions

| Permission | Why |
|------------|-----|
| `storage` | Save your token, repo, and sync state locally |
| `alarms` | Schedule periodic auto-sync |
| `tabs` | Read the active tab URL to extract the AI Studio app ID |
| `https://aistudio.google.com/*` | Inject the sync button and write files |
| `https://alkalimakersuite-pa.clients6.google.com/*` | Call AI Studio's internal API |
| `https://api.github.com/*` | Fetch commits and file contents |

Your GitHub token is stored in `chrome.storage.sync` (encrypted by Chrome, scoped to your profile). It is only sent to `api.github.com`.

---

## Project Structure

```
aistudio-git-sync/
├── manifest.json          # Extension manifest (MV3)
├── popup.html             # Settings & Sync Now popup
├── popup.js               # Popup logic
├── content.js             # Floating button injected into AI Studio
├── background.js          # Service worker: sync logic, auto-sync alarms
├── interceptor.js         # fetch() interceptor for CAS file serving (MAIN world)
├── utils/
│   ├── auth.js            # SAPISIDHASH generation from cookies
│   ├── github.js          # GitHub API: commits, trees, blobs
│   └── aistudio.js        # AI Studio API: file writes
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Troubleshooting

**"Open an AI Studio app first"**
→ Navigate to an app URL (`aistudio.google.com/apps/...`) before syncing. The extension only works on app pages, not the homepage.

**"Configure token and repo in the extension popup"**
→ Open the popup, fill in your GitHub token and repo, and click Save.

**"Extension context lost — reload the page (F5)"**
→ Chrome invalidated the extension context (happens after extension updates). Refresh the AI Studio tab.

**"No response — reload the AI Studio tab (F5)"**
→ The content script is not running. Reload the AI Studio tab, then try again.

**Files sync but page shows old content**
→ Try a hard refresh (`Ctrl+Shift+R`). The interceptor serves cached files on the next normal reload.

**Auto-sync isn't firing**
→ Make sure you clicked **Save** after setting the interval. Chrome alarms require the extension to be active.

---

## License

MIT — see [LICENSE](LICENSE)
