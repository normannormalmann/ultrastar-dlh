🇬🇧 English | 🇩🇪 [Deutsch](README.md) | 🇪🇸 [Español](README.es.md)

# UltraStar - Dirty Little Helper

**The desktop app that builds, maintains, and makes your UltraStar karaoke collection searchable.**

Search the largest UltraStar database (USDB), download complete, ready-to-sing song folders — lyrics, cover, and video in one go — and manage tens of thousands of songs with real filters. No manual assembling, no broken folders. Search, download, sing.

➡️ **New here? [Go to the step-by-step tutorial](docs/TUTORIAL.en.md)**

---

## ✨ Features

### Search & Download
- **USDB search with real filters:** language, genre, year, golden notes, songcheck — server-side across the entire database, with selectable sorting (last modified, artist, title, year, rating, views). Filter changes trigger an automatic re-search.
- **Library matching right in the search:** songs you already own are marked (✓) and automatically skipped in bulk downloads — including imported collections. Toggle: show all / only missing / only owned results.
- **Bulk downloads:** single song, whole results page, all pages of a search, or the entire database into the queue — with progress, cancel, resume after a crash, and retry for failed downloads.
- **Cover previews** in search results and library (including local covers of imported songs).
- **VIDEOGAP corrections from USDB comments** are applied automatically — videos stay in sync with the lyrics.

### Create songs
- **Five-step wizard:** turn any track into a singable song — pick a source (YouTube search, a link, or a local file), fetch the lyrics, choose a cover, review, done.
- **AI pipeline in the background:** a Python sidecar separates the vocals, transcribes them, aligns the lyrics to the singing, and detects the pitches — the result is a complete `song.txt` with notes.
- **Its own queue:** creations run alongside downloads, with progress, cancel, and a direct jump into the finished folder.
- **One-time setup:** the app installs the AI environment (Python, Torch, models) at the press of a button — including GPU detection where available.

### Library
- **Archive import:** bring in existing collections (even tens of thousands of songs, even nested folder structures) without re-downloading — including metadata from the song.txt files.
- **Faceted filters:** language, genre, year range, and text search can be combined; dropdown counts adapt to the current selection; multilingual songs appear under each of their languages. Sort A–Z, by year, or newest first. Infinite scrolling instead of page limits.
- **Genre enrichment:** fill in missing genres (and years) via an online database — choose Deezer (no login), Last.fm (API key), or MusicBrainz. Runs in the background, can be cancelled at any time, and resumes seamlessly on next launch. Can write directly back into the song.txt files (#GENRE) on request.
- **Video repair:** finds missing/broken videos and re-downloads only those — metadata stays untouched.

### Convenience
- **Everything automatic:** the app sets up your USDB account, yt-dlp, and ffmpeg itself — no manual setup needed.
- **Configurable:** folder structure for new downloads (flat, by artist, by first letter), download concurrency (1–5), maximum video quality (720p/1080p/best), YouTube cookie browser.
- **Automatic updates:** the app reports new versions itself and installs them at the press of a button — no more manual downloading.
- **Duplicate protection across sessions**, failed-download log as an Excel file, dark theme.

---

## 🚀 Installation (Windows)

1. Download the latest `UltraStar-DLH-Setup-*.exe` from the [GitHub Releases](https://github.com/normannormalmann/ultrastar-dlh/releases).
2. Run it. Windows SmartScreen warns about unsigned apps — **"More info" → "Run anyway"**.
3. Done. On first launch, the app automatically downloads yt-dlp and ffmpeg and creates a USDB account.

From then on the app tells you itself when a new version is out: **Settings → App → "Check for updates"**, download, restart. Because the installer is unsigned, SmartScreen asks once more on update as well.

For Linux there is an `UltraStar-DLH-*.AppImage` — make it executable and run it.

Detailed setup including archive import: **[Tutorial](docs/TUTORIAL.en.md)**

---

## 🖥️ Terminal Version (CLI/TUI)

For servers, power users, and macOS/Linux, there's still a terminal interface built on the same core (search, queue, repair):

```bash
# Requirements: yt-dlp, ffmpeg, Bun (https://bun.sh)
bunx --bun github:normannormalmann/ultrastar-dlh
```

| Shortcut | Action |
| :--- | :--- |
| `Tab` / `Enter` | Switch field / Search |
| `↑↓` `←→` | Select song / Page through results |
| `Enter` | Download immediately |
| `Ctrl+Q` / `Ctrl+A` / `Ctrl+P` | Queue song / page / all pages |
| `Ctrl+D` | Start queue |
| `Ctrl+V` | Repair mode |
| `Ctrl+F` | View failed downloads (retry with `Enter`) |
| `Ctrl+S` | Setup (path, cookie browser) |
| `Esc` | Back / Quit |

---

## 🛠️ How it works

1. **Search:** The app authenticates with USDB and queries the database.
2. **Resolve:** Video links come from USDB comments (including any VIDEOGAP corrections stored there); if one is missing, the app searches YouTube directly.
3. **Download:** Video/audio via `yt-dlp` at the configured quality, merged with `ffmpeg`.
4. **Assemble:** Cover and lyrics are fetched and saved as a standard-compliant `song.txt` — compatible with UltraStar Deluxe, Vocaluxe, and UltraStar Play.
5. **Track:** Successes and failures are logged locally (`downloaded.json`, `failed-downloads.xlsx`) — for duplicate protection and easy retries.

---

## 👨‍💻 Development

The project uses Bun natively (TypeScript, Effect, Electron + React, Ink for the TUI).

```bash
git clone https://github.com/normannormalmann/ultrastar-dlh.git
cd ultrastar-dlh
bun install

bun run start          # TUI in dev mode
bun run desktop:dev    # Desktop app with hot reload
bun run test           # Unit tests
bun run test:e2e       # Playwright smoke test (builds first)
bun run desktop:dist   # Build the installer for the current platform (dist/)
bun run desktop:dist:win     # Force-build the Windows installer
bun run desktop:dist:linux   # Force-build the Linux AppImage
bun run lint           # Biome
```

Architecture: `src/core/` (shared core: USDB API, downloads, storage, genre providers) ← `src/desktop/` (Electron: main/preload/renderer with a typed IPC contract) and `src/tui/` (Ink). Design documents under `docs/superpowers/`.

---

## 🚨 Troubleshooting

- **"Sign in to confirm you're not a bot" (YouTube bot protection):** In settings, choose the browser you're signed into YouTube with — the app uses its cookies. Close the browser before downloading (otherwise the cookie database is locked). Alternatively, place a `cookies.txt` in the songs folder.
- **yt-dlp/ffmpeg missing:** Settings → Tools → "Automatically install missing tools". If that fails, install manually and add them to your PATH, then restart the app.
- **Songs don't show up in the library:** First run "Import archive" (picks up existing collections); click "Refresh" if folders were externally deleted/changed.
- **Genre run stops:** Just start it again — already-enriched songs are skipped. For persistent issues, switch the source (Settings → Genre source).

More in the **[Tutorial → Troubleshooting](docs/TUTORIAL.en.md#9-troubleshooting)**.

## 🔗 Links & Credits

- [USDB (UltraStar Database)](https://usdb.animux.de) — the largest database of UltraStar lyrics
- [UltraStar Deluxe](https://github.com/UltraStar-Deluxe/USDX) — the karaoke game
- Started as a fork of [UltraScrap-cli](https://github.com/martiinii/UltraScrap-cli) by Marcin Gąsienica-Makowski — thanks! 🙏

License: [MIT](LICENSE.md)
