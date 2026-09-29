/** Build-time variables (WXT exposes WXT_* and VITE_* prefixed variables on import.meta.env). */
interface ImportMetaEnv {
  /** Default backend URL baked into the build; see lib/settings.ts. */
  readonly WXT_BACKEND_URL?: string;
}
