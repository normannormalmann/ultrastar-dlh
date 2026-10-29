// src/desktop/renderer/components/editor/openEditor.ts
// Any list that shows a song folder can open it in the editor without the
// callback being threaded through every view in between.
import { createContext, useContext } from "react";

export type EditorTarget = { songDir: string; heading: string };

export const OpenEditorContext = createContext<(target: EditorTarget) => void>(
  () => {},
);

export const useOpenEditor = (): ((target: EditorTarget) => void) =>
  useContext(OpenEditorContext);
