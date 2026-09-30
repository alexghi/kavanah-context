import { z } from "zod";
import { DEFAULT_BACKEND_URL } from "./api";

/** User settings stored in browser.storage.local by the extension. */
export const SettingsSchema = z.object({
  backendUrl: z.string().default(DEFAULT_BACKEND_URL),
  /** Per-person access key for a hosted server (sent as a Bearer token). Empty for an open local server. */
  accessKey: z.string().default(""),
  /** Ask the backend to answer from demo fixtures instead of calling the model */
  mockMode: z.boolean().default(false),
  /** Preferred source domains, e.g. ["lemonde.fr", "ihra.org"]. Influence only, never override evidence. */
  trustedDomains: z.array(z.string()).default([]),
  language: z.string().optional(),
  /**
   * After filling X's "Request Community Note" form with the drafted note, also press X's
   * "Agree & Request a note" button. Off by default: the user reviews and sends the request.
   */
  autoSendCommunityNote: z.boolean().default(false),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});
