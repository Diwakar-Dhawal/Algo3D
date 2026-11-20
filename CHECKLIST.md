# Algo3D — work checklist

The single source of truth for what is planned, in progress and shipped.
Read it before starting any task, update it before you finish one. The rules for
doing that live in [AGENTS.md](./AGENTS.md#the-checklist-protocol).

Tags: `P0` broken or blocking · `P1` high value · `P2` worth doing · `P3` nice to have
Areas: `ui` · `editor` · `runtime` · `lang` · `viz` · `library` · `saves` · `rooms` · `board` · `platform`

---

## In progress

_Nothing in flight._

---

## P0 — defects

_Nothing known._

---

## P1 — next up

- [ ] `viz` **Auto-pick a topic view for user code** — detect arrays, grids, linked lists and trees in the trace and render the matching 3D topic view in the lab instead of only heap cards. _L_
- [ ] `editor` **Surface run errors on the line that caused them** — the translators already return `{ line, message }`; pin it under the editor and mark the gutter. _S_
- [ ] `lang` **JavaScript: array methods + arrow functions + template literals** — `sort`, `reverse`, `join`, `slice` desugared to loops first, then `map/filter/reduce`, then `=>` and backticks. _M_
- [ ] `lang` **Python quality-of-life set** — f-strings, `sorted/sum/min/max/abs`, slicing, list comprehensions, then dicts/sets. _M_
- [ ] `library` **Language switch in the library** — every topic ships Java only; add Python/JS/C++ sources and reuse the translators. _M_

## P2 — improvements

- [ ] `editor` Inline "what this visualizer runs" reference generated from the interpreter/translator tables. _S_
- [ ] `editor` Find & replace in the code editor (`Ctrl/Cmd + F`). _M_
- [ ] `editor` Bracket matching and auto-indent on Enter. _S_
- [ ] `runtime` Expected-vs-actual output diff for a program with known output. _M_
- [ ] `runtime` Permalink to a specific trace step. _M_
- [ ] `runtime` Saved run history per program. _M_
- [ ] `runtime` Per-step cost hint (comparisons/swaps/writes). _S_
- [ ] `viz` "Reset camera" control on every 3D pane. _S_
- [ ] `viz` Keyboard access to blocks (Tab through them, Enter to inspect). _M_
- [ ] `library` Copy a topic's program into the lab in one click. _S_
- [ ] `library` Side-by-side algorithm comparison for one topic. _L_
- [ ] `library` Explain a topic's complexity, not just tag it. _S_
- [ ] `saves` Folders or tags for saved programs. _M_
- [ ] `saves` Export a save as a real file (`Solution.java`, `solution.py`, …). _S_
- [ ] `saves` Version history and a diff between revisions. _L_
- [ ] `rooms` Push updates instead of polling. _M_
- [ ] `rooms` Shared playback position (follow the host's step). _M_
- [ ] `rooms` Cursor/selection presence. _M_
- [ ] `rooms` In-room chat. _M_
- [ ] `board` Import a saved program as a text node. _S_
- [ ] `lang` C++: `std::sort/min/max/swap`, then `pair`, `vector<string>`, `map`/`set`. _M_
- [ ] `lang` Java: widen whitelisted `String`, `Stream`, `Optional` and `Comparator` methods. _M_
- [ ] `platform` `aria-live` announcements for new console output. _S_
- [ ] `platform` Visible focus rings across every control. _S_
- [ ] `platform` Offline read-only mode (service worker) for the library. _L_

## P3 — nice to have

- [ ] `lang` Python classes and `enumerate`/`zip`.
- [ ] `lang` C++ STL containers (`queue`, `stack`, `priority_queue`) once the tracer can show them.
- [ ] `ui` Command palette (`Ctrl/Cmd + K`) over modes, topics and saved programs.
- [ ] `ui` Split-view: two topics side by side.
- [ ] `saves` Public share link for a saved program.
- [ ] `board` Link a whiteboard region to a topic/view.
- [ ] `platform` Full keyboard navigable 3D scene with reduced-motion camera.

---

## Done

Newest first. Keep the commit hash — it is how the next agent verifies the claim.

- [x] `ui` **Mobile section navigation moved to a fixed bottom bar** — `Code / Library / Whiteboard` pins to the bottom below 760 px, with the pane area padded so nothing hides under it. `8940a11`
- [x] `saves` **Saved-codes search box was stretching** — `.drawer-input` has `flex: 1`, so the search field grew to fill the drawer; it is now `flex: 0 0 auto` at 34 px (measured 34 px in the drawer). `8940a11`
- [x] `ui` **Help sheet ignored the light theme** — replaced a hardcoded `--bg` fallback with `var(--card)`, and themed the `kbd` chips. `f9177f5`
- [x] `ui` **Matrices had a black backing plane** — the fixed navy plate is now a theme `plate` colour from `STAGE`. `f9177f5`
- [x] `ui` **Section nav aligned right** beside the account cluster instead of floating after the brand. `f9177f5`
- [x] `ui` **Run-to-breakpoint had no key** — bound `Shift + →` and corrected the shortcuts sheet (the `⏭` emoji row). `f9177f5`
- [x] `ui` **Library action buttons no longer stretch** across the toolbar. `f9177f5`
- [x] `ui` **Header rebuilt** — segmented section control, phone hamburger for appearance/help/rooms, brand logo. `9cda443`
- [x] `ui` **Logo + favicon** (`public/logo.svg`). `9cda443`
- [x] `library` **Toolbar no longer duplicates the inspector blurb**; controls align on one row. `9cda443`
- [x] `platform` **Keyboard-first lab** — shortcut sheet (`?`), per-pane error boundaries, reduced motion, console copy + resize, bundle splitting. `48a69b1`
- [x] `runtime` **Trace JSON export** and per-step kind hint. `2f3434e`

---

## How an item is closed

1. Do the work on a branch or directly on `main`.
2. Verify: `npx tsc --noEmit -p tsconfig.json` and `npm run build` must both pass; for UI work, look at the pane in the browser in **both** themes at desktop **and** phone width.
3. Move the item to **Done** with the date and commit hash, and write one line on what actually shipped.
4. If the work revealed new gaps, add them as new items — never leave them in a chat message.
5. If an item turned out to be wrong or out of scope, add a note instead of deleting it.
