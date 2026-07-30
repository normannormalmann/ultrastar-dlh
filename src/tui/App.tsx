import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { Box, Text, useApp, useInput } from "ink";
import type { FC } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Page, type Song, searchSongs } from "../core/api/usdb/search.ts";
import {
  checkFfmpegAvailable,
  checkYtDlpAvailable,
} from "../core/api/youtube/check.ts";
import { downloadSong } from "../core/download/downloadSong.ts";
import {
  type RepairProgress,
  type RepairResult,
  scanAndRepairVideos,
} from "../core/download/repairSongs.ts";
import { ffmpegInstallHint, ytDlpInstallHint } from "../core/platform.ts";
import { ensureSession } from "../core/session.ts";
import {
  type AppConfig,
  loadConfig,
  saveConfig,
} from "../core/storage/config.ts";
import {
  appendDownloadedEntry,
  type DownloadedEntry,
  loadDownloadedEntries,
} from "../core/storage/downloaded.ts";
import {
  appendFailedDownload,
  type FailedDownload,
  loadFailedDownloads,
} from "../core/storage/failedDownloads.ts";
import { loadQueue, saveQueue } from "../core/storage/queue.ts";
import { DownloadedList } from "./components/DownloadedList.tsx";
import HelpRow from "./components/HelpRow.tsx";
import LoadingRow from "./components/LoadingRow.tsx";
import PathSetupForm from "./components/PathSetupForm.tsx";
import ProgressBar from "./components/ProgressBar.tsx";
import SearchForm from "./components/SearchForm.tsx";
import Select from "./components/Select.tsx";

type Mode = "setup" | "form" | "results" | "repair" | "failed";

type DownloadStatus = "downloading" | "completed" | "failed";

// Constants for download concurrency and UI
const DOWNLOAD_CONCURRENCY = 3; // Number of parallel downloads
const VISIBLE_OPTION_COUNT = 20; // Number of search results shown
const DISPLAY_TIMEOUT_MS = {
  ERROR: 5000, // How long to show errors before clearing
  WARNING: 5000, // How long to show warnings before clearing
  WARNINGS: 5000, // How long to show optional warnings before clearing
  SUCCESS: 100, // How long to show completed downloads before removing
};

export const App: FC = () => {
  const { exit } = useApp();

  const [mode, setMode] = useState<Mode>("setup");
  const [focusedField, setFocusedField] = useState<"artist" | "title">(
    "artist",
  );

  const [artist, setArtist] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const [limit] = useState<number>(20);

  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [songs, setSongs] = useState<Song[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  const [downloadDir, setDownloadDir] = useState<string>(
    join(process.cwd(), "songs"),
  );
  const [browser, setBrowser] = useState<string>("edge");

  const [cookie, setCookie] = useState<string>("");

  const [ytAvailable, setYtAvailable] = useState<boolean | null>(null);
  const [ffmpegAvailable, setFfmpegAvailable] = useState<boolean | null>(null);

  const [isInitializing, setIsInitializing] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [activeDownloads, setActiveDownloads] = useState<
    Array<{
      apiId: number;
      artist: string;
      title: string;
      progress: number;
      status?: DownloadStatus;
    }>
  >([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [downloadedEntries, setDownloadedEntries] = useState<DownloadedEntry[]>(
    [],
  );
  const [isFetchingAllPages, setIsFetchingAllPages] = useState<boolean>(false);
  const [allPagesFetchProgress, setAllPagesFetchProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [repairProgress, setRepairProgress] = useState<RepairProgress | null>(
    null,
  );
  const [repairResult, setRepairResult] = useState<RepairResult | null>(null);

  const [failedDownloads, setFailedDownloads] = useState<FailedDownload[]>([]);
  const [selectedFailedIndex, setSelectedFailedIndex] = useState<number>(0);

  const [downloadQueue, setDownloadQueueState] = useState<Song[]>([]);
  const [isDownloadingQueue, setIsDownloadingQueue] = useState<boolean>(false);

  // Wrapper for setDownloadQueue to also persist to disk
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setDownloadQueue = useCallback(
    (action: Song[] | ((prev: Song[]) => Song[])) => {
      setDownloadQueueState((prev) => {
        const next = typeof action === "function" ? action(prev) : action;
        // Debounce persist to disk in background to prevent memory leaks during bulk adds
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
        }
        saveTimeoutRef.current = setTimeout(() => {
          Effect.runPromise(saveQueue(next)).catch(console.error);
        }, 2000);
        return next;
      });
    },
    [],
  );

  const canPaginate = useMemo(() => totalPages > 1, [totalPages]);
  const downloadedApiIds = useMemo(
    () => new Set(downloadedEntries.map((e) => e.apiId)),
    [downloadedEntries],
  );

  const activeDownloadsRef = useRef(activeDownloads);
  activeDownloadsRef.current = activeDownloads;

  useEffect(() => {
    let isMounted = true;
    const run = async () => {
      try {
        setIsInitializing(true);
        const session = await Effect.runPromise(ensureSession);
        if (!isMounted) return;
        setCookie(session.cookie);
        const cfg = await Effect.runPromise(loadConfig).catch((error) => {
          console.error("Failed to load config:", error);
          return null as AppConfig | null;
        });
        if (cfg?.downloadDir) setDownloadDir(cfg.downloadDir);
        if (cfg?.browser) setBrowser(cfg.browser);
        setMode(cfg?.downloadDir ? "form" : "setup");

        // Load persisted queue
        const savedQueue = await Effect.runPromise(loadQueue).catch(
          () => [] as Song[],
        );
        if (isMounted && savedQueue.length > 0) {
          setDownloadQueueState(savedQueue);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setErrorMessage(message);
      } finally {
        if (isMounted) setIsInitializing(false);
      }
    };
    void run();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let canceled = false;
    (async () => {
      const ok = await Effect.runPromise(checkYtDlpAvailable);
      if (!canceled) setYtAvailable(ok);
    })();
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    let canceled = false;
    (async () => {
      const ok = await Effect.runPromise(checkFfmpegAvailable);
      if (!canceled) setFfmpegAvailable(ok);
    })();
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    const run = async () => {
      try {
        const entries = await Effect.runPromise(loadDownloadedEntries);
        // Filter out entries where video.mp4 no longer exists
        const valid: DownloadedEntry[] = [];
        await Promise.all(
          entries.map(async (e) => {
            try {
              await stat(join(e.songDir, "video.mp4"));
              valid.push(e);
            } catch {
              // file missing – drop silently
            }
          }),
        );
        setDownloadedEntries(valid);
        // Broken entries (missing video.mp4) are intentionally kept in downloaded.json
        // so the repair feature can retrieve their apiId for USDB lookups.
      } catch {}
    };
    void run();
  }, []);

  const fetchPage = useCallback(
    async (pageNumber: number) => {
      if (!cookie) return;
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const pageStart = (pageNumber - 1) * limit;
        const page: Page = await Effect.runPromise(
          searchSongs(
            {
              interpret: artist.trim() || undefined,
              title: title.trim() || undefined,
              limit,
              start: pageStart,
            },
            cookie,
          ),
        );
        setSongs(page.songs);
        setSelectedIndex(0);
        setTotalPages(page.totalPages || 0);
        setCurrentPage(pageNumber);
        setMode("results");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setErrorMessage(message);
      } finally {
        setIsLoading(false);
      }
    },
    [artist, title, cookie, limit],
  );

  const onSubmitSearch = useCallback(() => {
    void fetchPage(1);
  }, [fetchPage]);

  const handleSetupConfirm = useCallback(
    async (dir: string, browserName: string) => {
      const trimmed = dir.trim() || join(process.cwd(), "songs");
      const trimmedBrowser = browserName.trim() || "edge";
      setDownloadDir(trimmed);
      setBrowser(trimmedBrowser);
      await Effect.runPromise(
        saveConfig({ downloadDir: trimmed, browser: trimmedBrowser }),
      ).catch((error) => {
        console.error("Failed to save config:", error);
        setErrorMessage("Failed to save configuration. Please try again.");
      });
      setMode("form");
    },
    [],
  );

  const downloadSongItem = useCallback(
    async (song: Song) => {
      if (!cookie) return;
      if (ytAvailable === false) {
        setErrorMessage("yt-dlp is not installed. Downloading is disabled.");
        return;
      }
      if (ffmpegAvailable === false) {
        setErrorMessage("ffmpeg is not installed. Downloading is disabled.");
        return;
      }
      if (activeDownloadsRef.current.some((d) => d.apiId === song.apiId))
        return;

      setErrorMessage(null);
      setActiveDownloads((prev) => [
        ...prev,
        {
          apiId: song.apiId,
          artist: song.artist,
          title: song.title,
          progress: 0,
        },
      ]);

      try {
        // Collect warnings during download
        const downloadWarnings: string[] = [];

        const result = await Effect.runPromise(
          downloadSong({
            song,
            cookie,
            baseDir: downloadDir,
            cookiesBrowser: browser,
            onProgress: (p) =>
              setActiveDownloads((prev) =>
                prev.map((d) =>
                  d.apiId === song.apiId ? { ...d, progress: p } : d,
                ),
              ),
            onWarning: (warnings) => {
              // Collect warnings from download
              downloadWarnings.push(...warnings);
            },
          }),
        );
        try {
          const updated = await Effect.runPromise(
            appendDownloadedEntry({
              apiId: song.apiId,
              artist: song.artist,
              title: song.title,
              dirName: result.dirName,
              songDir: result.songDir,
              downloadedAt: new Date().toISOString(),
            }),
          );
          setDownloadedEntries(updated);

          // Show warnings if there were any optional failures (e.g., cover)
          if (downloadWarnings.length > 0) {
            const warningMessage = `⚠️ ${downloadWarnings.length} warning(s):\n${downloadWarnings.join("\n")}`;
            setErrorMessage(warningMessage);
            // Clear warning message after timeout
            setTimeout(() => {
              setErrorMessage(null);
            }, DISPLAY_TIMEOUT_MS.WARNINGS);
          }
        } catch (trackingError) {
          // Log tracking error for debugging, but don't fail the download
          const trackingMessage =
            trackingError instanceof Error
              ? trackingError.message
              : String(trackingError);
          console.error(
            `Failed to track download for "${song.title}":`,
            trackingError,
          );
          // Still show success to user, but log the tracking error
          setErrorMessage(
            `Download completed, but tracking failed: ${trackingMessage}`,
          );
          setTimeout(() => {
            setErrorMessage(null);
          }, DISPLAY_TIMEOUT_MS.WARNING);
        }

        // Mark as completed and remove after brief delay
        setActiveDownloads((prev) =>
          prev.map((d) =>
            d.apiId === song.apiId
              ? { ...d, progress: 1, status: "completed" as const }
              : d,
          ),
        );
        setTimeout(() => {
          setActiveDownloads((prev) =>
            prev.filter((d) => d.apiId !== song.apiId),
          );
        }, DISPLAY_TIMEOUT_MS.SUCCESS);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("Download error:", err);
        setErrorMessage(`Failed to download "${song.title}": ${message}`);
        // Log to failed-downloads files
        Effect.runPromise(
          appendFailedDownload(downloadDir, song, message),
        ).catch(() => {});
        // Mark as failed - keep visible until timeout removes it
        setActiveDownloads((prev) =>
          prev.map((d) =>
            d.apiId === song.apiId ? { ...d, status: "failed" as const } : d,
          ),
        );
        // Remove failed download after error timeout so user can see it
        setTimeout(() => {
          setActiveDownloads((prev) =>
            prev.filter((d) => d.apiId !== song.apiId),
          );
        }, DISPLAY_TIMEOUT_MS.ERROR);
      }
    },
    [cookie, ytAvailable, ffmpegAvailable, downloadDir, browser],
  );

  const addToQueue = useCallback(
    (songsToAdd: Song[]) => {
      setDownloadQueue((prev) => {
        // Keep a set of IDs currently in queue to quickly filter out duplicates
        const existingIds = new Set(prev.map((s) => s.apiId));
        const newSongs = songsToAdd.filter(
          (s) => !existingIds.has(s.apiId) && !downloadedApiIds.has(s.apiId),
        );
        if (newSongs.length > 0) {
          return [...prev, ...newSongs];
        }
        return prev;
      });
    },
    [downloadedApiIds, setDownloadQueue],
  );

  const downloadSelectedSong = useCallback(
    async (index?: number) => {
      const idx = index ?? selectedIndex;
      const song = songs[idx];
      if (!song) {
        const errorMsg = `Invalid song index: ${idx} (array length: ${songs.length})`;
        console.error(errorMsg);
        setErrorMessage(errorMsg);
        setTimeout(() => setErrorMessage(null), DISPLAY_TIMEOUT_MS.ERROR);
        return;
      }
      if (downloadedApiIds.has(song.apiId)) {
        setErrorMessage(`Song "${song.title}" is already downloaded.`);
        setTimeout(() => setErrorMessage(null), DISPLAY_TIMEOUT_MS.ERROR);
        return;
      }
      await downloadSongItem(song);
    },
    [songs, selectedIndex, downloadedApiIds, downloadSongItem],
  );

  const queueSelectedSong = useCallback(
    (index?: number) => {
      const idx = index ?? selectedIndex;
      const song = songs[idx];
      if (!song) {
        const errorMsg = `Invalid song index: ${idx} (array length: ${songs.length})`;
        console.error(errorMsg);
        setErrorMessage(errorMsg);
        setTimeout(() => setErrorMessage(null), DISPLAY_TIMEOUT_MS.ERROR);
        return;
      }
      if (downloadedApiIds.has(song.apiId)) {
        setErrorMessage(`Song "${song.title}" is already downloaded.`);
        setTimeout(() => setErrorMessage(null), DISPLAY_TIMEOUT_MS.ERROR);
        return;
      }
      addToQueue([song]);
    },
    [songs, selectedIndex, downloadedApiIds, addToQueue],
  );

  const refreshFailedDownloads = useCallback(async () => {
    const entries = await Effect.runPromise(loadFailedDownloads(downloadDir));
    setFailedDownloads(entries);
    setSelectedFailedIndex(0);
  }, [downloadDir]);

  const queueAllCurrentPage = useCallback(() => {
    addToQueue(songs);
  }, [songs, addToQueue]);

  const queueAllPages = useCallback(async () => {
    if (!cookie || isFetchingAllPages) return;
    setIsFetchingAllPages(true);
    setErrorMessage(null);
    try {
      let page = 1;
      let totalPagesFound = Math.max(totalPages, 1);
      while (page <= totalPagesFound) {
        setAllPagesFetchProgress({ current: page, total: totalPagesFound });
        const result = await Effect.runPromise(
          searchSongs(
            {
              interpret: artist.trim() || undefined,
              title: title.trim() || undefined,
              limit,
              start: (page - 1) * limit,
            },
            cookie,
          ),
        );
        if (result.totalPages > totalPagesFound) {
          totalPagesFound = result.totalPages;
        }

        // Add to queue page by page instead of holding all 20,000 in memory
        addToQueue(result.songs);

        // Wait a tiny bit to let the React render cycle catch up and garbage collect
        await new Promise((r) => setTimeout(r, 10));

        page++;
      }
      setAllPagesFetchProgress(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorMessage(message);
    } finally {
      setIsFetchingAllPages(false);
      setAllPagesFetchProgress(null);
    }
  }, [
    cookie,
    isFetchingAllPages,
    artist,
    title,
    limit,
    totalPages,
    addToQueue,
  ]);

  const processQueue = useCallback(async () => {
    if (isDownloadingQueue || downloadQueue.length === 0) return;
    if (ytAvailable === false) {
      setErrorMessage("yt-dlp is not installed. Downloading is disabled.");
      return;
    }
    if (ffmpegAvailable === false) {
      setErrorMessage("ffmpeg is not installed. Downloading is disabled.");
      return;
    }

    setIsDownloadingQueue(true);
    try {
      // Filter the queue one last time right before starting,
      // just in case downloadedApiIds updated while we were waiting
      let currentQueue = downloadQueue.filter(
        (song) => !downloadedApiIds.has(song.apiId),
      );

      while (currentQueue.length > 0) {
        const batch = currentQueue.slice(0, DOWNLOAD_CONCURRENCY);
        await Promise.all(batch.map((song) => downloadSongItem(song)));
        setDownloadQueue((prev) =>
          prev.filter((s) => !batch.some((b) => b.apiId === s.apiId)),
        );
        currentQueue = currentQueue
          .slice(batch.length)
          .filter((song) => !downloadedApiIds.has(song.apiId));
      }
    } finally {
      setIsDownloadingQueue(false);
    }
  }, [
    downloadQueue,
    isDownloadingQueue,
    ytAvailable,
    ffmpegAvailable,
    downloadSongItem,
    downloadedApiIds,
    setDownloadQueue,
  ]);

  const queueEntireDatabase = useCallback(async () => {
    if (!cookie || isFetchingAllPages) return;
    setIsFetchingAllPages(true);
    setErrorMessage(null);
    try {
      let page = 1;
      let totalPagesFound = 1; // dynamically updated
      while (page <= totalPagesFound) {
        setAllPagesFetchProgress({
          current: page,
          total: Math.max(totalPagesFound, 1),
        });
        const result = await Effect.runPromise(
          searchSongs(
            {
              limit,
              start: (page - 1) * limit,
            },
            cookie,
          ),
        );
        if (result.totalPages > totalPagesFound) {
          totalPagesFound = result.totalPages;
        }

        addToQueue(result.songs);
        await new Promise((r) => setTimeout(r, 10)); // Memory safety yield
        page++;
      }
      setAllPagesFetchProgress(null);
      // We do not auto-start processQueue here because it can be safely triggered manually
      // or we can just let the user press Ctrl+D. Let's just queue them.
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorMessage(message);
    } finally {
      setIsFetchingAllPages(false);
      setAllPagesFetchProgress(null);
    }
  }, [cookie, isFetchingAllPages, limit, addToQueue]);

  const startRepair = useCallback(async () => {
    if (ytAvailable === false) {
      setErrorMessage("yt-dlp is not installed. Downloading is disabled.");
      return;
    }
    if (ffmpegAvailable === false) {
      setErrorMessage("ffmpeg is not installed. Downloading is disabled.");
      return;
    }
    setRepairProgress(null);
    setRepairResult(null);
    setMode("repair");
    try {
      const result = await Effect.runPromise(
        scanAndRepairVideos(downloadDir, cookie, browser, (p) =>
          setRepairProgress(p),
        ),
      );
      setRepairResult(result);
      // Reload tracking so newly repaired/rebuilt songs appear in the list
      try {
        const entries = await Effect.runPromise(loadDownloadedEntries);
        const valid: DownloadedEntry[] = [];
        await Promise.all(
          entries.map(async (e) => {
            try {
              await stat(join(e.songDir, "video.mp4"));
              valid.push(e);
            } catch {
              // file still missing – keep out of UI list
            }
          }),
        );
        setDownloadedEntries(valid);
      } catch {}
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorMessage(message);
      setMode("form");
    }
  }, [downloadDir, cookie, browser, ytAvailable, ffmpegAvailable]);

  useInput((input, key) => {
    if (key.escape) {
      if (mode === "setup") {
        exit();
        return;
      }
      if (mode === "results") {
        setMode("form");
        return;
      }
      if (mode === "repair" && repairResult !== null) {
        setMode("form");
        return;
      }
      if (mode === "failed") {
        setMode("form");
        return;
      }
      if (mode === "form") {
        exit();
        return;
      }
    }
    if (mode === "form") {
      if (key.tab) {
        setFocusedField((prev) => (prev === "artist" ? "title" : "artist"));
        return;
      }
      if (key.return) {
        onSubmitSearch();
        return;
      }
      if (key.ctrl && (input === "v" || input === "\x16")) {
        void startRepair();
        return;
      }
      if (key.ctrl && (input === "f" || input === "\x06")) {
        void refreshFailedDownloads();
        setMode("failed");
        return;
      }
      if (key.ctrl && (input === "s" || input === "\x13")) {
        setMode("setup");
        return;
      }
      if (
        key.ctrl &&
        (input === "a" || input === "\x01") &&
        !isFetchingAllPages
      ) {
        void queueEntireDatabase();
        return;
      }
      if (
        key.ctrl &&
        (input === "d" || input === "\x04") &&
        !isDownloadingQueue
      ) {
        void processQueue();
        return;
      }
    } else if (mode === "results") {
      if (key.ctrl && (input === "e" || input === "\x05")) {
        setMode("form");
        return;
      }
      if (key.ctrl && (input === "r" || input === "\x12")) {
        void fetchPage(currentPage);
        return;
      }
      if (
        key.ctrl &&
        (input === "a" || input === "\x01") &&
        !isFetchingAllPages
      ) {
        queueAllCurrentPage();
        return;
      }
      if (
        key.ctrl &&
        (input === "p" || input === "\x10") &&
        !isFetchingAllPages
      ) {
        void queueAllPages();
        return;
      }
      if (key.ctrl && (input === "q" || input === "\x11")) {
        queueSelectedSong();
        return;
      }
      if (
        key.ctrl &&
        (input === "d" || input === "\x04") &&
        !isDownloadingQueue
      ) {
        void processQueue();
        return;
      }
      // Up/Down handled by Select component
      if (key.return && !isLoading) {
        void downloadSelectedSong();
        return;
      }
      if (key.leftArrow) {
        if (currentPage > 1) void fetchPage(currentPage - 1);
        return;
      }
      if (key.rightArrow) {
        if (totalPages > 0 && currentPage < totalPages) {
          void fetchPage(currentPage + 1);
        }
        return;
      }
    } else if (mode === "failed") {
      // Up/Down handled by Select component
      if (key.return && failedDownloads.length > 0) {
        const f = failedDownloads[selectedFailedIndex];
        if (f) {
          addToQueue([
            { apiId: f.apiId, artist: f.artist, title: f.title, languages: [] },
          ]);
        }
        return;
      }
    }
  });

  return (
    <Box flexDirection="column" gap={1}>
      <Box>
        <Text color="magentaBright" bold underline>
          UltraStar CLI
        </Text>
      </Box>

      {/* Status Row */}
      <Box flexDirection="column">
        <Text>
          <Text color="white" bold>
            Login:
          </Text>{" "}
          {cookie ? (
            <Text color="greenBright">Logged in</Text>
          ) : isInitializing ? (
            <Text color="yellow">Checking…</Text>
          ) : (
            <Text color="red">Not logged in</Text>
          )}
        </Text>
        {!isInitializing && !cookie && (
          <Text color="red">
            An unknown error occured. Please report on GitHub.
          </Text>
        )}
        <Text>
          <Text color="white" bold>
            yt-dlp:
          </Text>{" "}
          {ytAvailable == null ? (
            <Text color="yellow">Checking…</Text>
          ) : ytAvailable ? (
            <Text color="greenBright">Available</Text>
          ) : (
            <Text>
              <Text color="red">Not installed.</Text>{" "}
              <Text dimColor>
                {ytDlpInstallHint()} See
                https://github.com/yt-dlp/yt-dlp#installation
              </Text>
            </Text>
          )}
        </Text>
        {ytAvailable === false && (
          <Text>
            <Text color="red" bold>
              Downloading songs is not possible without yt-dlp.
            </Text>
          </Text>
        )}
        <Text>
          <Text color="white" bold>
            ffmpeg:
          </Text>{" "}
          {ffmpegAvailable == null ? (
            <Text color="yellow">Checking…</Text>
          ) : ffmpegAvailable ? (
            <Text color="greenBright">Available</Text>
          ) : (
            <Text>
              <Text color="red">Not installed.</Text>{" "}
              <Text dimColor>{ffmpegInstallHint()}</Text>
            </Text>
          )}
        </Text>
        {ffmpegAvailable === false && (
          <Text>
            <Text color="red" bold>
              Downloading songs is not possible without ffmpeg.
            </Text>
          </Text>
        )}
      </Box>

      {isInitializing ? (
        <LoadingRow label="Initializing session..." />
      ) : mode === "setup" ? (
        <PathSetupForm
          path={downloadDir}
          onPathChange={setDownloadDir}
          browser={browser}
          onBrowserChange={setBrowser}
          onConfirm={handleSetupConfirm}
        />
      ) : mode === "repair" ? (
        <Box flexDirection="column" gap={1}>
          {repairResult === null ? (
            <Box flexDirection="column">
              <Text color="cyan" bold>
                Scanning for missing videos...
              </Text>
              {repairProgress && (
                <Box flexDirection="column">
                  <Text>
                    <Text color="white">
                      [{repairProgress.current}/{repairProgress.total}]
                    </Text>{" "}
                    <Text color="yellow">{repairProgress.currentSong}</Text>
                  </Text>
                  {repairProgress.videoProgress != null && (
                    <Box gap={1}>
                      <ProgressBar
                        value={repairProgress.videoProgress}
                        width={30}
                      />
                      <Text dimColor>
                        {Math.round(repairProgress.videoProgress * 100)}%
                      </Text>
                    </Box>
                  )}
                </Box>
              )}
            </Box>
          ) : (
            <Box flexDirection="column">
              <Text color="greenBright" bold>
                Repair complete!
              </Text>
              <Text>
                <Text color="white">Fixed: </Text>
                <Text color="greenBright" bold>
                  {repairResult.fixed}
                </Text>
                <Text color="white"> / {repairResult.total} songs</Text>
              </Text>
              {repairResult.rebuilt > 0 && (
                <Text>
                  <Text color="white">Rebuilt tracking: </Text>
                  <Text color="cyanBright" bold>
                    {repairResult.rebuilt}
                  </Text>
                  <Text color="white"> songs</Text>
                </Text>
              )}
              {repairResult.failed.length > 0 && (
                <Box flexDirection="column">
                  <Text color="yellow">
                    Could not fix ({repairResult.failed.length}):
                  </Text>
                  {repairResult.failed.slice(0, 10).map((name) => (
                    <Text key={name} dimColor>
                      {" "}
                      • {name}
                    </Text>
                  ))}
                  {repairResult.failed.length > 10 && (
                    <Text dimColor>
                      {" "}
                      ... and {repairResult.failed.length - 10} more
                    </Text>
                  )}
                </Box>
              )}
              <Text dimColor>Esc: back to search</Text>
            </Box>
          )}
        </Box>
      ) : mode === "failed" ? (
        <Box flexDirection="column" gap={1}>
          {failedDownloads.length === 0 ? (
            <Text color="yellow">No failed downloads.</Text>
          ) : (
            <>
              <Select
                options={failedDownloads.map((f, i) => ({
                  label: (
                    <Text>
                      <Text color="yellowBright">{f.artist}</Text>
                      <Text color="gray"> - </Text>
                      <Text color="cyanBright">{f.title}</Text>
                    </Text>
                  ),
                  value: String(i),
                }))}
                onChange={(v: string) => {
                  const idx = Number(v);
                  if (
                    !Number.isNaN(idx) &&
                    idx >= 0 &&
                    idx < failedDownloads.length
                  ) {
                    setSelectedFailedIndex(idx);
                  }
                }}
                visibleOptionCount={VISIBLE_OPTION_COUNT}
                value={String(selectedFailedIndex)}
              />
              {failedDownloads[selectedFailedIndex] && (
                <Text dimColor wrap="truncate-end">
                  Error: {failedDownloads[selectedFailedIndex]?.error}
                </Text>
              )}
            </>
          )}
          <Text dimColor>Enter: retry (re-queue) • Esc: back to search</Text>
        </Box>
      ) : (
        <>
          {mode === "form" && (
            <Box flexDirection="column" gap={1}>
              <SearchForm
                artist={artist}
                title={title}
                focusedField={focusedField}
                setArtist={setArtist}
                setTitle={setTitle}
              />
              {isFetchingAllPages && (
                <Text color="cyan">
                  {allPagesFetchProgress
                    ? `Fetching pages... (${allPagesFetchProgress.current}/${allPagesFetchProgress.total})`
                    : "Preparing bulk download..."}
                </Text>
              )}
            </Box>
          )}

          {mode === "results" && (
            <Box flexDirection="row">
              <Box flexDirection="column" width={"50%"}>
                {isLoading ? (
                  <LoadingRow label="Searching..." />
                ) : (
                  <>
                    {songs.length === 0 ? (
                      <Text color="yellow">No results.</Text>
                    ) : (
                      <Select
                        options={songs.map((s, i) => ({
                          label: (
                            <Text>
                              {downloadedApiIds.has(s.apiId) && (
                                <Text color="greenBright">✓ </Text>
                              )}
                              <Text color="yellowBright">{s.artist}</Text>
                              <Text color="gray"> - </Text>
                              <Text color="cyanBright">{s.title}</Text>
                              {s.languages.length > 0 && (
                                <Text>
                                  {" "}
                                  <Text color="gray">[</Text>
                                  <Text color="magentaBright">
                                    {s.languages.join(", ")}
                                  </Text>
                                  <Text color="gray">]</Text>
                                </Text>
                              )}
                            </Text>
                          ),
                          value: String(i),
                        }))}
                        onChange={(v: string) => {
                          const idx = Number(v);
                          // Validate bounds before setting index
                          if (
                            !Number.isNaN(idx) &&
                            idx >= 0 &&
                            idx < songs.length
                          ) {
                            setSelectedIndex(idx);
                          } else {
                            console.error(
                              `Invalid song index: ${idx} (length: ${songs.length})`,
                            );
                          }
                        }}
                        visibleOptionCount={VISIBLE_OPTION_COUNT}
                        value={String(selectedIndex)}
                      />
                    )}
                    <Box>
                      <Text>
                        <Text color="white" bold>
                          Page
                        </Text>{" "}
                        <Text color="cyanBright" bold>
                          {totalPages === 0 ? 0 : currentPage}
                        </Text>{" "}
                        <Text color="white" bold>
                          of
                        </Text>{" "}
                        <Text color="cyanBright" bold>
                          {totalPages}
                        </Text>
                      </Text>
                    </Box>
                    {canPaginate && (
                      <Text dimColor>Use ←/→ to navigate pages</Text>
                    )}
                    {isFetchingAllPages && (
                      <Text color="cyan">
                        {allPagesFetchProgress
                          ? `Fetching pages... (${allPagesFetchProgress.current}/${allPagesFetchProgress.total})`
                          : "Preparing bulk download..."}
                      </Text>
                    )}
                  </>
                )}
              </Box>
              <Box flexDirection="column" width={"40%"}>
                <DownloadedList
                  entries={downloadedEntries}
                  currentDownloading={activeDownloads.map((d) => ({
                    apiId: d.apiId,
                    artist: d.artist,
                    title: d.title,
                    progress: d.progress,
                  }))}
                />
              </Box>
            </Box>
          )}

          {errorMessage && (
            <Text>
              <Text color="red" bold>
                Error:
              </Text>{" "}
              <Text color="red">{errorMessage}</Text>
            </Text>
          )}

          {downloadQueue.length > 0 && (
            <Box flexDirection="row" gap={1}>
              <Text color="cyan" bold>
                Queue:
              </Text>
              <Text>
                {downloadQueue.length} song
                {downloadQueue.length !== 1 ? "s" : ""} waiting
                {isDownloadingQueue
                  ? " (Processing...)"
                  : " (Press Ctrl+d to start)"}
              </Text>
            </Box>
          )}

          <HelpRow
            mode={mode}
            canDownload={ytAvailable !== false && ffmpegAvailable !== false}
          />
        </>
      )}
    </Box>
  );
};

export default App;
