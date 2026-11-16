/**
 * A tab opened before a deploy still runs the old bundle; its lazy chunks were
 * replaced by the new build, so importing one fails (nginx answers the missing
 * file with an HTML 404). Reload once to pick up the new version instead of
 * leaving a blank page. The guard prevents a reload loop if the chunk is
 * genuinely broken.
 */
const GUARD_KEY = "staleChunkReloadAt";
const GUARD_MS = 30_000;

let reloading = false;

export function reloadForNewVersion(): boolean {
  // Vite's preload hook and the lazy import both report the same failure.
  if (reloading) return true;
  try {
    const last = Number(sessionStorage.getItem(GUARD_KEY) ?? 0);
    if (Date.now() - last < GUARD_MS) return false;
    sessionStorage.setItem(GUARD_KEY, String(Date.now()));
  } catch {
    // No storage (private mode): still reload; a broken chunk would then loop,
    // which is no worse than the blank page.
  }
  reloading = true;
  window.location.reload();
  return true;
}

/** `import()` that reloads the page once when the chunk is gone after a deploy. */
export function importOrReload<T>(load: () => Promise<T>): () => Promise<T> {
  return () =>
    load().catch((err: unknown) => {
      // Keep the promise pending while the page reloads, so nothing renders an error.
      if (reloadForNewVersion()) return new Promise<T>(() => {});
      throw err;
    });
}
