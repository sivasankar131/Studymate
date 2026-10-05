/**
 * Browser-level identity for StudyMate data isolation.
 *
 * Design:
 *  - Stored in localStorage so it survives tab close, refresh, and
 *    browser restart — the same browser always gets the same workspace.
 *  - Different browsers (Firefox vs Chrome) each generate their own UUID
 *    and therefore see completely separate data.
 *  - Same-browser tabs share the same localStorage key, so they share
 *    the same workspace (expected behaviour).
 *  - Uses crypto.randomUUID() (supported in all modern browsers).
 *    Falls back to a manual UUID v4 generator if unavailable.
 *
 * The returned value is a lower-case UUID v4 WITH hyphens, e.g.:
 *   "550e8400-e29b-41d4-a716-446655440000"
 * The backend's get_client_id() dependency strips hyphens and lowercases,
 * so the format is normalised server-side.
 */

const CLIENT_ID_KEY = 'studymate_client_id';

/** Generate a UUID v4 without requiring crypto.randomUUID(). */
function uuidv4Fallback(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return uuidv4Fallback();
}

/**
 * Returns the stable browser identity UUID.
 * Creates and persists one the first time it is called in this browser.
 * Never returns a different value on the same browser after first call.
 */
export function getClientId(): string {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = generateUUID();
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

/**
 * For testing: wipe the current identity and generate a fresh one.
 * Simulates opening the app in a new browser.
 * Only call this deliberately — it permanently loses access to existing data.
 */
export function resetClientId(): string {
  const id = generateUUID();
  localStorage.setItem(CLIENT_ID_KEY, id);
  return id;
}
