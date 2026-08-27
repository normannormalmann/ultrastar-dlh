// src/desktop/renderer/i18n/index.tsx
// Three-language UI without an i18n dependency. The German catalog is the
// source of truth: its inferred shape types the other two, so a missing or
// misspelled key is a compile error rather than a blank label at runtime.
// Strings that take values are plain functions, which keeps the argument
// types honest per language.
import type { FC, ReactNode } from "react";
import { createContext, useContext } from "react";
import { de } from "./de.ts";
import { en } from "./en.ts";
import { es } from "./es.ts";

export type Sprache = "de" | "en" | "es";
export type Katalog = typeof de;

export const SPRACHEN: readonly Sprache[] = ["de", "en", "es"] as const;

/** Shown in the language picker - each in its own language, never translated. */
export const SPRACH_NAMEN: Record<Sprache, string> = {
  de: "Deutsch",
  en: "English",
  es: "Español",
};

const KATALOGE: Record<Sprache, Katalog> = { de, en, es };

/**
 * Falls back to German for anything unknown, including the "follow the
 * system" case where no language was ever configured.
 */
export const aufloesenSprache = (wert: string | undefined): Sprache => {
  if (wert === "de" || wert === "en" || wert === "es") return wert;
  const system = navigator.language.slice(0, 2);
  return system === "en" || system === "es" ? system : "de";
};

const Kontext = createContext<{ t: Katalog; sprache: Sprache }>({
  t: de,
  sprache: "de",
});

export const SpracheProvider: FC<{
  sprache: Sprache;
  children: ReactNode;
}> = ({ sprache, children }) => (
  <Kontext.Provider value={{ t: KATALOGE[sprache], sprache }}>
    {children}
  </Kontext.Provider>
);

/** The catalog for the active language. */
export const useT = (): Katalog => useContext(Kontext).t;

/** The active language itself, for date and number formatting. */
export const useSprache = (): Sprache => useContext(Kontext).sprache;
