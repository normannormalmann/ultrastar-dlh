import { expect, test } from "bun:test";
import { parseDeezerAlbum, pickDeezerTracks } from "./deezer.ts";

const SEARCH_FIXTURE = {
  data: [
    {
      id: 3135556,
      title: "Fledermausland",
      bpm: 0,
      explicit_lyrics: true,
      artist: { name: "Trailerpark" },
      album: { id: 302127 },
    },
    {
      id: 999,
      title: "Fledermausland (Karaoke Version)",
      bpm: 120.5,
      explicit_lyrics: false,
      artist: { name: "Karaoke Crew" },
      album: { id: 1 },
    },
  ],
};

test("picks first track whose artist matches", () => {
  const t = pickDeezerTracks(SEARCH_FIXTURE, "Trailerpark")[0];
  expect(t?.albumId).toBe(302127);
  expect(t?.explicit).toBe(true);
  expect(t?.realBpm).toBeUndefined(); // bpm 0 → kein Wert
});

test("returns null when no artist matches", () => {
  expect(pickDeezerTracks(SEARCH_FIXTURE, "Rammstein")).toEqual([]);
});

const ALBUM_FIXTURE = {
  release_date: "2012-06-15",
  genres: { data: [{ name: "Rap/Hip Hop" }] },
};

test("parses album genre (normalized) and year", () => {
  const r = parseDeezerAlbum(ALBUM_FIXTURE);
  expect(r?.genre).toBe("Hip-Hop");
  expect(r?.year).toBe(2012);
});

test("returns null when album has no genres", () => {
  expect(
    parseDeezerAlbum({ release_date: "2012-06-15", genres: { data: [] } }),
  ).toBeNull();
});

test("pickDeezerTracks returns up to 3 artist-matching candidates in order", () => {
  const fixture = {
    data: [
      { id: 1, title: "T", artist: { name: "Trailerpark" }, album: { id: 11 } },
      {
        id: 2,
        title: "T2",
        artist: { name: "Karaoke Crew" },
        album: { id: 22 },
      },
      {
        id: 3,
        title: "T3",
        artist: { name: "Trailerpark" },
        album: { id: 33 },
      },
      {
        id: 4,
        title: "T4",
        artist: { name: "trailerpark" },
        album: { id: 44 },
      },
      {
        id: 5,
        title: "T5",
        artist: { name: "Trailerpark" },
        album: { id: 55 },
      },
    ],
  };
  const picks = pickDeezerTracks(fixture, "Trailerpark", "Trailerpark");
  expect(picks.map((p) => p.albumId)).toEqual([11, 33, 44]);
});
