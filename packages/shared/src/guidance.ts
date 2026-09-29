/**
 * Digest of the official X Community Notes guidance. Used by the backend prompts and
 * shown in the extension so users know what X considers a helpful note.
 *
 * Source: https://communitynotes.x.com/guide/en/contributing/examples (open-source copy:
 * https://github.com/twitter/communitynotes/blob/main/documentation/contributing/examples.md)
 */
export const COMMUNITY_NOTES_GUIDE_URL = "https://communitynotes.x.com/guide/en/contributing/examples";
export const COMMUNITY_NOTES_HUB_URL = "https://x.com/i/communitynotes";

/** Verbatim attribute lists from the official guide. */
export const HELPFUL_NOTE_ATTRIBUTES = [
  "Cites high-quality sources",
  "Easy to understand",
  "Directly addresses the post’s claim",
  "Provides important context",
  "Neutral or unbiased language",
] as const;

export const UNHELPFUL_NOTE_ATTRIBUTES = [
  "Sources not included or unreliable",
  "Sources do not support note",
  "Incorrect information",
  "Opinion or speculation",
  "Typos or unclear language",
  "Misses key points or irrelevant",
  "Argumentative or biased language",
  "Note not needed on this post",
  "Harassment or abuse",
] as const;

/**
 * How the X workflows are reached (from the official guide):
 * - Write a note: ••• menu on the post → "Write a Community Note" (contributors who unlocked writing).
 * - Request a note: ••• menu on the post → "Request Community Note" (needs a verified phone number,
 *   initially up to 5 requests per day).
 * Kavannah only opens/points at these menus; it never submits anything.
 */
export const X_MENU_ITEMS = {
  write: "Write a Community Note",
  request: "Request Community Note",
} as const;
