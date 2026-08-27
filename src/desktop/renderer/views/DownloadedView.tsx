import { FolderOpen, FolderSearch, RefreshCw, Tags } from "lucide-react";
import type { FC } from "react";
import { useEffect, useRef, useState } from "react";

const PAGE_SIZE = 500;
import type {
  ArchiveImportResult,
  DownloadedEntry,
  GenreEnrichResult,
} from "../../shared/ipcContract.ts";
import CoverThumb from "../components/CoverThumb.tsx";
import { useIpcEvent } from "../hooks.ts";
import { type Katalog, useT } from "../i18n/index.tsx";

/** Split multi-value fields ("Japanese, German") into individual values. */
const splitValues = (t: Katalog, raw: string | undefined): string[] => {
  if (!raw) return [t.downloaded.unknown];
  const parts = raw
    .split(/[,;/]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts : [t.downloaded.unknown];
};

const importMessage = (t: Katalog, r: ArchiveImportResult): string => {
  const parts = [t.downloaded.imported(r.imported)];
  if (r.importedWithoutVideo > 0) {
    parts.push(t.downloaded.importedWithoutVideo(r.importedWithoutVideo));
  }
  if (r.skipped > 0) parts.push(t.downloaded.importSkipped(r.skipped));
  if (r.refreshed > 0) {
    parts.push(t.downloaded.importRefreshed(r.refreshed));
  }
  return parts.join(" · ");
};

export const DownloadedView: FC<{ entries: DownloadedEntry[] }> = ({
  entries,
}) => {
  const t = useT();
  const zahl = (n: number): string => n.toLocaleString(t.locale);
  const importProgress = useIpcEvent("event:archiveImportProgress", null);
  const refreshProgress = useIpcEvent("event:libraryRefreshProgress", null);
  const genreEnrichProgress = useIpcEvent("event:genreEnrichProgress", null);
  const [filter, setFilter] = useState("");
  const [langFilter, setLangFilter] = useState("");
  const [genreFilter, setGenreFilter] = useState("");
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");
  const [sortBy, setSortBy] = useState<"newest" | "artist" | "title" | "year">(
    "newest",
  );
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [importing, setImporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [importResult, setImportResult] = useState<ArchiveImportResult | null>(
    null,
  );
  const [importError, setImportError] = useState<string | null>(null);
  const [enrichResult, setEnrichResult] = useState<GenreEnrichResult | null>(
    null,
  );

  // Render from the top again when filters/sorting change
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on every criteria change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [filter, langFilter, genreFilter, yearFrom, yearTo, sortBy]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries_) => {
      if (entries_.some((e) => e.isIntersecting)) {
        setVisibleCount((c) => c + PAGE_SIZE);
      }
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  const runImport = async (): Promise<void> => {
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      setImportResult(await window.ultrastar.archiveImport());
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  const runEnrich = async (): Promise<void> => {
    setEnriching(true);
    setEnrichResult(null);
    setImportError(null);
    try {
      setEnrichResult(await window.ultrastar.genresEnrich());
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnriching(false);
    }
  };

  const importButton = (
    <button
      className="btn"
      type="button"
      disabled={importing}
      onClick={() => void runImport()}
    >
      <FolderSearch size={14} aria-hidden />
      {importing ? t.downloaded.importing : t.downloaded.importArchive}
    </button>
  );

  const q = filter.trim().toLowerCase();
  const from = yearFrom ? Number.parseInt(yearFrom, 10) : null;
  const to = yearTo ? Number.parseInt(yearTo, 10) : null;

  const matchesText = (e: DownloadedEntry): boolean =>
    !q ||
    e.artist.toLowerCase().includes(q) ||
    e.title.toLowerCase().includes(q);
  const matchesLang = (e: DownloadedEntry): boolean =>
    !langFilter || splitValues(t, e.language).includes(langFilter);
  const matchesGenre = (e: DownloadedEntry): boolean =>
    !genreFilter || splitValues(t, e.genre).includes(genreFilter);
  const matchesYear = (e: DownloadedEntry): boolean => {
    if (from !== null && (e.year === undefined || e.year < from)) return false;
    if (to !== null && (e.year === undefined || e.year > to)) return false;
    return true;
  };

  const facetOptions = (
    pool: DownloadedEntry[],
    field: "language" | "genre",
  ): Array<[string, number]> => {
    const counts = new Map<string, number>();
    for (const e of pool) {
      for (const v of splitValues(t, e[field])) {
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => {
      if (a[0] === t.downloaded.unknown) return 1;
      if (b[0] === t.downloaded.unknown) return -1;
      return a[0].localeCompare(b[0], t.locale);
    });
  };

  const languageOptions = facetOptions(
    entries.filter((e) => matchesText(e) && matchesGenre(e) && matchesYear(e)),
    "language",
  );
  const genreOptions = facetOptions(
    entries.filter((e) => matchesText(e) && matchesLang(e) && matchesYear(e)),
    "genre",
  );

  const filteredBase = entries.filter(
    (e) =>
      matchesText(e) && matchesLang(e) && matchesGenre(e) && matchesYear(e),
  );
  switch (sortBy) {
    case "artist":
      filteredBase.sort((a, b) => a.artist.localeCompare(b.artist, t.locale));
      break;
    case "title":
      filteredBase.sort((a, b) => a.title.localeCompare(b.title, t.locale));
      break;
    case "year":
      filteredBase.sort(
        (a, b) =>
          (a.year ?? Number.MAX_SAFE_INTEGER) -
          (b.year ?? Number.MAX_SAFE_INTEGER),
      );
      break;
    default:
      filteredBase.sort((a, b) => b.downloadedAt.localeCompare(a.downloadedAt));
  }
  const filtered = filteredBase;

  return (
    <div>
      <h2>Heruntergeladen ({entries.length})</h2>
      <div className="row" style={{ marginBottom: 14 }}>
        <input
          className="input"
          style={{ width: 320 }}
          placeholder={t.downloaded.filterPlaceholder}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <select
          className="input"
          value={langFilter}
          onChange={(e) => setLangFilter(e.target.value)}
        >
          <option value="">{t.search.languageAll}</option>
          {langFilter && !languageOptions.some(([l]) => l === langFilter) && (
            <option value={langFilter}>{langFilter} (0)</option>
          )}
          {languageOptions.map(([lang, count]) => (
            <option key={lang} value={lang}>
              {lang} ({zahl(count)})
            </option>
          ))}
        </select>
        <select
          className="input"
          value={genreFilter}
          onChange={(e) => setGenreFilter(e.target.value)}
        >
          <option value="">{t.search.genreAll}</option>
          {genreFilter && !genreOptions.some(([g]) => g === genreFilter) && (
            <option value={genreFilter}>{genreFilter} (0)</option>
          )}
          {genreOptions.map(([g, count]) => (
            <option key={g} value={g}>
              {g} ({zahl(count)})
            </option>
          ))}
        </select>
        <input
          className="input"
          style={{ width: 90 }}
          type="number"
          placeholder={t.downloaded.yearFrom}
          value={yearFrom}
          onChange={(e) => setYearFrom(e.target.value)}
        />
        <input
          className="input"
          style={{ width: 90 }}
          type="number"
          placeholder={t.downloaded.yearTo}
          value={yearTo}
          onChange={(e) => setYearTo(e.target.value)}
        />
        <select
          className="input"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
        >
          <option value="newest">{t.downloaded.sortNewest}</option>
          <option value="artist">{t.downloaded.sortArtist}</option>
          <option value="title">{t.downloaded.sortTitle}</option>
          <option value="year">{t.downloaded.sortYear}</option>
        </select>
        {importButton}
        <button
          className="btn"
          type="button"
          disabled={refreshing}
          aria-label={t.downloaded.refreshLabel}
          title={t.downloaded.refreshTitle}
          onClick={() => {
            setRefreshing(true);
            void window.ultrastar
              .libraryRefresh()
              .finally(() => setRefreshing(false));
          }}
        >
          <RefreshCw size={14} aria-hidden />
          {refreshing ? t.downloaded.refreshing : t.downloaded.refresh}
        </button>
        <button
          className="btn"
          type="button"
          disabled={enriching}
          onClick={() => void runEnrich()}
        >
          <Tags size={14} aria-hidden />
          {enriching ? t.downloaded.enriching : t.downloaded.enrichGenres}
        </button>
      </div>
      {(langFilter || genreFilter || yearFrom || yearTo || filter) && (
        <p className="muted">
          {t.downloaded.hits(zahl(filtered.length))}
        </p>
      )}
      {importError && <div className="error-banner">{importError}</div>}
      {importResult && <p className="muted">{importMessage(t, importResult)}</p>}
      {genreEnrichProgress && (
        <div className="row" style={{ marginBottom: 10 }}>
          <span className="muted">
            {t.downloaded.enrichProgress(
              genreEnrichProgress.current,
              genreEnrichProgress.total,
              genreEnrichProgress.enriched,
            )}
          </span>
          <button
            className="btn small"
            type="button"
            onClick={() => void window.ultrastar.genresCancel()}
          >
            {t.downloaded.cancel}
          </button>
        </div>
      )}
      {enrichResult && (
        <p className="muted">
          {t.downloaded.enrichResult(
            enrichResult.enriched,
            enrichResult.notFound,
            enrichResult.txtPatched,
          )}
          {enrichResult.txtFailed > 0
            ? t.downloaded.enrichFilesFailed(enrichResult.txtFailed)
            : ""}
          {enrichResult.cancelled ? t.downloaded.enrichCancelled : ""}
        </p>
      )}
      {importProgress && (
        <div className="row" style={{ marginBottom: 10 }}>
          <span className="muted">
            {t.downloaded.scanningArchive(
              zahl(importProgress.current),
              zahl(importProgress.total),
            )}
          </span>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{
                width: `${Math.round((importProgress.current / Math.max(importProgress.total, 1)) * 100)}%`,
              }}
            />
          </div>
        </div>
      )}
      {refreshProgress && (
        <div className="row" style={{ marginBottom: 10 }}>
          <span className="muted">
            {t.downloaded.checkingLibrary(
              zahl(refreshProgress.current),
              zahl(refreshProgress.total),
            )}
          </span>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{
                width: `${Math.round((refreshProgress.current / Math.max(refreshProgress.total, 1)) * 100)}%`,
              }}
            />
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <div style={{ marginTop: 8 }}>
          <p className="muted" style={{ maxWidth: 520 }}>
            {t.downloaded.empty}
          </p>
          {importButton}
        </div>
      ) : filtered.length === 0 ? (
        <p className="muted">{t.downloaded.noFilterHits}</p>
      ) : (
        <>
          <table className="song-table">
            <thead>
              <tr>
                <th style={{ width: 36 }} />
                <th>{t.downloaded.colArtist}</th>
                <th>{t.downloaded.colTitle}</th>
                <th>{t.downloaded.colDate}</th>
                <th style={{ width: 120 }} />
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, visibleCount).map((e) => (
                <tr key={e.dirName}>
                  <td>
                    <CoverThumb apiId={e.apiId} songDir={e.songDir} />
                  </td>
                  <td style={{ color: "var(--green)" }}>{e.artist}</td>
                  <td>{e.title}</td>
                  <td className="muted">{e.downloadedAt.slice(0, 10)}</td>
                  <td>
                    <button
                      className="btn small"
                      type="button"
                      onClick={() =>
                        void window.ultrastar.openFolder(e.songDir)
                      }
                    >
                      <FolderOpen size={14} aria-hidden />
                      {t.downloaded.folder}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > visibleCount && (
            <p className="muted">
              {t.downloaded.showingOf(
                zahl(Math.min(visibleCount, filtered.length)),
                zahl(filtered.length),
              )}
            </p>
          )}
        </>
      )}
      <div ref={sentinelRef} />
    </div>
  );
};

export default DownloadedView;
