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

- [ ] `lang` **Wire the other modes onto the stdin buffer** — Python `input()`, C++ `cin >>`, JS `readline()` can all map onto `src/lang/stdin.ts` (the Java side already reads it); needs translator support plus showing the input box for those modes. _M_
- [ ] `rooms` **Sync the standard-input buffer into rooms** — `RoomState` carries code and inputs only, so a joiner keeps their own stdin text. _S_
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
- [ ] `lang` **Java: numeric printing parity** — `double`/`float` use JavaScript's number formatting, so `1e10` prints `10000000000` instead of `1.0E10` and `-0.0`/`NaN`/`Infinity` are wrong. Needs Java's `Double.toString` rules in `str()`. _S_
- [ ] `lang` **Java: library tail** — `Collections.shuffle`, `BigInteger`, `Scanner.useDelimiter`, enum constructors/fields, `String.formatted`/`indent`, `Stream.summarizingInt`. _M_
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

- [x] `lang` **Java library parity** — a 66-program capability probe (String, StringBuilder, Arrays, Collections, List, Map/Set, streams, Optional, Comparator, Math, Integer, Character, Objects, plus language features) failed 35 times; it now passes 66/66. Fixed wrong answers as well as missing methods: `indexOf`/`lastIndexOf` ignored their from-index, `replaceAll` was a literal replace, `split` dropped Java's limit tail, `compareTo` returned a sign instead of the char difference, `Arrays.sort/fill` ignored range overloads, `List.remove(Object)` removed by index, `Comparator.naturalOrder()` sorted nothing, `String.valueOf(char[])` printed an object ref, and `double`-returning methods printed `9`. Added `subList`/`toArray`/`subList`, TreeMap/TreeSet navigation, `Optional.ofNullable/map/filter/or`, `Math.signum/hypot/atan2`, `Character.isWhitespace` and friends, `Objects.isNull`, enum-declared methods, and classes extending built-in exceptions. Parser: bitwise/shift operators, `~`, labelled loops, generic methods, `final` locals, `String[]::new`, `instanceof` with an interface. 15 of them are pinned in `npm run verify`. `ae56b97`

- [x] `lang` **Standard input for Java** — `Scanner` now works through a shared `Stdin` buffer (`next`, `nextLine`, `nextInt`, `nextLong`, `nextDouble`, `nextBoolean`, `hasNext*`, `close`), a standard-input box in the Inputs panel, a preloaded “Console input” sample, and four new checks in `npm run verify`. `4b27af7`
- [x] `ui` **Rooms step in the tour** — step 10 spotlights the Rooms button, falling back to the ☰ menu on phones and the sign-in button when signed out; targets are now chosen in priority order, not DOM order. `2d9d6e3`
- [x] `ui` **Tour highlights on phones** — each step now asks the lab for the pane it describes (`algo3d:show-pane`), the help step falls back to the ☰ button, and every step names its section so Back from the library/board returns to the lab. All ten steps confirmed spotlit at 390 px. `792c52d`
- [x] `ui` **First-run tour** — ten spotlit steps across the header, editor, saved codes, run, playback, inspector, library and board; opens once per browser (`algo3d:tour`), reachable again from “Replay the tour” in the shortcut sheet. Mobile: the card falls back to a centred card when the target pane is hidden. `a0b8810`

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
