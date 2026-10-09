# Artifact Dock

> Your agent writes an HTML report — and Chrome jumps in front of your terminal. Again. And again.
> **Artifact Dock keeps every agent-generated HTML page in one place**: opened in a background tab,
> one tab per document, listed in a side panel. Your focus stays where you were typing.

**[Chrome Web Store](https://chromewebstore.google.com/detail/artifact-dock/nfifnjdpmjacfelfapgeibnnbkokceim)** ·
Open source (MIT) · macOS · [Privacy policy](PRIVACY.md) · [한국어](README.ko.md)

[![Artifact Dock demo — without it, every `open` pulls Chrome to the front and the tab bar fills up (18 tabs from 4 sessions). With it, pages open quietly beside the terminal and land in one side panel.](docs/media/artifact-dock-demo.gif)](docs/media/artifact-dock-demo.mp4)

▶ **[Watch the 43-second demo (MP4)](docs/media/artifact-dock-demo.mp4)** — recorded live: a real Claude Code session
running `/eli5` in a plain terminal, next to Chrome. Before: four sessions, 18 tabs, Chrome covering the terminal on every open.
After: the same work, the terminal never loses focus, and the docs collect in the side panel.

Great with skills that explain things as HTML (like an `/eli5` page, a review board, or a test report): keep the agent on
the left, read the result on the right, never resize or Cmd-Tab between them.

## What it fixes

| Symptom | Cause | What Artifact Dock does |
|---|---|---|
| Every new file pulls the screen over to Chrome | `open` brings **the whole Chrome app** to the front | The CLI asks the extension over a socket → the extension creates a **background tab** with `tabs.create({active:false})` |
| The same report opens a new tab every time | No dedup | Reuses the existing tab by file path (or file name / title) and reloads it |
| So many tabs you only see favicons | Tab bar overflow | One side-panel list + one tab group |

### Why a CLI alone can't do it (measured)

Neither `open -g` (the "don't bring the app forward" flag) nor AppleScript `make new tab` stops it — **Chrome brings itself forward.**

```
base=Finder  →  0.3s: Google Chrome  0.7s: Google Chrome   ← even with open -g
```

Pages open only when the extension is connected. It creates a background tab with `tabs.create({active:false})`
and reuses an existing tab by path, file name, or title rules.

If the extension isn't connected or doesn't answer, the CLI fails. The old AppleScript fallback was removed on
2026-09-23 — not starting a direct open at all is more reliable than trying to restore focus afterwards.

## Install

Install the extension from the Chrome Web Store or from source (load unpacked). **Either way, install the CLI and
native host separately with `install.sh`** — an extension can't install local programs.

```bash
git clone https://github.com/woorichicken/artifact-dock.git
cd artifact-dock
./install.sh
```

Both extension IDs listed in `host/.extension-id` (source build and Web Store) are allowed, so either install connects.

To load from source, in Chrome:

1. `chrome://extensions` → turn on **Developer mode** (top right)
2. **Load unpacked** → select this folder
3. In the extension details, turn on **"Allow access to file URLs"** (it handles local HTML)
4. Check:

```bash
artifact-open --status     # prints "확장 연결: 살아있음 (…dock.sock)" (= connected) when you're done
```

> If `--status` says not connected, turn the extension off and on. The native host starts when the extension starts.

## First run

Right after install, a **setup tab** opens. It asks the browser directly whether file-URL access and the CLI
connection are working, and lets you copy a prompt to paste into your agent. The 🤖 button in the side panel copies
the same prompt. After closing it, use "Show setup guide again" at the top of the settings.

The UI follows the browser language — Korean, English, Spanish; anything else falls back to English.
Strings live in `_locales/<lang>/messages.json`.

## Usage

```bash
artifact-open report.html          # open in the background (reloads the existing tab for the same file)
artifact-open a.html b.html        # several at once
artifact-open -f report.html       # bring it to the front this time only
artifact-open --status
```

Open the side panel with the toolbar icon or `Cmd+Shift+U`.

### Let your agent set it up

Copy the **setup prompt** from step 4 of the setup tab (or 🤖 in the side panel) and paste it into a Claude Code or
Codex conversation. The agent does the rest: clone → `install.sh` → put `~/.local/bin` before `/usr/bin` in your shell
config (`~/.zshrc`) → check `command -v open` and `artifact-open --status` → confirm a temporary HTML opens in the background.

Instead of writing an instruction into CLAUDE.md, Artifact Dock **intercepts `open` itself**. Even if the agent forgets
an instruction, or a script or Node calls `open` directly, it goes through the same path (next section).

### Blocking direct HTML opens (2026-09-23)

`./install.sh --cli-only` links only `~/.local/bin/artifact-open` and `~/.local/bin/open`, without touching an existing
native host registration. If another executable is already there, it stops instead of overwriting it.
`~/.local/bin` must come before `/usr/bin` in `PATH`.

- `open report.html` and Node's `execFileSync("open", [file])` both go to Artifact Dock through the executable wrapper.
  A `.zshrc` function alone can't intercept Node's direct exec.
- `.html`/`.htm` are matched case-insensitively, including file/HTTP URLs with query strings and fragments.
  `-g`, `-a <app>` and `-b <bundle>` are accepted, but HTML still opens in the background through the extension.
  Unsupported options for HTML, or HTML mixed with other files, are rejected before running.
- Non-HTML commands are passed to `/usr/bin/open` unchanged.
- If the extension isn't connected, errors, or answers badly, `artifact-open` exits with a failure.
  It never falls back to AppleScript or macOS `open`. The old `_open_quietly.py` follows the same rule.
- This is not an OS security boundary: a direct `/usr/bin/open` call or a program that rewrites `PATH` gets around it.
  Regression-test direct opener calls in your HTML-producing scripts too.

Tests: `python3 tests/open_guard.test.py` checks success, failure and the Node path with a fake socket and fake
commands, so no real Chrome opens. `./install.sh --uninstall` removes only its own CLI links.

## Cleaning up tabs that are already open

Dedup works **only when opening**. For tabs that piled up before the extension was on, use **[Tidy up]** at the
bottom of the side panel.

- Keeps one tab per document and closes the rest (active tab > Chrome-pinned tab > most recently viewed)
- Removes entries whose **file was deleted** (reports in `/tmp` disappear on reboot or cleanup) and closes their tabs
- Gathers scattered artifact tabs into one tab group
- Can run automatically **when the browser starts** (settings)

In the list, duplicates of the same document collapse into one row with a `×3` badge. Click the badge to close just
that document's duplicates.

> If reports with the same title but different file names keep piling up, set **Same-document rule → Document title**.

### Deleted files and old documents

The extension can't see whether a `file://` file still exists, so it asks the native host (it checks existence only and
never reads the file). Entries whose file is gone are struck through with a **Deleted** tag; clicking one shows a notice
instead of opening a "file not found" page.

| Setting | Default | What runs (once an hour and when the browser starts) |
|---|---|---|
| Remove deleted files automatically | On | Drops deleted files from **Recently closed**. Open tabs close only when you press [Tidy up] |
| Remove old documents automatically (days) | 0 (off) | Documents not reopened *or* viewed for N days: their tabs close and they leave the list |

Pinned (📌) documents, the tab you're viewing and Chrome-pinned tabs are never removed.
The existence check needs the **0.5.0 host** — after `git pull`, turn the extension off and on so the new host starts.
With an older host nothing is marked or removed.

## The side panel list

- **Newest first** — sorted by when the document was last opened or rewritten by your agent, not by tab position.
  Picking a document in the list doesn't reorder it (in "show one tab" mode the tab moves in and out of the group,
  and the old tab-order list jumped around).
- **Search** matches the title, folder and full path. Korean works even for macOS file names (stored decomposed, NFD),
  and the last syllable you're still typing is matched loosely so results don't blink while composing.
- The list redraws only when an artifact tab changes. Title updates in other sites' tabs (mail and chat unread counts)
  no longer rebuild it.

## When the tab bar fills with favicons

Chrome **expands a collapsed group whenever a tab inside it is activated.** That can't be prevented, and Chrome
refuses to collapse a group that contains the active tab. Artifact Dock works around it in two ways.

| Setting | Behavior |
|---|---|
| **Show one tab** (default) | Pulls only the tab you're viewing out of the group; the rest stay collapsed. When you leave that tab, it quietly goes back into the group |
| | ↳ `ungroup` and activation **themselves expand the group**, so it remembers whether the group was collapsed and restores that once the tab is outside the group (the only moment collapsing is allowed) |
| | ↳ **Adding a tab to a group also expands it.** Collapse restoration happens in one place, `groupTabs()`, and every path goes through it |
| | ↳ Pulled-out tabs are restored from **actual state**, not a log — every pass sweeps "artifact tabs outside the group" back in, so tabs don't get stranded even if the service worker dies |
| Expand group | Activates normally, and re-collapses the group as soon as you switch to another tab |

To cap the number of tabs, set **Maximum artifact tabs**. Past the limit, the least recently viewed close first —
but they stay in the side-panel list and come back with one click. Pinned (📌) documents and the tab you're viewing
are never closed. **[Close tabs]** at the bottom does the same: closes tabs, keeps the list.

## When the same document doesn't merge

- **macOS symlinks**: `/tmp` is a symlink to `/private/tmp`, so the same file could split into two documents depending
  on which form Chrome used in the URL. `/tmp`, `/var` and `/etc` are compared with the `/private` prefix removed.
- **Same file name, different path**: separate documents under the default (full path) rule. Switch to
  `File name only` or `Document title` in settings.

## Tabs [Tidy up] leaves alone

| Tab | Why |
|---|---|
| The tab you're viewing | In "show one tab" mode it's deliberately kept outside the group (putting it in would expand the group) |
| Chrome-pinned tabs | Pinned tabs can't join a group |
| Tabs in another window | Not moved across windows; that window gets its own group |
| Non-HTML `file://` | PDFs, images, etc. aren't managed |

## Publishing to the Chrome Web Store (maintainers)

`scripts/publish-cws.mjs` uploads the zip from `scripts/build-cws.sh` and submits it for review through the
[Chrome Web Store API v2](https://developer.chrome.com/docs/webstore/using-api) (scope
`https://www.googleapis.com/auth/chromewebstore`). No dependencies — Node 18+ `fetch`.

### One-time setup

In the consoles (scripts can't do this part):

1. **Google Cloud Console** → create or pick a project → APIs & Services → enable **Chrome Web Store API**.
2. **OAuth consent screen**: user type **External**, fill in app name and emails, and add the Google account that owns
   the store listing under **Test users**. Google issues 7-day refresh tokens to External apps in **Testing** status;
   switch the publishing status to **In production** if you don't want to re-run step 6 every week.
3. **Credentials → Create credentials → OAuth client ID → Desktop app.** A desktop client allows the loopback
   redirect (`http://127.0.0.1:<port>`) the helper uses. Keep the client ID and secret.
4. **Chrome Web Store Developer Dashboard → Publisher → Settings** → copy the **Publisher ID**. The publishing account
   needs 2-Step Verification.

Then in a terminal:

5. Create `~/.config/artifact-dock/cws.env` with an editor (not in the repo; `chmod 600` it):
   ```bash
   CWS_CLIENT_ID='…'
   CWS_CLIENT_SECRET='…'
   CWS_PUBLISHER_ID='…'
   ```
6. Get a refresh token once — it prints a Google sign-in URL, waits on `127.0.0.1`, and writes `CWS_REFRESH_TOKEN`
   into the same file (mode 600). Token values are never printed; the sign-in URL contains only the client ID,
   which OAuth sends through the browser anyway.
   ```bash
   (set -a; . ~/.config/artifact-dock/cws.env; set +a; node scripts/cws-auth.mjs)
   ```

### Every release — one line

Bump `version` in `manifest.json`, then:

```bash
scripts/build-cws.sh && (set -a; . ~/.config/artifact-dock/cws.env; set +a; node scripts/publish-cws.mjs)
```

It refreshes the access token, uploads, waits while the upload is `IN_PROGRESS`, submits, and prints the review state
(`PENDING_REVIEW` → `PUBLISHED`). Failures come back as a sentence with the next step (expired token, API not
enabled, wrong publisher ID, version not bumped).

| Option | |
|---|---|
| `--dry-run` | No network. Shows the zip, which variables are empty, and the requests it would send |
| `--status` | Only print the current review state |
| `--no-publish` | Upload without submitting |
| `--staged` | After approval, wait for a manual publish (`STAGED_PUBLISH`) |
| `--zip <path>` | Upload another zip (default `dist/artifact-dock-<version>.zip`) |

Variables: `CWS_CLIENT_ID` · `CWS_CLIENT_SECRET` · `CWS_REFRESH_TOKEN` · `CWS_PUBLISHER_ID`, and optionally
`CWS_EXTENSION_ID` (default `nfifnjdpmjacfelfapgeibnnbkokceim`, the store listing). The script reads them from the
environment only and never prints their values.

## Troubleshooting

```bash
./doctor.sh        # checks host registration, process, socket, CLI and Chrome in one go
```

The bottom-left of the side panel shows **version and mode**, e.g. `26 open · solo · v0.5.0`.
After changing the extension, check that this version went up first — if not, you didn't press ⟳ in
`chrome://extensions`, and nothing you change will take effect.

## Settings (extension icon → ⚙)

| Item | Default | Description |
|---|---|---|
| Same-document rule | Full path | Switch to `File name only` (ignore path) or `Document title` (same title even with different file names) |
| Reload when reusing | On | The agent probably rewrote the file |
| Focus guard | On | If a tab was opened from outside, return to the previous tab. In-page link clicks are untouched |
| Tab group | On | Group name and color. **Collapsed** by default |
| When viewing from the side panel | Show one tab | Pull only that tab out of the group so the tab bar doesn't expand |
| Maximum artifact tabs | 0 (unlimited) | Over the limit, the oldest close first (they stay in the list) |
| Tidy up duplicates on startup | Off | Close duplicate tabs automatically when the browser starts |
| Remove deleted files automatically | On | Drop entries whose file was deleted from Recently closed (needs the 0.5.0 host) |
| Remove old documents automatically | 0 days (off) | Close and remove documents not opened or viewed for N days |
| Claude artifacts | On | Also manage `claude.ai/code/artifact/…`, `/public/artifacts/…`, `claude.site/artifacts/…`. Off = local files only |

## Layout

```
manifest.json            extension manifest (fixed key → ID is always hanplflofffhnolmbildckncaclkjbmf)
src/background.js        dedup · focus restore · tab groups · native host connection
src/lib/keys.js          the "same document?" rules (the heart of dedup)
src/lib/config.js        settings defaults
src/lib/search.js        side-panel search (NFC folding, Korean composition)
src/lib/cleanup.js       which documents the deleted-file and old-document cleanup removes
src/sidepanel.*          side-panel list UI
src/options.*            settings page
host/artifact_dock_host.py   bridge between the CLI (unix socket) and the extension (native messaging)
bin/artifact-open        CLI. Exits nonzero on socket failure (never opens directly)
install.sh               native host registration + CLI links (--uninstall to remove)
scripts/build-cws.sh     Web Store upload zip (manifest key removed) → dist/
scripts/publish-cws.mjs  upload that zip and submit it for review (Chrome Web Store API v2)
scripts/cws-auth.mjs     get the refresh token once (loopback OAuth, saved outside the repo)
PRIVACY.md               privacy policy (required for the Web Store)
docs/backlog.md          known small issues deferred on purpose, with evidence and a trigger
run-tests.sh             checks that run without the extension loaded
docs/media/              demo video and README preview
```

## Tests

```bash
./run-tests.sh
```

- `tests/i18n.test.mjs` — keys and placeholders match across languages, every key the code uses exists, no Korean left in en/es, store length limits
- `tests/keys.test.mjs` — 14 dedup-key cases (query ignored, file-name mode, Korean/spaces, non-target detection)
- `tests/search.test.mjs` — Korean search: NFD file names, percent-encoded folders, the syllable being composed
- `tests/cleanup.test.mjs` — what cleanup removes and what it must keep (pinned, current tab, Chrome-pinned tabs)
- `tests/host.test.py` — starts the host pretending to be Chrome and measures a real CLI → host → extension round trip,
  plus the extension → host file-existence query
- `tests/open_guard.test.py` — Node/shell HTML routing, no direct open on failure, CLI install conflicts
- `tests/cws.test.mjs` — Web Store scripts with a fake `fetch`: request order and shape, waiting on `IN_PROGRESS`,
  readable failures, no credential value in any output, loopback sign-in round trip

What runs inside the extension (background tab creation, focus restore, tab groups) can only be verified with it loaded in a browser.

## Known limits

- **macOS only.** Delegating non-HTML files to `/usr/bin/open` and the socket path assume macOS.
- If **no Chrome window is open**, the new window is created with `focused:false`, but the OS may still bring the app forward.
- It does **not auto-reload** when a file changes. Running `artifact-open` on the same path again reloads it.
- The native host only lives while the extension is on. Without a connection, the CLI stops with an error.

## License

MIT — see [LICENSE](LICENSE).
