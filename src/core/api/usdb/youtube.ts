import { Effect } from "effect";
import { API_URL } from "./config.ts";

export type YoutubeLink = {
  createdAt: Date;
  link: string;
  videoGap?: string;
};

export const parseComments = (html: string): string[] => {
  return [
    ...html.matchAll(/<td>\d+\.\d+\.\d+ - \d+:\d+.*?<\/td>[\s\S]*?<\/td>/gm),
  ].map((m) => m[0]);
};

export const parseYoutubeLinkFromComment = (
  r: RegExpMatchArray | null,
): YoutubeLink | null => {
  const dateStr = r?.[1];
  const timeStr = r?.[2];
  const linkRaw = r?.[3];

  if (!dateStr || !timeStr || !linkRaw) return null;

  const [day, month, year] = dateStr.split(".") as [string, string, string];
  const [hour, minute] = timeStr.split(":") as [string, string];

  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );

  // Return the full URL instead of just the ID
  // This allows yt-dlp to handle all YouTube URL formats
  const link = linkRaw;
  if (!link) return null;

  return {
    createdAt: date,
    link,
  };
};

export const parseYoutubeLinks = (html: string): YoutubeLink[] =>
  parseComments(html)
    .map((c) => {
      const base = parseYoutubeLinkFromComment(
        c.match(
          /<td>(\d+\.\d+\.\d+) - (\d+:\d+)[\s\S]*src="(https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)[\w-]+)"/m,
        ),
      );
      if (!base) return null;
      const videoGap = c.match(/#VIDEOGAP:\s*(\d+(?:[.,]\d+)?)/i)?.[1];
      return videoGap ? { ...base, videoGap } : base;
    })
    .filter((l): l is YoutubeLink => l !== null);

export const fetchDetailPage = (id: number, cookie?: string) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(`${API_URL}/?link=detail&id=${id}`, {
        signal: AbortSignal.timeout(30_000),
        method: "GET",
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
        },
      });
      if (!response.ok) {
        throw new Error(
          `Detail request failed: ${response.status} ${response.statusText}`,
        );
      }
      return await response.text();
    },
    catch: (e) =>
      e instanceof Error ? e : new Error("Failed to fetch detail page"),
  });

export const getYoutubeLinksById = (id: number, cookie?: string) =>
  Effect.gen(function* () {
    const html = yield* fetchDetailPage(id, cookie);
    return parseYoutubeLinks(html);
  });
