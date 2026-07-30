import { expect, test } from "bun:test";
import {
  buildFormBody,
  parseSongFromTable,
  parseSongsFromSearch,
} from "./search.ts";

/**
 * Inner HTML of a USDB result row (live-verified cell structure).
 * Title cell with an UNCLOSED <a> (that's how USDB serves it); the last
 * zip cell has no attributes and isn't captured by the td regex.
 */
const songRow = (
  id: number,
  artist: string,
  title: string,
  language: string,
  opts: {
    genre?: string;
    year?: string;
    edition?: string;
    golden?: "Yes" | "No";
    creator?: string;
    ratingHtml?: string;
    views?: string;
  } = {},
) => `
  <td onclick="show_detail(${id})">${artist}</td>
  <td onclick="show_detail(${id})"><a href="?link=detail&id=${id}">${title}</td>
  <td onclick="show_detail(${id})">${opts.genre ?? ""}</td>
  <td onclick="show_detail(${id})">${opts.year ?? ""}</td>
  <td onclick="show_detail(${id})">${opts.edition ?? ""}</td>
  <td onclick="show_detail(${id})">${opts.golden ?? "No"}</td>
  <td onclick="show_detail(${id})">${language}</td>
  <td onclick="show_detail(${id})">${opts.creator ?? ""}</td>
  <td onclick="show_detail(${id})">${opts.ratingHtml ?? ""}</td>
  <td onclick="show_detail(${id})">${opts.views ?? ""}</td>
  <td><a href="#" onClick="addToList(${id}, 1)"><img src="images/mini-zip.png" border="0"></a></td>
`;

test("parses a single song row", () => {
  expect(
    parseSongFromTable(songRow(1234, "ABBA", "Dancing Queen", "English")),
  ).toEqual({
    apiId: 1234,
    artist: "ABBA",
    title: "Dancing Queen",
    languages: ["english"],
    goldenNotes: false,
  });
});

test("splits multiple languages and lowercases them", () => {
  const song = parseSongFromTable(
    songRow(7, "Nena", "99 Luftballons", "German, English"),
  );
  expect(song?.languages).toEqual(["german", "english"]);
});

test("decodes HTML entities in artist and title", () => {
  const song = parseSongFromTable(
    songRow(42, "Simon &amp; Garfunkel", "Don&#39;t Stop", "English"),
  );
  expect(song?.artist).toBe("Simon & Garfunkel");
  expect(song?.title).toBe("Don't Stop");
});

test("returns null for unparseable input", () => {
  expect(parseSongFromTable(undefined)).toBeNull();
  expect(parseSongFromTable("")).toBeNull();
  expect(parseSongFromTable('<td class="c">only one cell</td>')).toBeNull();
});

test("parses a full search page with total pages", () => {
  const html = `
    <br>There are 412 results on 21 pages
    <table>
      <tr class="list_tr1" id="r1">${songRow(1, "ABBA", "Waterloo", "English")}</tr>
      <tr class="list_tr2" id="r2">${songRow(2, "Toto", "Africa", "English")}</tr>
    </table>`;
  const page = parseSongsFromSearch(html);
  expect(page.totalPages).toBe(21);
  expect(page.songs).toHaveLength(2);
  expect(page.songs[0]?.apiId).toBe(1);
  expect(page.songs[1]?.title).toBe("Africa");
});

test("returns totalPages 0 when summary line is missing", () => {
  expect(parseSongsFromSearch("<table></table>").totalPages).toBe(0);
});

test("buildFormBody includes filters only when set", () => {
  const base = buildFormBody({});
  expect(base.get("order")).toBe("lastchange");
  expect(base.get("ud")).toBe("desc");
  expect(base.get("language")).toBeNull();
  expect(base.get("genre")).toBeNull();
  expect(base.get("year")).toBeNull();

  const filtered = buildFormBody({
    language: "German",
    genre: "Pop",
    year: 1999,
    order: "year",
    ud: "asc",
  });
  expect(filtered.get("language")).toBe("German");
  expect(filtered.get("genre")).toBe("Pop");
  expect(filtered.get("year")).toBe("1999");
  expect(filtered.get("order")).toBe("year");
  expect(filtered.get("ud")).toBe("asc");
});

test("parses extended row metadata", () => {
  const song = parseSongFromTable(
    songRow(15472, "Passion Pit", "Carried Away", "English", {
      genre: "Pop",
      year: "2012",
      golden: "Yes",
      creator: "horrible",
      ratingHtml:
        '<img src="images/star.png"> <img src="images/star.png"> <img src="images/half_star.png"> <img src="images/star2.png"> <img src="images/star2.png">',
      views: "401",
    }),
  );
  expect(song?.genre).toBe("Pop");
  expect(song?.year).toBe(2012);
  expect(song?.goldenNotes).toBe(true);
  expect(song?.creator).toBe("horrible");
  expect(song?.rating).toBe(2.5);
  expect(song?.views).toBe(401);
});

test("omits extended fields when cells are empty", () => {
  const song = parseSongFromTable(songRow(7, "A", "B", "English"));
  expect(song?.genre).toBeUndefined();
  expect(song?.year).toBeUndefined();
  expect(song?.goldenNotes).toBe(false);
  expect(song?.rating).toBeUndefined();
  expect(song?.views).toBeUndefined();
});

test("buildFormBody sends golden and songcheck only when true", () => {
  expect(buildFormBody({}).get("golden")).toBeNull();
  expect(buildFormBody({}).get("songcheck")).toBeNull();
  const f = buildFormBody({ golden: true, songcheck: true });
  expect(f.get("golden")).toBe("1");
  expect(f.get("songcheck")).toBe("1");
});
