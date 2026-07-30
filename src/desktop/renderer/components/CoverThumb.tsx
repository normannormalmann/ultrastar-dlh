import type { FC } from "react";
import { useEffect, useState } from "react";

/**
 * Cover thumbnail: USDB cover for real apiIds, local cover.jpg
 * (via covers:getLocal) for imported/reconstructed entries.
 */
export const CoverThumb: FC<{ apiId: number; songDir?: string }> = ({
  apiId,
  songDir,
}) => {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load =
      apiId > 0
        ? window.ultrastar.coverGet(apiId)
        : songDir
          ? window.ultrastar.coverGetLocal(songDir)
          : Promise.resolve(null);
    void load.then((url) => {
      if (alive) setSrc(url);
    });
    return () => {
      alive = false;
    };
  }, [apiId, songDir]);
  return src ? (
    <img className="cover-thumb" src={src} alt="" />
  ) : (
    <div className="cover-thumb" />
  );
};

export default CoverThumb;
