// src/core/create/writeSongTxt.ts
import { spracheTag } from "./languages.ts";
import type { SongData } from "./songData.ts";

export type TxtHeaderInput = {
  artist: string;
  title: string;
  mp3: string;
  language?: string;
  genre?: string;
  year?: number;
  cover?: string;
  video?: string;
  creator?: string;
};

/**
 * Serialisiert SongData ins UltraStar-Format.
 * BPM wird bewusst mit Punkt geschrieben: repairSongs.ts liest zwar auch
 * Komma (deutsche Bestandsdateien), neu erzeugte Dateien sollen aber die
 * eindeutige Variante nutzen.
 */
export const renderSongTxt = (data: SongData, headers: TxtHeaderInput): string => {
  const zeilen: string[] = [
    `#TITLE:${headers.title}`,
    `#ARTIST:${headers.artist}`,
    `#MP3:${headers.mp3}`,
  ];

  // Der Job traegt den ISO-Code, weil die Pipeline ihn braucht; die
  // Kopfzeile will den Namen, wie ihn die Songdatenbank schreibt.
  const sprache = headers.language ?? data.language;
  if (sprache) zeilen.push(`#LANGUAGE:${spracheTag(sprache)}`);
  if (headers.genre) zeilen.push(`#GENRE:${headers.genre}`);
  if (headers.year !== undefined) zeilen.push(`#YEAR:${headers.year}`);
  if (headers.cover) zeilen.push(`#COVER:${headers.cover}`);
  if (headers.video) zeilen.push(`#VIDEO:${headers.video}`);
  if (headers.creator) zeilen.push(`#CREATOR:${headers.creator}`);

  zeilen.push(`#BPM:${data.bpm}`);
  zeilen.push(`#GAP:${Math.round(data.gap)}`);

  // Umbrueche nach Notenindex vorgruppieren, damit sie in einem Durchlauf
  // an der richtigen Stelle eingefuegt werden koennen.
  const umbruchNach = new Map<number, number>();
  for (const b of data.lineBreaks) umbruchNach.set(b.afterNoteIndex, b.beat);

  data.notes.forEach((note, i) => {
    zeilen.push(
      `: ${Math.round(note.beat)} ${Math.round(note.length)} ${Math.round(note.pitch)} ${note.syllable}`,
    );
    const umbruch = umbruchNach.get(i);
    // Kein Umbruch nach der letzten Note: dort folgt direkt das E.
    if (umbruch !== undefined && i < data.notes.length - 1) {
      zeilen.push(`- ${Math.round(umbruch)}`);
    }
  });

  zeilen.push("E");
  return `${zeilen.join("\n")}\n`;
};
