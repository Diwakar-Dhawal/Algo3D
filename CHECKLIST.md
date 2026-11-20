# Algo3D — work checklist

The single source of truth for what is planned, in progress and shipped.
Read it before starting any task, update it before you finish one. The rules for
doing that live in [AGENTS.md](./AGENTS.md#the-checklist-protocol).

Tags: `P0` broken or blocking · `P1` high value · `P2` worth doing · `P3` nice to have
Areas: `ui` · `editor` · `runtime` · `lang` · `viz` · `library` · `saves` · `rooms` · `board` · `platform`

---

## In progress

_(nothing right now)_

---

## P0 — defects

_(none open)_

---

## P1 — next up

- [ ] `library` **Topic and board in the URL** — the lab is addressable (`?sample=&step=`) but `?mode=library` still opens the default topic and a board has no id in the address, so “open this exact matrix” does not work yet. _S_
- [ ] `lang` **Wire the other modes onto the stdin buffer** — Python `input()`, C++ `cin >>`, JS `readline()` can all map onto `src/lang/stdin.ts` (the Java side already reads it); needs translator support plus showing the input box for those modes. _M_
- [ ] `rooms` **Sync the standard-input buffer into rooms** — `RoomState` carries code and inputs only, so a joiner keeps their own stdin text. _S_
- [ ] `viz` **Auto-pick a topic view for user code** — detect arrays, grids, linked lists and trees in the trace and render the matching 3D topic view in the lab instead of only heap cards. _L_
- [ ] `lang` **JavaScript: array methods + arrow functions + template literals** — `sort`, `reverse`, `join`, `slice` desugared to loops first, then `map/filter/reduce`, then `=>` and backticks. _M_
- [ ] `lang` **Python quality-of-life set** — f-strings, `sorted/sum/min/max/abs`, slicing, list comprehensions, then dicts/sets. _M_
- [ ] `library` **Language switch in the library** — every topic ships Java only; add Python/JS/C++ sources and reuse the translators. _M_

## P2 — improvements

- [ ] `editor` Inline "what this visualizer runs" reference generated from the interpreter/translator tables. _S_ — surface the same table from the Help sheet (“What can this run?”), since that is where people ask it.
- [ ] `editor` Find & replace in the code editor (`Ctrl/Cmd + F`). _M_
- [ ] `editor` Bracket matching and auto-indent on Enter. _S_
- [ ] `runtime` Expected-vs-actual output diff for a program with known output. _M_
- [ ] `runtime` Saved run history per program. _M_
- [ ] `runtime` Per-step cost hint (comparisons/swaps/writes). _S_
- [ ] `viz` "Reset camera" control on every 3D pane. _S_
- [ ] `viz` Keyboard access to blocks (Tab through them, Enter to inspect). _M_
- [ ] `library` Copy a topic's program into the lab in one click. _S_
- [ ] `library` Side-by-side algorithm comparison for one topic. _L_
- [ ] `library` Explain a topic's complexity, not just tag it. _S_
- [ ] `saves` **Bring device saves into the account on sign-in** — programs saved while signed out stay in the browser; there is no upload or merge step. _S_
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

- [ ] `ui` **Command palette (`Ctrl/Cmd + K`)** over modes, all 7 topics, samples, saved programs, theme and Run — promoted from P3 because seven topics plus nine samples is already past what a dropdown should hold, and the phone header is a menu. _M_
- [ ] `ui` **Breadcrumb under the mode tabs** (`Library › Sorting › Bubble sort`) — phones show one pane at a time, so the highlighted tab is the only cue to where you are. _S_
- [ ] `ui` **Keep each pane's state when switching** — scroll position, 3D camera and inspector tab survive a Code/Visual/Panels round trip. _S_
- [ ] `ui` **“Continue where you left off” card** — surface the existing `algo3d.lab.v2` autosave instead of asking people to remember. _S_
- [ ] `runtime` **“Predict the next step” practice mode** — show the array at step N, ask what changes or what prints, then reveal. The one retention loop VisuAlgo and Python Tutor do not have. _L_
- [ ] `platform` **Instrument the basic funnel** (open → sample picked → Run → step 10 → signed in); there is no measurement today, so “where people leave” is a guess. _S_
- [ ] `platform` **Embed a topic at a step** (`<iframe>`) — how a teacher adopts a tool and brings a class. _M_

## P3 — nice to have

- [ ] `lang` Python classes and `enumerate`/`zip`.
- [ ] `lang` C++ STL containers (`queue`, `stack`, `priority_queue`) once the tracer can show them.
- [ ] `ui` Split-view: two topics side by side.
- [ ] `saves` Public share link for a saved program.
- [ ] `board` Link a whiteboard region to a topic/view.
- [ ] `platform` Full keyboard navigable 3D scene with reduced-motion camera.

---

## Done

Newest first. Keep the commit hash — it is how the next agent verifies the claim.

- [x] `editor` **The shared code editor stopped rewinding itself** — the room adopt effect compared versions only, so the save it had just sent came back as “newer” content and was written into the buffer as of one round trip earlier: the caret landed at the end of the last saved line and the trace was rebuilt every few seconds. A tab that holds the typing lease no longer adopts its own echo (a takeover hands the lease over and is adopted normally), identical source is no longer rewritten at all, and the shared playhead is followed on its own. Room poll 1500 → 900 ms and keystroke push debounce 450 → 250 ms, so a joiner sees typing about a second after the editor pauses instead of a few. Verified with `tsc` + `build`; the two-tab room check was not run from here (the room flow needs a signed-in account). _2026-11-20 · `dd1ae3e`_
- [x] `board` **Shared whiteboard no longer wipes when the owner pauses** — the drawing and its version now travel as one value in `useRoomBoard`, so the save response can no longer bump the version while the surface still holds the previous poll’s elements (that pairing was the wipe: the version changed, the surface re-applied the older scene, and it did so again on every save). `BoardSurface` also merges an incoming scene newest-wins into what is on screen instead of replacing it, so a poll can add, move or delete shapes but never remove an unsaved stroke, and the 350 ms “ignore while applying” window that swallowed a stroke drawn right after a remote update is gone (echoes are filtered by scene identity instead). Board push debounce 650 → 300 ms, poll 2200 → 1000 ms. The private board path is untouched. Verified with `tsc` + `build`; the two-tab owner/joinee check was not run from here (rooms need a signed-in account). _2026-11-20 · `dd1ae3e`_
- [x] `ui` **Sample gallery** — the sample dropdown is now a card dialog with a three-line code preview and a “reads console input” badge; picking a card loads the program, traces it and lands on step 1, so the scene exists before the first keystroke. _2026-11-20 · `827609c`_
- [x] `runtime` **Copy the current step as an image** — composes the 3D stage with the step note, line and file into a 1200 px PNG on the clipboard, falling back to a download (with a 1.5 s deadline so a hung permission prompt cannot wedge the button); `preserveDrawingBuffer` is now on the shared canvas. Verified: 51 KB `image/png` clipboard item, note confirmed. _2026-11-20 · `827609c`_
- [x] `ui` **Guest-first saves** — a signed-out visitor keeps up to 20 programs in `algo3d:saves.v1`, badged “this device”, with the device-only warning in both the drawer and the save popover; star, rename and delete work locally. Signing in still does not migrate them (see P2). _2026-11-20 · `827609c`_
- [x] `editor` **Run errors surface on their line** — the failing line is marked in the gutter and the highlight, and the message is pinned under the editor as well as in the console, so “broken app” reads as “my bug”. _2026-11-20 · `827609c`_
- [x] `platform` **Addressable lab state + step links** — `?sample=` and `?step=` (plus `?lang=` when it is not the default) follow a debounced `replaceState`, a playbar link button copies the current step, and section changes push history so Back walks the sections you visited. This also closes the old “permalink to a step” item. _2026-11-20 · `827609c`_
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
