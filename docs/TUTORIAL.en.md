🇩🇪 [Deutsch](TUTORIAL.md) | 🇬🇧 English | 🇪🇸 [Español](TUTORIAL.es.md)

# Tutorial: UltraStar - Dirty Little Helper

This tutorial takes you from installing the app to a fully tended karaoke library — step by step. No prior knowledge needed.

**Contents**
1. [Installing and first launch](#1-installing-and-first-launch)
2. [Basic settings](#2-basic-settings)
3. [Importing an existing collection](#3-importing-an-existing-collection)
4. [Searching for and downloading songs](#4-searching-for-and-downloading-songs)
5. [Bulk downloads with the queue](#5-bulk-downloads-with-the-queue)
6. [The library: filter, sort, find](#6-the-library-filter-sort-find)
7. [Filling in genres automatically](#7-filling-in-genres-automatically)
8. [Repairing videos](#8-repairing-videos)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Installing and first launch

1. Download the latest `UltraStar-DLH-Setup-*.exe` from the [releases](https://github.com/normannormalmann/ultrastar-dlh/releases).
2. Run it. Windows SmartScreen shows a warning (the app is not signed): choose **"More info" → "Run anyway"**. The installation runs through without further questions and starts the app.
3. On the first launch, this happens by itself:
   - The app creates an anonymous **USDB account** and signs in (the "USDB" status dot at the bottom left turns green).
   - If **yt-dlp** or **ffmpeg** are missing, the app downloads both itself (the status dots turn green shortly after). You do not have to do anything.

The three status dots at the bottom of the sidebar always show: USDB sign-in, yt-dlp, ffmpeg. All green means you are ready to go.

> **Updates:** From version 1.4.0 the app tells you itself when a new version is out: **Settings → App → "Check for updates"**, download, restart. Because the installer is unsigned, SmartScreen asks once more on update as well. Doing it by hand still works: install a new version straight over the old one — settings, library and queue are kept.

## 2. Basic settings

Open **Settings** (the cog in the sidebar):

- **Download folder:** the folder your songs live in (or should live in) — e.g. `D:\Ultrastar`. Pick it with "Browse…". *This is the same folder you enter as SongDir in UltraStar Deluxe.*
- **Browser for YouTube cookies:** pick the browser you are **signed in** to YouTube with (e.g. Edge or Chrome). YouTube often blocks anonymous downloads; with your browser cookies the app gets past that. Important while downloading: close the browser, otherwise its cookie database is locked.
- **Downloads:**
  - *Folder layout for new downloads* — how new songs are filed:
    - `Artist - Title` (flat): everything on one level — the default.
    - `Artist / Artist - Title`: one subfolder per artist.
    - `A / Artist - Title`: subfolders by first letter.
    The example line below shows the path live. UltraStar Deluxe copes with all variants (even mixed); songs you already have are never moved.
  - *Parallel downloads* (1–5): how many songs load at once. 2–3 is a good default.
  - *Video quality*: 720p max. saves space, 1080p max. is the default, "Best available" takes whatever YouTube offers.
- **Genre source:** see [chapter 7](#7-filling-in-genres-automatically).
- **Language:** German, English or Spanish. With no choice of your own the app follows your system language.

Do not forget to **Save** (a tick confirms it).

## 3. Importing an existing collection

Already have songs on disk? Import them first — otherwise the app does not know what you own and would download songs twice.

1. Make sure the **download folder** (chapter 2) points at your collection.
2. Open **Downloaded** in the sidebar → click **"Import archive"**.
3. The app scans every song folder (nested one level too, e.g. `ABBA\ABBA - Waterloo\`) and takes in every folder holding a `song.txt` — **without downloading anything**. On large collections (10,000+) this takes a few minutes; a progress bar shows where it is.
4. Read the result message: "N songs imported (N of them without a video — run the repair) · M already present". Songs **without a video** only appear in the list after a [repair](#8-repairing-videos), but they are already protected against double downloads.

**Worth knowing:**
- The import reads language, genre, year and the rest straight from the song.txt files — your filters work immediately.
- Clicking "Import archive" **again** never hurts: it finds new folders and fills in missing metadata on entries already imported.
- Deleted or changed folders outside the app? Click **"Refresh"** — the app re-checks what is on disk.

## 4. Searching for and downloading songs

1. Open **Search** (the magnifier). Enter artist and/or title, press `Enter` or "Search".
2. The table shows cover, artist, title, languages, rating (★) and views. Songs you already own carry a green **✓** — nothing to do for those.
3. Unfold **Filters** (the slider icon) for more control:
   - **Language, genre, year** — filtered on the server across the *whole* database, not just the current page.
   - **Sort order** plus direction (e.g. "Rating descending" for the most popular first).
   - **Golden notes only / Songcheck only** — quality markers from the database.
   - **Library:** "Only missing" hides what you already have — perfect for browsing for something new.
   - Changing a filter searches again by itself (a small counter on the filter button shows the active ones).
4. **Downloading:** the ⬇ button on the row fetches the song right away. The download bar appears at the bottom with progress. A complete song (lyrics + cover + video) usually takes under a minute, depending on the video.

The finished song then sits as a folder in your download folder — with `song.txt`, `cover.jpg` and `video.mp4` — and is immediately singable in UltraStar Deluxe (re-read the songs there if needed).

## 5. Bulk downloads with the queue

For anything beyond a handful of songs:

1. Collect them in the search:
   - **"＋ Queue"** on the row: a single song.
   - **"＋ Page to queue"**: every (visible) hit on the current page.
   - **"＋ All N pages"**: *every* page of the current search — e.g. all of "Language: German, Genre: Schlager". It respects every active filter.
   - **"Whole database to queue"**: literally everything (tens of thousands of songs — with a confirmation dialog).
   Songs you already own or already queued are skipped automatically; the counter next to "Queue" in the sidebar grows accordingly.
2. Open **Queue** → **"▶ Download N songs"**. The app works through the list at the parallelism you set.
3. You can **cancel** at any time (after the batch in flight) — the queue is saved, across app restarts and crashes alike. "▶" simply carries on later.
4. **Failed downloads** land in the collapsible area below (most common cause: YouTube bot protection → see [troubleshooting](#9-troubleshooting)). "↻ Retry" puts them back in the queue; there is also a `failed-downloads.xlsx` in the songs folder with all the details.

## 6. The library: filter, sort, find

**Downloaded** is your view of what you own:

- The **text filter** searches artist and title.
- **Language/genre dropdowns** only offer values that fit the rest of your selection — with hit counts. Songs in several languages ("Japanese, German") appear under each.
- **Year from/to** narrows down periods ("just the 80s": 1980–1989).
- **Sorting:** newest first, artist A–Z, title A–Z, year ascending.
- The list loads more as you scroll ("showing X of Y").
- **"Folder"** on each row opens the song in Explorer.
- **"Refresh"** reconciles the list with what is actually on disk (e.g. after deleting something by hand).

## 7. Filling in genres automatically

Many USDB songs arrive with no genre — which leaves your filters just as empty. The app can fill in missing genres (and years) from online music databases:

1. Pick a **Settings → Genre source**:
   - **Deezer** (recommended): no sign-up, a good hit rate, roughly 1–2 hours for 10,000 songs.
   - **Last.fm**: the best genre variety, needs a free [API key](https://www.last.fm/api/account/create) (the field appears once you pick it).
   - **MusicBrainz**: an open database that finds partly different songs — but is limited to one request per second (and is slow to match).
2. **Downloaded → "Fill in genres"**. Progress: "Looking up genres… (x/y · z found)".
3. You can **cancel at any time** — the state is saved, and the next run skips songs already enriched. Downloading alongside the run is no problem.
4. Genres that are found get normalised (a consistent "Hip-Hop" instead of "rap/hip hop" and so on), written into the library **and** as `#GENRE:` into the respective song.txt — so they are visible in UltraStar Deluxe too.

**Tip for maximum coverage:** first a full Deezer run, then switch the source to MusicBrainz and run again — the second run only tries the songs left over and often finds more. Whatever is still missing usually simply does not exist in those databases (remixes, niche titles) — you can add those by hand in the song.txt if you care to.

## 8. Repairing videos

When videos are missing or broken (aborted downloads, deleted files, imported collections without video):

1. **Repair** in the sidebar → **"Start scan"**.
2. The app searches the download folder for songs with a missing or suspiciously small `video.mp4` and re-downloads **the videos only** — lyrics and covers are left alone. Songs without a tracking entry are reconstructed along the way.
3. The closing report shows repaired / reconstructed / beyond repair. Freshly repaired songs then appear in the library.

The same applies here: if the USDB comments hold a VIDEOGAP correction for the video, the app carries it into the song.txt automatically.

## 9. Troubleshooting

**"YouTube bot protection blocked the download" / many failures in a row**
YouTube is blocking anonymous downloads. The fix: in the settings, pick the browser you are **signed in** to YouTube with, **close** that browser, then try again ("↻ Retry" on the failed ones). For stubborn cases: put a `cookies.txt` (browser extension "Get cookies.txt") into the songs folder.

**The yt-dlp/ffmpeg status dot stays red**
Settings → Tools → "Install the missing tools automatically". If that fails too (corporate proxy or similar): install [yt-dlp](https://github.com/yt-dlp/yt-dlp#installation) and [ffmpeg](https://www.gyan.dev/ffmpeg/builds/) by hand, add them to your PATH, restart the app.

**Song downloaded, but the video runs out of sync with the lyrics**
Delete the song folder, click "Refresh" in the library, download the song again — the app now carries VIDEOGAP corrections over from the USDB comments automatically.

**The library still shows deleted songs / new folders are missing**
"Refresh" in the library (reconciles with the disk) or "Import archive" (picks up new folders).

**The import says "X without a video"**
Normal for collections with missing videos. Those songs are tracked (no double download) but only appear in the list after a [repair](#8-repairing-videos).

**The app asks for a Last.fm key**
Only the Last.fm source needs one — free at [last.fm/api/account/create](https://www.last.fm/api/account/create), or simply stay with Deezer.

---

Questions, bugs, wishes? → [GitHub Issues](https://github.com/normannormalmann/ultrastar-dlh/issues)
