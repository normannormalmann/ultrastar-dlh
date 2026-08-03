// src/core/create/languages.ts
// One table, two consumers with different needs:
//
//   - the pipeline wants the ISO 639-1 CODE. whisper answers anything else
//     with LanguageUnsupported, and only after the models are loaded.
//   - the UltraStar txt wants the language NAME, in the English spelling the
//     song database uses (see USDB_LANGUAGES in SearchView.tsx).
//
// Keeping both in one place is the point: a job carries the code, and
// writeSongTxt turns it into the tag. The codes are whisperx's own
// alignment-model table (DEFAULT_ALIGN_MODELS_HF plus
// DEFAULT_ALIGN_MODELS_TORCH in whisperx/alignment.py), read off the
// installed package rather than guessed - a code missing from it fails at the
// align stage.

export type Sprache = {
  code: string;
  /** German, for the wizard's list. */
  name: string;
  /** English, for #LANGUAGE - the spelling USDB uses. */
  tag: string;
};

/** German first, English second, the rest by German name. */
export const SPRACHEN: readonly Sprache[] = [
  { code: "de", name: "Deutsch", tag: "German" },
  { code: "en", name: "Englisch", tag: "English" },
  { code: "ar", name: "Arabisch", tag: "Arabic" },
  { code: "eu", name: "Baskisch", tag: "Basque" },
  { code: "zh", name: "Chinesisch", tag: "Chinese" },
  { code: "da", name: "Dänisch", tag: "Danish" },
  { code: "fi", name: "Finnisch", tag: "Finnish" },
  { code: "fr", name: "Französisch", tag: "French" },
  { code: "gl", name: "Galicisch", tag: "Galician" },
  { code: "ka", name: "Georgisch", tag: "Georgian" },
  { code: "el", name: "Griechisch", tag: "Greek" },
  { code: "he", name: "Hebräisch", tag: "Hebrew" },
  { code: "hi", name: "Hindi", tag: "Hindi" },
  { code: "id", name: "Indonesisch", tag: "Indonesian" },
  { code: "it", name: "Italienisch", tag: "Italian" },
  { code: "ja", name: "Japanisch", tag: "Japanese" },
  { code: "ca", name: "Katalanisch", tag: "Catalan" },
  { code: "ko", name: "Koreanisch", tag: "Korean" },
  { code: "hr", name: "Kroatisch", tag: "Croatian" },
  { code: "lv", name: "Lettisch", tag: "Latvian" },
  { code: "ml", name: "Malayalam", tag: "Malayalam" },
  { code: "nl", name: "Niederländisch", tag: "Dutch" },
  { code: "no", name: "Norwegisch", tag: "Norwegian" },
  { code: "nn", name: "Norwegisch (Nynorsk)", tag: "Norwegian" },
  { code: "fa", name: "Persisch", tag: "Persian" },
  { code: "pl", name: "Polnisch", tag: "Polish" },
  { code: "pt", name: "Portugiesisch", tag: "Portuguese" },
  { code: "ro", name: "Rumänisch", tag: "Romanian" },
  { code: "ru", name: "Russisch", tag: "Russian" },
  { code: "sv", name: "Schwedisch", tag: "Swedish" },
  { code: "sk", name: "Slowakisch", tag: "Slovak" },
  { code: "sl", name: "Slowenisch", tag: "Slovenian" },
  { code: "es", name: "Spanisch", tag: "Spanish" },
  { code: "tl", name: "Tagalog", tag: "Tagalog" },
  { code: "te", name: "Telugu", tag: "Telugu" },
  { code: "cs", name: "Tschechisch", tag: "Czech" },
  { code: "tr", name: "Türkisch", tag: "Turkish" },
  { code: "uk", name: "Ukrainisch", tag: "Ukrainian" },
  { code: "hu", name: "Ungarisch", tag: "Hungarian" },
  { code: "ur", name: "Urdu", tag: "Urdu" },
  { code: "vi", name: "Vietnamesisch", tag: "Vietnamese" },
];

const finde = (code: string): Sprache | undefined =>
  SPRACHEN.find((s) => s.code === code.trim().toLowerCase());

/** German name for the wizard; an unknown code is shown as it is. */
export const spracheName = (code: string): string => finde(code)?.name ?? code;

/**
 * The #LANGUAGE value. Anything that is not one of our codes is passed
 * through unchanged: an imported song may well already carry "German", and
 * rewriting a name we do not know would be worse than leaving it alone.
 */
export const spracheTag = (sprache: string): string =>
  finde(sprache)?.tag ?? sprache;

export const istBekannteSprache = (code: string): boolean =>
  finde(code) !== undefined;
