# AGENTS.md

Instructions for anyone (human or agent) changing this repo.

## Read this first

1. **Read [CHECKLIST.md](./CHECKLIST.md) before you start.** It is the backlog and the record of what shipped.
2. Find your task there. If it is not there, add it (see [the checklist protocol](#the-checklist-protocol)) before you write code.

## What this project is

Algo3D is a browser-based data-structure visualiser. You write Java, Python,
JavaScript or C++; the app traces the program and steps it through a warm
paper-and-gold 3D scene.

| Layer | Where | Notes |
|---|---|---|
| Java parser + tracer | `src/jvm/` | The only real engine: `interp.ts` executes a parsed AST, capped at 4000 steps, depth 90, 300 heap objects. |
| Python / JS / C++ | `src/lang/{python,js,cpp}.ts` | **Transpiled to Java**, then traced. Every translator must throw `TranslateError(message, line)` for anything it cannot express, and keep `Out`'s line map accurate so errors and steps point at the user's own lines. |
| Accepted subset text | `src/lang/index.ts` (`LANGS[].subset`) | Shown under the editor. **Keep it in sync** whenever a translator gains or loses a feature. |
| 3D topic views | `src/topics/*` | One module per topic: `build(params) → { java, steps }`, `View`, `Controls`. The library is Java-only today. |
| Shared stage | `src/three/` | `Scene.tsx` (canvas, lights, grid), `theme.ts` (`STAGE` colours), `anim.tsx` (animated tiles/edges). |
| Memory view | `src/memory/MemoryStage.tsx` | Heap frames for arbitrary user programs. |
| Lab shell | `src/CodeLab.tsx`, `src/App.tsx` | Modes, panes, shortcuts, saved codes, rooms. |
| Accounts / saves | `src/auth/`, `api/`, `db/` | Clerk for sign-in, Neon Postgres through the small API in `api/`. |
| Board | `src/board/` | Excalidraw canvas. |

## Commands

```bash
npm run dev        # vite dev server on :5173
npm run dev:api    # API on :3000, needs .env.local
npm run build      # tsc --noEmit + vite build (the check that matters)
npx tsc --noEmit -p tsconfig.json
npm run verify     # headless trace/transpiler checks
npm run db:push    # schema
npm run api:smoke
```

## Conventions

- **Never hardcode a colour in a scene.** `STAGE.light` / `STAGE.dark` in `src/three/theme.ts` own stage furniture (`paper`, `plate`, `grid`, lights, shadows); `readable()` lifts dark ink for dark mode. A literal hex in a topic View is a bug — that is exactly how the matrix pane went black.
- **Theme in CSS only through the tokens** at the top of `src/index.css` (`--card`, `--ink`, `--line`, `--gold`, …). A `var(--something, #fallback)` whose variable is never defined silently pins you to one theme.
- **Panels must survive a crash.** Wrap new panes in `PaneBoundary` with a `label` and `resetKey`.
- **Layout is two-dimensional**: the desktop grid collapses to one pane at a time below 1080 px (`data-view` on `.lab`), and the phone layout pins section navigation to a bottom bar below 760 px. Check both whenever you touch structure.
- **Typed input on phones is 16 px** minimum so iOS does not zoom; do not shrink it.
- Comments explain *why*, in the voice used across the codebase ("phones get shorter labels so the header stays on one line"). Keep that style.
- No new dependencies without a reason the checklist can record.

## Verifying a change

- `npx tsc --noEmit -p tsconfig.json` → exit 0.
- `npm run build` → exit 0. The >500 kB chunk warnings are pre-existing and come from lazily loaded Excalidraw/mermaid bundles.
- UI work: look at it in the running dev server in **both themes**, at a desktop width (≥1100 px) and a phone width (≤420 px).
- Say plainly what you did not check. Do not report a visual change you never looked at as verified.

## The checklist protocol

`CHECKLIST.md` is the contract. Follow it exactly:

1. **Before starting:** open the checklist, find the item, and if it is new, add it under the right priority with tags (`P0`–`P3`) and an area (`ui`, `editor`, `runtime`, `lang`, `viz`, `library`, `saves`, `rooms`, `board`, `platform`). Estimate with `S`/`M`/`L`.
2. **While working:** move the item to **In progress** (one or two items at most; do not let that section grow).
3. **When done:** move it to the top of **Done** with
   - the date (`YYYY-MM-DD`),
   - the commit hash once committed,
   - one line saying what actually shipped, not what was attempted.
4. **New work discovered on the way** (a bug you saw, a gap you noticed) becomes a new item — never a sentence in a chat reply that is then forgotten.
5. **Never delete or rewrite history in the checklist.** If an item was wrong, mark it done with a note explaining why the plan changed.
6. **Commit the checklist in the same commit as the code change.** A code commit that closes an item without updating `CHECKLIST.md` is incomplete.
7. **Keep entries honest.** Partial work stays open with a note about what remains; a passing build is not the same as a working feature.

## Things that are deliberately out of scope

- `Scanner`, `cin` and stdin: values go through the Inputs panel instead.
- Network, threads, files and time in user programs: they are not part of the traced subset, and the translators should reject them with a clear message.
