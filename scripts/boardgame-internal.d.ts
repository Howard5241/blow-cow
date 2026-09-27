/**
 * Types for the deep import in `check-blowcow-bots.ts`.
 *
 * `boardgame.io/internal` resolves to a directory with its own `package.json`, which Node's ESM
 * loader refuses (`ERR_UNSUPPORTED_DIR_IMPORT`), so the check imports the built file directly. That
 * path has no typings of its own, but the directory entry point names them — so they are pointed at
 * here rather than the module being left as `any`.
 */
declare module 'boardgame.io/dist/esm/internal.js' {
  export * from 'boardgame.io/internal'
}
