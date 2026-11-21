# Algo3D

**A code visualiser for data structures and algorithms — in three dimensions.**

Write Java, Python, JavaScript or C++, press Run, and walk through every step of the program while
the data structure it touches is drawn as a physical thing: arrays as stacked tiles, a stack as a
tower of plates, a tree as branches, a graph as a floating network. Click any element to inspect it.
Scrub back and forth. Share the exact step you are looking at with a link.

Live at **[algo3-d.vercel.app](https://algo3-d.vercel.app/)** — free, in the browser, nothing to install.

---

## Highlights

- **Seven hand-built 3D visual worlds** — arrays and sorting, matrices, stacks, queues, linked lists,
  binary search trees and graphs, each with its own scene, camera and controls.
- **Four input languages.** Java runs directly on the tracer; Python, JavaScript and C++ are translated
  to Java first, so all four share one engine, one step log and one set of visuals.
- **A real step model.** Every run is a list of states with a line number and a plain-English note, so
  you can step forward, step back, jump to a breakpoint, or replay from the start.
- **Memory, not just output.** Heap objects, references and frames are rendered for arbitrary user
  programs, so "what does this variable point at" becomes something you can see.
- **Save, tag and filter your programs.** Twelve subject tags plus your own, filters with live counts,
  and a search box that matches tags as well as titles.
- **Live rooms.** Share a room link and work in the same program, board and playhead together, with
  owner/editor/viewer roles, presence, and a room list that tells you which rooms are live, idle or
  closed.
- **A whiteboard beside the code.** An Excalidraw canvas that travels with the room, so a lesson, a
  sketch or an interview explanation lives next to the program it is about.
- **Warm, quiet design in two themes.** Paper and gold in the light, ink and brass in the dark, with
  contrast-checked tokens and a layout that collapses gracefully from three panes to one on a phone.

---

## The visual library

| Topic | What it draws | Complexity badge |
|---|---|---|
| **Arrays & Sorting** | Contiguous `int[]` slots; index pointers move, pairs compare, values swap in place. Bubble, selection, insertion, linear search and binary search. | `O(n²) · O(log n)` |
| **Matrices** | A 2D `int[][]` grid in 3D — a ring-by-ring spiral read, or in-place row/column mirroring during a transpose. | `O(rows × cols)` |
| **Stack (LIFO)** | A tower of plates. Push and pop only ever touch the top. | `O(1) push / pop` |
| **Queue (FIFO)** | A row of slots with head and tail pointers; enqueue at the rear, dequeue at the front. | `O(1) enqueue · O(n) dequeue` |
| **Linked List** | Nodes scattered in memory, chained by `next` pointers; insert, delete and traverse as `cur` hops. | `O(1) head · O(n) tail` |
| **Binary Search Tree** | Recursive structure in 3D: insertion walks the comparison path, in-order traversal visits everything sorted. | `O(log n) balanced` |
| **Graphs** | An undirected adjacency-list graph floating in space; the frontier grows and edges light up as BFS and DFS run. | `BFS / DFS · O(V + E)` |

Open any topic directly with a link: `/?topic=graph&step=12` restores both the topic and the step.

---

## Bring your own program

Paste code into the Code tab and press **Run**. Pick your language, keep your work in the editor, and
the same playhead, step log and memory view drive it either way.

| Language | Runs as | Covers |
|---|---|---|
| **Java** | Parsed and executed directly by the in-app JVM | arrays, `List`, `Map`, `Set`, lambdas, streams, your own classes, recursion, and `Scanner` standard input |
| **Python** | Translated to Java, then traced | `def` functions, lists, `for range(...)`, `print()` |
| **JavaScript** | Translated to Java, then traced | `function`, arrays, `push`/`pop`, `for`/`while`, `console.log` |
| **C++** | Translated to Java, then traced | functions, structs, `vector<int>`, `cout` |

The accepted subset for each language is shown right under the editor, so what you paste is never a
guess, and translator errors carry your own line numbers.

### The editor and the playhead

- Syntax-highlighted editor with auto-indent and smart brace handling.
- **Language-aware hints** under the editor for every supported construct.
- **Breakpoints** — marked in the gutter, toggled with <kbd>B</kbd>, and reachable in one keystroke with
  <kbd>Shift</kbd> + <kbd>→</kbd>.
- **Step log** with one plain-English line per step, announced to screen readers as it moves.
- **Playback** with variable speed, plus a scrubber for the whole run.
- **Memory view** for frames, heap objects and references.

### Keyboard

| Keys | Action |
|---|---|
| <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>Enter</kbd> | Run the program |
| <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>S</kbd> | Save (opens the quick-save panel) |
| <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>/</kbd> | Toggle a line comment |
| <kbd>Space</kbd> | Play / pause |
| <kbd>←</kbd> / <kbd>→</kbd> | Previous / next step |
| <kbd>Shift</kbd> + <kbd>→</kbd> | Run to the next breakpoint |
| <kbd>B</kbd> | Toggle a breakpoint on the current line |
| <kbd>Home</kbd> / <kbd>End</kbd> | First / last step |
| <kbd>?</kbd> | Shortcut sheet |

---

## Saved programs

Every save keeps a title, a description, the source, the language, the inputs and its tags, so
reopening a program puts you back where you were.

- **Tags** for filtering — arrays, sorting, matrix, stack, queue, linked-list, tree, graph, recursion,
  search, dynamic-programming, strings — plus a field for your own. Tags are normalised on the client
  and the server alike, so `Arrays`, `arrays` and `arrays!` are one tag everywhere.
- **Filter row** with a live count per tag, and a search box that also matches tag text.
- **Edit after saving** — titles, notes and tags are all editable from the drawer.
- **Export as a source file** — a save downloads as a properly named `.java`, `.py`, `.js` or `.cpp` file.
- **Works signed out.** Saves land in the browser instantly; sign in with Clerk and the same drawer
  serves your account library.

---

## Live rooms

A room is a program, a board and a playhead that several people share.

| Role | Can do |
|---|---|
| **Owner** | Everything: code, board, running, driving the trace, invites, roles, renaming and deleting the room. |
| **Editor** | Edit code and board, run, and drive the trace. |
| **Viewer** | Watch the shared step and read the code. |

- **Invite links** for collaborators, with an invite code in the URL.
- **Presence and live state** over a WebSocket when the local socket server is running, with polling as
  an always-available path.
- **Room list** with coloured status tags — *live* (someone is online), *open* (nobody there yet, still
  usable), *closed* (idle long enough to be swept) — sorted live first, with filter chips and counts.
- **Tidy by design:** a room nobody has touched for twenty minutes is marked closed rather than deleted,
  so its work is still there when someone opens it again.
- **Act from the list:** delete a room you own or leave one you joined, without opening it first.

---

## Design system

- **Paper and gold.** A single palette with light and dark variants, owned by the theme tokens in CSS and
  by `STAGE` in the 3D layer, so a scene never drifts from the interface around it.
- **Readable by construction.** Dark mode lifts ink rather than dimming the paper, and text is set
  against the surface it actually sits on.
- **Accessible basics throughout:** visible focus rings everywhere, `aria-live` on the step log,
  screen-reader-only labels, keyboard-operable playhead and panes.
- **Two layouts, no dead ends:** a three-pane desktop grid that folds to one pane at a time on smaller
  screens, and a pinned section bar on phones. Typed input stays at 16px so iOS never zooms.
- **Motion that informs:** tiles lift, edges pulse, pointers slide — all timed to the step you are on and
  to the playback speed you chose.

---

## Built with

| Layer | Choice |
|---|---|
| UI | React 18, TypeScript 5, Vite 5 |
| 3D | three.js with `@react-three/fiber` and `drei` |
| Editor | A purpose-built highlighted editor, no heavy dependency |
| Board | Excalidraw |
| Auth | Clerk |
| Database | Neon Postgres (serverless driver) |
| API | Vercel Node functions under `api/` |
| Realtime | A shared step bus plus a local WebSocket bridge |

---

## Run it locally

```bash
git clone https://github.com/Diwakar-Dhawal/Algo3D.git
cd Algo3D
npm install
cp .env.example .env.local     # fill in the values below
npm run db:push                # create the schema
npm run dev                    # http://localhost:5173
```

The interface runs on its own — the library, the tracer, saving to the device and the board all work
without any server. Accounts and shared rooms need the API:

```bash
npm run dev:api                # http://localhost:3000 (restart it after editing api/)
```

### Environment

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | server | Neon connection string for saves, rooms and activity |
| `VITE_CLERK_PUBLISHABLE_KEY` | browser | Clerk publishable key (public by design) |
| `CLERK_SECRET_KEY` | server | verifies session tokens |
| `APP_ORIGIN` | server | the production origin session tokens must be minted for |

The publishable key is also served at runtime by `/api/config`, so a deploy only needs it in the server
environment — changing it never requires a rebuild.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on :5173 |
| `npm run dev:api` | API + socket server on :3000 |
| `npm run build` | Type-check the whole project, then build for production |
| `npm run preview` | Serve the production build |
| `npm run verify` | Headless checks over the tracer and every translator |
| `npm run api:smoke` | Auth boundary, signed-in flows and the full room lifecycle — no token needed |
| `npm run ws:check` | The socket's refusals: bad token, wrong path, unauthenticated join |
| `npm run db:push` | Apply `db/schema.sql` to the database |

`api:smoke` runs the signed-in half against a disposable test identity, so it needs nothing typed by
hand and cleans up after itself; setting `CLERK_TEST_TOKEN` runs the same checks as a real session.

---

## API

| Route | Methods | Notes |
|---|---|---|
| `/api/config` | GET | Public runtime configuration |
| `/api/auth/me` | GET | The signed-in user and their stats |
| `/api/saves` | GET, POST | List (with search/tag filters) and create |
| `/api/saves/:id` | GET, PATCH, DELETE | Read, edit (including tags), remove |
| `/api/rooms` | GET, POST | List with roles and status, create |
| `/api/rooms/:id` | GET, PATCH, DELETE | Read, rename / leave / roles, delete |
| `/api/rooms/:id/state` | GET, PUT | Shared code, inputs and playhead |
| `/api/rooms/:id/board` | GET, PUT | The shared whiteboard |
| `/api/rooms/join` | POST | Join with an invite code |
| `/api/activity` | POST | Record a run, feed the streak |
| `/api/seo`, `/robots.txt`, `/sitemap.xml` | GET | Search-engine surface |

Every mutation is authorised on the server: the role is read from the membership row, never from what
the browser claims.

---

## Project layout

```
src/
  jvm/        Java parser + tracer (the engine every language ends up in)
  lang/       Python, JavaScript and C++ translators, language table, stdin reader
  topics/     Seven 3D worlds: build(params) → { java, steps }, View, Controls
  three/      Shared stage: canvas, lights, grid, theme, animation
  memory/     Frames, heap objects and references for user programs
  components/ Editor, step log, panes, resizable panels
  auth/       Clerk wiring, the saved-codes drawer, tags
  rooms/       Room state, roles, presence, socket client, room drawer
  board/      Excalidraw canvas
  saves/      Tag rules and the device library
api/          Vercel functions: saves, rooms, activity, config, seo
db/           schema.sql
scripts/      Dev API, smoke suites, socket checks, schema push
```

---

## Deploy

1. **Neon** → create a database, copy the connection string.
2. **Clerk** → create an application, copy the publishable and secret keys.
3. **Vercel** → import the repository, set the environment variables above, deploy.
4. **Schema** → run `npm run db:push` once against the production database.
5. **Realtime** (optional) → run `scripts/ws-server.ts` on a host that supports WebSockets; the app
   polls reliably without it.

The deployment is search-ready out of the box: `robots.txt`, a sitemap generated from the request's own
host, canonical URLs, Open Graph and Twitter cards, `WebSite` and `SoftwareApplication` structured data,
and a site-verification file in `public/`.

---

## Search presence

The site is verified in Google Search Console, its sitemap is submitted, and the homepage carries the
structured data Google uses to print **Algo3D** as the site name. Every page ships a description built
from the languages it accepts and the structures it draws, and the app's own headings and step log are
readable in the rendered document.

---

## Credits

Built with [React](https://react.dev), [three.js](https://threejs.org), [Excalidraw](https://excalidraw.com),
[Clerk](https://clerk.com), [Neon](https://neon.tech) and [Vercel](https://vercel.com). The tracer, the
translators and all seven visual worlds are written for this project.

**Algo3D** — see the algorithm, not just the answer.
