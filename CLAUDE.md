# Project conventions

## Language
- Code comments (including JSDoc) are written in **English**.
- User-facing strings in `src/desktop/renderer/` and end-user docs (`docs/TUTORIAL.md`) stay **German** — the app is intentionally localized for German-speaking users (`lang="de"`). Don't translate these.

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
