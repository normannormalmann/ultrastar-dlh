import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Database,
  Download,
  Plus,
  SlidersHorizontal,
} from "lucide-react";
import type { FC, FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sanitizeForPath } from "../../../core/download/naming.ts";
import type {
  AppStatus,
  BulkQueueRequest,
  DownloadedEntry,
  Song,
} from "../../shared/ipcContract.ts";
import CoverThumb from "../components/CoverThumb.tsx";
import { useIpcEvent } from "../hooks.ts";
import { useT } from "../i18n/index.tsx";

const USDB_LANGUAGES = [
  "English",
  "German",
  "Spanish",
  "French",
  "Italian",
  "Portuguese",
  "Dutch",
  "Polish",
  "Swedish",
  "Norwegian",
  "Danish",
  "Finnish",
  "Russian",
  "Japanese",
  "Korean",
  "Chinese",
  "Turkish",
  "Czech",
  "Hungarian",
  "Slovak",
  "Croatian",
  "Serbian",
  "Greek",
  "Other",
] as const;

const USDB_GENRES = [
  "Pop",
  "Rock",
  "Schlager",
  "Musical",
  "Soundtrack",
  "Disney",
  "Metal",
  "Punk",
  "Country",
  "Folk",
  "Rap",
  "Hip-Hop",
  "R&B",
  "Soul",
  "Reggae",
  "Electronic",
  "Dance",
  "Jazz",
  "Blues",
  "Christmas",
  "Anime",
  "Game",
  "Volksmusik",
  "Other",
] as const;

/** Doubles as the key into t.search.order, so no label lives here. */
const ORDER_VALUES = [
  "lastchange",
  "interpret",
  "title",
  "year",
  "rating",
  "views",
] as const;

export const SearchView: FC<{
  downloaded: DownloadedEntry[];
  status: AppStatus;
}> = ({ downloaded, status }) => {
  const t = useT();
  const [artist, setArtist] = useState("");
  const [title, setTitle] = useState("");
  const [songs, setSongs] = useState<Song[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const [showFilters, setShowFilters] = useState(false);
  const [language, setLanguage] = useState("");
  const [genre, setGenre] = useState("");
  const [year, setYear] = useState("");
  const [order, setOrder] = useState<string>("lastchange");
  const [ud, setUd] = useState<"asc" | "desc">("desc");
  const [golden, setGolden] = useState(false);
  const [songcheck, setSongcheck] = useState(false);
  const [stock, setStock] = useState<"all" | "missing" | "owned">("all");

  const activeFilterCount =
    (language ? 1 : 0) +
    (genre ? 1 : 0) +
    (year ? 1 : 0) +
    (order !== "lastchange" || ud !== "desc" ? 1 : 0) +
    (golden ? 1 : 0) +
    (songcheck ? 1 : 0) +
    (stock !== "all" ? 1 : 0);

  const filterRequest = (): BulkQueueRequest => ({
    artist,
    title,
    language: language || undefined,
    genre: genre || undefined,
    year: year ? Number.parseInt(year, 10) : undefined,
    order:
      order === "lastchange" ? undefined : (order as BulkQueueRequest["order"]),
    ud: ud === "desc" ? undefined : ud,
    golden: golden || undefined,
    songcheck: songcheck || undefined,
  });

  const fetchAllProgress = useIpcEvent("event:fetchAllProgress", null);
  const downloadedIds = useMemo(
    () => new Set(downloaded.map((e) => e.apiId)),
    [downloaded],
  );
  const downloadedDirs = useMemo(
    () => new Set(downloaded.map((e) => e.dirName.toLowerCase())),
    [downloaded],
  );
  const canDownload =
    status.ytDlpAvailable !== false && status.ffmpegAvailable !== false;
  const bulkRunning = fetchAllProgress !== null;

  const fetchPage = useCallback(
    async (p: number): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const result = await window.ultrastar.search({
          artist,
          title,
          language: language || undefined,
          genre: genre || undefined,
          year: year ? Number.parseInt(year, 10) : undefined,
          order:
            order === "lastchange"
              ? undefined
              : (order as BulkQueueRequest["order"]),
          ud: ud === "desc" ? undefined : ud,
          golden: golden || undefined,
          songcheck: songcheck || undefined,
          page: p,
        });
        setSongs(result.songs);
        setTotalPages(result.totalPages);
        setPage(p);
        setSearched(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [artist, title, language, genre, year, order, ud, golden, songcheck],
  );

  // Automatically apply filter changes after a search has happened (debounced,
  // so e.g. typing a year doesn't trigger a search per digit).
  const searchedRef = useRef(false);
  useEffect(() => {
    searchedRef.current = searched;
  }, [searched]);

  const fetchPageRef = useRef(fetchPage);
  useEffect(() => {
    fetchPageRef.current = fetchPage;
  }, [fetchPage]);

  // Automatically apply filter changes after a search has happened (debounced).
  // Intentionally ONLY the filter values as triggers — typing in artist/title
  // does not start a search (that's what the search button/Enter is for).
  // biome-ignore lint/correctness/useExhaustiveDependencies: only filter values should trigger this
  useEffect(() => {
    if (!searchedRef.current) return;
    const t = setTimeout(() => {
      void fetchPageRef.current(1);
    }, 500);
    return () => clearTimeout(t);
  }, [language, genre, year, order, ud, golden, songcheck]);

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    void fetchPage(1);
  };

  const queueEntireDatabase = (): void => {
    if (
      window.confirm(t.search.confirmEntireDatabase)
    ) {
      void window.ultrastar.queueEntireDatabase();
    }
  };

  const isDownloadedSong = (s: Song): boolean =>
    downloadedIds.has(s.apiId) ||
    downloadedDirs.has(
      sanitizeForPath(`${s.artist} - ${s.title}`).toLowerCase(),
    );
  const visibleSongs =
    stock === "all"
      ? songs
      : songs.filter((s) =>
          stock === "owned" ? isDownloadedSong(s) : !isDownloadedSong(s),
        );

  return (
    <div>
      <h2>{t.search.title}</h2>
      <form className="row" style={{ marginBottom: 16 }} onSubmit={onSubmit}>
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder={t.search.artistPlaceholder}
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
        />
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder={t.search.titlePlaceholder}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button className="btn primary" type="submit" disabled={loading}>
          {loading ? t.search.searching : t.search.searchButton}
        </button>
      </form>

      <div style={{ marginBottom: 12 }}>
        <button
          className="btn small"
          type="button"
          onClick={() => setShowFilters((v) => !v)}
        >
          <SlidersHorizontal size={14} aria-hidden />
          {t.search.filters}
          {activeFilterCount > 0 && (
            <span className="badge" style={{ marginLeft: 6 }}>
              {activeFilterCount}
            </span>
          )}
          {showFilters ? (
            <ChevronUp size={14} aria-hidden />
          ) : (
            <ChevronDown size={14} aria-hidden />
          )}
        </button>
        {showFilters && (
          <div className="row" style={{ marginTop: 8, flexWrap: "wrap" }}>
            <select
              className="input"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              <option value="">{t.search.languageAll}</option>
              {USDB_LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
            <select
              className="input"
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
            >
              <option value="">{t.search.genreAll}</option>
              {USDB_GENRES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <input
              className="input"
              style={{ width: 110 }}
              type="number"
              placeholder={t.search.yearPlaceholder}
              value={year}
              onChange={(e) => setYear(e.target.value)}
            />
            <select
              className="input"
              value={order}
              onChange={(e) => setOrder(e.target.value)}
            >
              {ORDER_VALUES.map((o) => (
                <option key={o} value={o}>
                  {t.search.sortBy(t.search.order[o])}
                </option>
              ))}
            </select>
            <button
              className="btn small"
              type="button"
              onClick={() => setUd((d) => (d === "desc" ? "asc" : "desc"))}
              title={ud === "desc" ? t.search.descending : t.search.ascending}
            >
              {ud === "desc" ? (
                <>
                  <ArrowDown size={14} aria-hidden /> {t.search.descending}
                </>
              ) : (
                <>
                  <ArrowUp size={14} aria-hidden /> {t.search.ascending}
                </>
              )}
            </button>
            <select
              className="input"
              value={stock}
              onChange={(e) => setStock(e.target.value as typeof stock)}
            >
              <option value="all">{t.search.stockAll}</option>
              <option value="missing">{t.search.stockMissing}</option>
              <option value="owned">{t.search.stockOwned}</option>
            </select>
            <label className="row-inline muted" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={golden}
                onChange={(e) => setGolden(e.target.checked)}
              />
              {t.search.onlyGolden}
            </label>
            <label className="row-inline muted" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={songcheck}
                onChange={(e) => setSongcheck(e.target.checked)}
              />
              {t.search.onlySongcheck}
            </label>
          </div>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {searched && !loading && songs.length === 0 && (
        <p className="muted">{t.search.noHits}</p>
      )}

      {songs.length > 0 && (
        <>
          {visibleSongs.length === 0 ? (
            <p className="muted">
              {stock === "missing"
                ? t.search.allOnPageOwned
                : t.search.allOnPageMissing}
            </p>
          ) : (
            <table className="song-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }} />
                  <th>{t.search.colArtist}</th>
                  <th>{t.search.colTitle}</th>
                  <th>{t.search.colLanguages}</th>
                  <th style={{ width: 70 }}>{t.search.colRating}</th>
                  <th style={{ width: 70 }}>{t.search.colViews}</th>
                  <th style={{ width: 170 }} />
                </tr>
              </thead>
              <tbody>
                {visibleSongs.map((s) => {
                  const isDownloaded = isDownloadedSong(s);
                  return (
                    <tr key={s.apiId}>
                      <td>
                        <CoverThumb apiId={s.apiId} />
                      </td>
                      <td style={{ color: "var(--yellow)" }}>{s.artist}</td>
                      <td>
                        {s.title}{" "}
                        {isDownloaded && (
                          <span
                            className="check"
                            title={t.search.alreadyDownloaded}
                          >
                            <Check size={14} aria-hidden />
                          </span>
                        )}
                      </td>
                      <td>
                        {s.languages.map((l) => (
                          <span key={l} className="tag">
                            {l}
                          </span>
                        ))}
                      </td>
                      <td className="muted">
                        {s.rating !== undefined
                          ? `★ ${s.rating.toLocaleString(t.locale)}`
                          : ""}
                      </td>
                      <td className="muted">
                        {s.views !== undefined
                          ? s.views.toLocaleString(t.locale)
                          : ""}
                      </td>
                      <td>
                        {!isDownloaded && (
                          <span className="row">
                            <button
                              className="btn small primary"
                              type="button"
                              aria-label={t.search.download}
                              title={t.search.download}
                              disabled={!canDownload}
                              onClick={() =>
                                void window.ultrastar.downloadSingle(s)
                              }
                            >
                              <Download size={14} aria-hidden />
                            </button>
                            <button
                              className="btn small"
                              type="button"
                              onClick={() =>
                                void window.ultrastar.queueAdd([s])
                              }
                            >
                              <Plus size={14} aria-hidden />
                              {t.search.queue}
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <div
            className="row"
            style={{ marginTop: 12, justifyContent: "space-between" }}
          >
            <span className="row">
              <button
                className="btn small"
                type="button"
                onClick={() => void window.ultrastar.queueAdd(visibleSongs)}
              >
                <Plus size={14} aria-hidden />
                {t.search.pageToQueue}
              </button>
              <button
                className="btn small"
                type="button"
                disabled={bulkRunning}
                onClick={() =>
                  void window.ultrastar.queueFetchAllPages(filterRequest())
                }
              >
                <Plus size={14} aria-hidden />
                {t.search.allPages(totalPages)}
              </button>
            </span>
            <span className="row">
              <button
                className="btn small"
                type="button"
                aria-label={t.search.prevPage}
                title={t.search.prevPage}
                disabled={page <= 1 || loading}
                onClick={() => void fetchPage(page - 1)}
              >
                <ChevronLeft size={14} aria-hidden />
              </button>
              <span className="muted">
                {t.search.pageOf(totalPages === 0 ? 0 : page, totalPages)}
              </span>
              <button
                className="btn small"
                type="button"
                aria-label={t.search.nextPage}
                title={t.search.nextPage}
                disabled={page >= totalPages || loading}
                onClick={() => void fetchPage(page + 1)}
              >
                <ChevronRight size={14} aria-hidden />
              </button>
            </span>
          </div>
        </>
      )}

      <div style={{ marginTop: 20 }}>
        <button
          className="btn"
          type="button"
          disabled={bulkRunning}
          onClick={queueEntireDatabase}
        >
          <Database size={16} aria-hidden />
          {t.search.entireDatabase}
        </button>
        {fetchAllProgress && (
          <p className="muted">
            {t.search.loadingPages(
              fetchAllProgress.current,
              fetchAllProgress.total,
            )}
          </p>
        )}
      </div>
    </div>
  );
};

export default SearchView;
