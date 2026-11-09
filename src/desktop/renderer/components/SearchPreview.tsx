import { useEffect, useState } from "react";
import type { Song } from "../../shared/ipcContract.ts";

export const SearchPreview = ({
  song,
  onClose,
}: {
  song: Song;
  onClose: () => void;
}) => {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setUrl(null);
    setError("");
    void window.ultrastar
      .searchPreview(song)
      .then((url) => {
        if (active) setUrl(url);
      })
      .catch((error) => {
        if (active) setError(String(error));
      });
    return () => {
      active = false;
    };
  }, [song]);
  return (
    <section className="search-preview" aria-label="Songvorschau">
      <strong>
        {song.artist} – {song.title}
      </strong>
      {error ? (
        <span role="alert">{error}</span>
      ) : url ? (
        // biome-ignore lint/a11y/useMediaCaption: remote music preview has no available caption track
        <audio
          key={url}
          src={url}
          controls
          autoPlay
          onError={() =>
            setError(
              "Die Vorschau ist nicht verfügbar. Bitte erneut versuchen.",
            )
          }
        />
      ) : (
        <span role="status">Vorschau wird geladen …</span>
      )}
      <button type="button" className="btn small" onClick={onClose}>
        Vorschau schließen
      </button>
    </section>
  );
};
