import { v4 as uuidv4 } from 'uuid';

const SESSION_KEY = 'studymate_session_id';

/**
 * Returns a stable session-id for the current browser session.
 * Persisted in sessionStorage so it survives page refreshes but
 * resets when the tab is closed.
 */
export function getOrCreateSessionId(): string {
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = uuidv4().replace(/-/g, '').slice(0, 32); // 32-char hex, matches backend String(64)
    sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

/** Force a new session (called when the user clears the conversation) */
export function rotateSessionId(): string {
  const id = uuidv4().replace(/-/g, '').slice(0, 32);
  sessionStorage.setItem(SESSION_KEY, id);
  return id;
}
