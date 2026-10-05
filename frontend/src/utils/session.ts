/**
 * Chat session ID utilities.
 *
 * session_id   – identifies one conversation thread within a browser workspace.
 *               Stored in localStorage so it persists across page refreshes
 *               and tab close/reopen (same browser = same conversation).
 *
 * client_id    – identifies the browser workspace (see utils/client.ts).
 *               The backend filters all data by client_id, not session_id.
 *
 * Relationship:
 *   One client_id can have many session_ids (one per conversation thread).
 *   The backend stores (client_id, session_id) on every Message row.
 */

const SESSION_KEY = 'studymate_session_id';

/**
 * Returns a stable conversation session ID for this browser.
 * Persists in localStorage — survives tab close and page refresh.
 * A different browser has a different client_id AND a different session_id.
 */
export function getOrCreateSessionId(): string {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    // 32 hex chars — matches backend String(64) constraint comfortably
    id = crypto.randomUUID().replace(/-/g, '');
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

/**
 * Generate a new session ID (called when the user clears the conversation).
 * The old conversation remains in the DB under the old session_id but the
 * UI starts fresh.
 */
export function rotateSessionId(): string {
  const id = crypto.randomUUID().replace(/-/g, '');
  localStorage.setItem(SESSION_KEY, id);
  return id;
}
