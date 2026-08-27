# Project conventions

## Language
- Code comments (including JSDoc) are written in **English**.
- The desktop UI ships in **German, English and Spanish**. No user-facing string belongs in a component: they all live in `src/desktop/renderer/i18n/`, where the German catalog is the source of truth and its inferred shape types the other two — a missing translation is a compile error, not a blank label. Values that take arguments are functions, so counts and plurals stay correct per language.
- Number, date and sort-order formatting goes through `t.locale`, never a hardcoded `de-DE`.
- End-user docs exist per language: `README.md` / `README.en.md` / `README.es.md` and `docs/TUTORIAL.md` / `.en.md` / `.es.md`. Keep them in step.
- The terminal version (`src/tui/`) stays **German** by deliberate choice.
- Values that travel to a server or into a file format are not UI text and stay as they are: the USDB filter values in `SearchView.tsx` and the English `tag` in `core/create/languages.ts` (the `#LANGUAGE` header).

## File naming
- Plain TypeScript modules: `camelCase.ts` (e.g. `failedDownloads.ts`, `ipcContract.ts`).
- React component files: `PascalCase.tsx`, matching the exported component name (e.g. `QueueView.tsx`, `CoverThumb.tsx`).
- Tests: `<module>.test.ts` next to the file under test.
- No kebab-case filenames.

## Effect usage
- `src/core/` uses [Effect](https://effect.website) for all I/O (`Effect.gen`, `Effect.tryPromise`, `Effect.catchAll`, etc.) — this is the shared business-logic layer.
- `src/desktop/main/` and `src/tui/` are plain-async consumers: they call into `core/` via `Effect.runPromise(...)` and are otherwise ordinary `async`/`await` code. This is intentional — Effect's benefits (typed errors, composability) apply to the business-logic layer, not to UI/process glue code.
- Avoid calling `Effect.runPromise` on a sub-Effect from *inside* another `Effect.tryPromise`/`Effect.gen` — use `yield*` to compose Effects directly instead.

## Dependencies
- Use Bun (`bun install`, `bun run <script>`, `bun test`) — see `.cursor/rules/use-bun-instead-of-node-vite-npm-pnpm.mdc`.
- Pin dependency versions (caret ranges); don't use `"latest"` as a version specifier.
