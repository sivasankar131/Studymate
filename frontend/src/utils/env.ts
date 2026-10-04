/**
 * Central place to read Vite env vars.
 * Using a function (not a top-level const) avoids issues when the module
 * is imported before Vite has injected the replacements (e.g., in tests).
 */
export function getApiBase(): string {
  return (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://127.0.0.1:8000';
}

/** Maximum upload size the backend accepts (kept in sync with backend MAX_UPLOAD_MB = 10) */
export const MAX_UPLOAD_MB = 10;

/** File types the backend actually supports */
export const SUPPORTED_EXTENSIONS = ['.pdf', '.txt'] as const;
export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number];

export const SUPPORTED_MIME_TYPES: Record<SupportedExtension, string> = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
};

/** Human-readable label used in the upload UI */
export const SUPPORTED_LABEL = 'PDF, TXT';
