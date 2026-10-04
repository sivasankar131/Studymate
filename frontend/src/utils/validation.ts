import { MAX_UPLOAD_MB, SUPPORTED_EXTENSIONS } from './env';
import { fileExt } from './format';

export interface FileValidationResult {
  valid: boolean;
  error?: string;
}

/** Validate a file against supported types and size limits */
export function validateFile(file: File): FileValidationResult {
  const ext = fileExt(file.name) as (typeof SUPPORTED_EXTENSIONS)[number];

  if (!SUPPORTED_EXTENSIONS.includes(ext as '.pdf' | '.txt')) {
    return {
      valid: false,
      error: `"${ext || 'unknown'}" files are not supported. Please upload PDF or TXT files.`,
    };
  }

  const maxBytes = MAX_UPLOAD_MB * 1024 * 1024;
  if (file.size > maxBytes) {
    return {
      valid: false,
      error: `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum allowed size is ${MAX_UPLOAD_MB} MB.`,
    };
  }

  if (file.size === 0) {
    return { valid: false, error: 'The file is empty.' };
  }

  return { valid: true };
}

/** Return true if question is non-empty after trimming */
export function validateQuestion(question: string): boolean {
  return question.trim().length > 0;
}
