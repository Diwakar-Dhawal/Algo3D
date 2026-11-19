/**
 * Room roles and what each one may do.
 *
 * The table itself lives in `api/rooms/_roles.ts`: Vercel compiles each file in
 * `api/` separately, so the room functions must not import from `src/`. This
 * module re-exports it, which keeps one definition while letting the browser
 * keep importing `./roles`.
 */

export * from '../../api/rooms/_roles';
