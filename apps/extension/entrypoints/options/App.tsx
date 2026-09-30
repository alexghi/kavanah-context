import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, Eye, EyeOff, LoaderCircle, Plus, RotateCcw, TriangleAlert, X as XIcon } from "lucide-react";
import type { HealthResponse, Settings } from "@kavannah/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { client } from "@/lib/api";
import { BUILD_BACKEND_URL, getSettings, normalizeDomain, setSettings, watchSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";

type HealthState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "ok"; health: HealthResponse }
  | { status: "error"; message: string };

const LANGUAGE_SUGGESTIONS = ["en", "fr", "de", "es", "it", "nl", "pt", "he", "ar"];

const INPUT_CLASS =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

/** Accepts http(s) URLs only; strips a trailing slash. */
export function normalizeBackendUrl(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** One line describing the access-key situation reported by /api/health. */
export function describeAuth(auth: HealthResponse["auth"]): { text: string; problem: boolean } {
  if (!auth || !auth.required) return { text: "open server, no key needed", problem: false };
  if (auth.key === "valid") return { text: `access key accepted${auth.name ? ` (${auth.name})` : ""}`, problem: false };
  if (auth.key === "invalid") return { text: "access key rejected", problem: true };
  return { text: "access key required", problem: true };
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-foreground">
        {label}
      </label>
      {children}
      {hint && <p className="text-[12px] leading-5 text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function App() {
  const [settings, setLocal] = useState<Settings | null>(null);
  const [backendUrl, setBackendUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [accessKey, setAccessKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [domainInput, setDomainInput] = useState("");
  const [domainError, setDomainError] = useState<string | null>(null);
  const [language, setLanguage] = useState("");
  const [health, setHealth] = useState<HealthState>({ status: "idle" });
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const apply = (next: Settings) => {
      setLocal(next);
      setBackendUrl(next.backendUrl);
      setAccessKey(next.accessKey);
      setLanguage(next.language ?? "");
    };
    void getSettings().then((next) => {
      if (!cancelled) apply(next);
    });
    const unwatch = watchSettings(apply);
    return () => {
      cancelled = true;
      unwatch();
    };
  }, []);

  useEffect(() => {
    if (savedAt === null) return;
    const timer = setTimeout(() => setSavedAt(null), 1500);
    return () => clearTimeout(timer);
  }, [savedAt]);

  const save = async (patch: Partial<Settings>) => {
    const next = await setSettings(patch);
    setLocal(next);
    setSavedAt(Date.now());
  };

  const commitUrl = () => {
    const normalized = normalizeBackendUrl(backendUrl);
    if (!normalized) {
      setUrlError(`Enter a full URL such as ${BUILD_BACKEND_URL}`);
      return;
    }
    setUrlError(null);
    setBackendUrl(normalized);
    if (normalized !== settings?.backendUrl) void save({ backendUrl: normalized });
  };

  const commitKey = () => {
    const value = accessKey.trim();
    setAccessKey(value);
    if (value !== settings?.accessKey) void save({ accessKey: value });
  };

  const addDomain = () => {
    const domain = normalizeDomain(domainInput);
    if (!domain) {
      setDomainError("Enter a bare domain such as lemonde.fr");
      return;
    }
    setDomainError(null);
    setDomainInput("");
    if (!settings || settings.trustedDomains.includes(domain)) return;
    void save({ trustedDomains: [...settings.trustedDomains, domain] });
  };

  const removeDomain = (domain: string) => {
    if (!settings) return;
    void save({ trustedDomains: settings.trustedDomains.filter((d) => d !== domain) });
  };

  const commitLanguage = () => {
    const value = language.trim();
    if (value === (settings?.language ?? "")) return;
    void save({ language: value });
  };

  const testConnection = async () => {
    setHealth({ status: "testing" });
    const response = await client.health();
    setHealth(
      response.ok ? { status: "ok", health: response.data } : { status: "error", message: response.error.message },
    );
  };

  const onEnter = (action: () => void) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      action();
    }
  };

  if (!settings) {
    return (
      <div className="kavannah-root flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin" aria-label="Loading settings" />
      </div>
    );
  }

  const authStatus = health.status === "ok" ? describeAuth(health.health.auth) : null;

  return (
    <div className="kavannah-root min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-xl px-4 py-8 sm:px-6">
        <header className="mb-6 flex items-center gap-3">
          <span
            aria-hidden="true"
            className="inline-flex size-9 items-center justify-center rounded-lg bg-primary text-[19px] font-bold leading-none text-primary-foreground"
          >
            K
          </span>
          <div>
            <h1 className="text-[18px] font-semibold tracking-tight">Kavannah settings</h1>
            <p className="text-[12.5px] text-muted-foreground">Changes are saved automatically.</p>
          </div>
          <span
            aria-live="polite"
            className={cn(
              "ml-auto inline-flex items-center gap-1 text-[12px] font-medium text-positive-strong transition-opacity",
              savedAt === null ? "opacity-0" : "opacity-100",
            )}
          >
            <Check className="size-3.5" aria-hidden="true" />
            Saved
          </span>
        </header>

        <div className="space-y-4">
          <section className="space-y-4 rounded-lg border border-border bg-card p-4">
            <h2 className="section-label">Server</h2>
            <Field
              label="Backend URL"
              htmlFor="backend-url"
              hint={
                <>
                  The Kavannah server, local or hosted. Default: <code className="rounded bg-muted px-1">{BUILD_BACKEND_URL}</code>
                </>
              }
            >
              <div className="flex gap-2">
                <input
                  id="backend-url"
                  type="url"
                  inputMode="url"
                  className={cn(INPUT_CLASS, urlError && "border-critical")}
                  value={backendUrl}
                  aria-invalid={urlError ? true : undefined}
                  aria-describedby={urlError ? "backend-url-error" : undefined}
                  onChange={(event) => setBackendUrl(event.target.value)}
                  onBlur={commitUrl}
                  onKeyDown={onEnter(commitUrl)}
                  placeholder={BUILD_BACKEND_URL}
                  spellCheck={false}
                />
                <Button
                  variant="outline"
                  aria-label="Reset backend URL to default"
                  title="Reset to default"
                  onClick={() => {
                    setBackendUrl(BUILD_BACKEND_URL);
                    setUrlError(null);
                    void save({ backendUrl: BUILD_BACKEND_URL });
                  }}
                >
                  <RotateCcw aria-hidden="true" />
                </Button>
              </div>
              {urlError && (
                <p id="backend-url-error" className="text-[12px] font-medium text-critical-strong">
                  {urlError}
                </p>
              )}
            </Field>

            <Field
              label="Access key"
              htmlFor="access-key"
              hint="Hosted servers require a personal key; ask whoever runs the server for yours. It is stored only in this browser and sent only to the backend URL above. Leave empty for a local server."
            >
              <div className="flex gap-2">
                <input
                  id="access-key"
                  type={showKey ? "text" : "password"}
                  className={INPUT_CLASS}
                  value={accessKey}
                  onChange={(event) => setAccessKey(event.target.value)}
                  onBlur={commitKey}
                  onKeyDown={onEnter(commitKey)}
                  placeholder="kv_…"
                  spellCheck={false}
                  autoComplete="off"
                />
                <Button
                  variant="outline"
                  aria-label={showKey ? "Hide access key" : "Show access key"}
                  aria-pressed={showKey}
                  title={showKey ? "Hide" : "Show"}
                  onClick={() => setShowKey((value) => !value)}
                >
                  {showKey ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                </Button>
              </div>
            </Field>

            <div className="flex items-start justify-between gap-4">
              <div>
                <p id="demo-mode-label" className="text-[13px] font-medium">
                  Demo mode
                </p>
                <p id="demo-mode-hint" className="text-[12px] leading-5 text-muted-foreground">
                  Use built-in examples, no model calls.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={settings.mockMode}
                aria-labelledby="demo-mode-label"
                aria-describedby="demo-mode-hint"
                onClick={() => void save({ mockMode: !settings.mockMode })}
                className={cn(
                  "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  settings.mockMode ? "bg-primary" : "bg-muted-foreground/40",
                )}
              >
                <span
                  className={cn(
                    "inline-block size-5 rounded-full bg-white shadow transition-transform",
                    settings.mockMode ? "translate-x-5.5" : "translate-x-0.5",
                  )}
                />
              </button>
            </div>

            <div className="space-y-2">
              <Button variant="outline" onClick={() => void testConnection()} disabled={health.status === "testing"}>
                {health.status === "testing" ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
                Test connection
              </Button>
              {health.status === "ok" && authStatus && (
                <Alert variant={authStatus.problem ? "destructive" : "positive"}>
                  {authStatus.problem ? <TriangleAlert aria-hidden="true" /> : <Check aria-hidden="true" />}
                  <AlertDescription>
                    {authStatus.problem ? "Server reached, but analysis is locked: " : "Connected. "}
                    <strong>{authStatus.text}</strong> · Mode: <strong>{health.health.mode}</strong> · Model:{" "}
                    <strong>{health.health.model}</strong>
                    {health.health.models?.fast && (
                      <>
                        {" "}
                        (fast tier: <strong>{health.health.models.fast}</strong>
                        {health.health.models.search ? <>, search: <strong>{health.health.models.search}</strong></> : null}
                        {health.health.models.failover ? <>, failover: <strong>{health.health.models.failover}</strong></> : null})
                      </>
                    )}{" "}
                    · Web search: <strong>{health.health.webSearch ? "on" : "off"}</strong> · Server v{health.health.version}
                  </AlertDescription>
                </Alert>
              )}
              {health.status === "error" && (
                <Alert variant="destructive">
                  <TriangleAlert aria-hidden="true" />
                  <AlertDescription>{health.message}</AlertDescription>
                </Alert>
              )}
            </div>
          </section>

          <section className="space-y-4 rounded-lg border border-border bg-card p-4">
            <h2 className="section-label">Analysis preferences</h2>
            <Field
              label="Trusted sources"
              htmlFor="trusted-domain"
              hint="Preferred when choosing sources. Never overrides the evidence."
            >
              {settings.trustedDomains.length > 0 && (
                <ul className="flex flex-wrap gap-1.5" aria-label="Trusted domains">
                  {settings.trustedDomains.map((domain) => (
                    <li
                      key={domain}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-0.5 text-[12px]"
                    >
                      {domain}
                      <button
                        type="button"
                        className="inline-flex cursor-pointer rounded-sm text-muted-foreground hover:text-critical-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`Remove ${domain}`}
                        onClick={() => removeDomain(domain)}
                      >
                        <XIcon className="size-3.5" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                <input
                  id="trusted-domain"
                  type="text"
                  className={cn(INPUT_CLASS, domainError && "border-critical")}
                  value={domainInput}
                  aria-invalid={domainError ? true : undefined}
                  aria-describedby={domainError ? "trusted-domain-error" : undefined}
                  onChange={(event) => {
                    setDomainInput(event.target.value);
                    if (domainError) setDomainError(null);
                  }}
                  onKeyDown={onEnter(addDomain)}
                  placeholder="lemonde.fr"
                  spellCheck={false}
                  autoComplete="off"
                />
                <Button variant="outline" onClick={addDomain}>
                  <Plus aria-hidden="true" />
                  Add
                </Button>
              </div>
              {domainError && (
                <p id="trusted-domain-error" className="text-[12px] font-medium text-critical-strong">
                  {domainError}
                </p>
              )}
            </Field>

            <Field
              label="Language (optional)"
              htmlFor="language"
              hint="BCP-47 tag for explanations and drafts, e.g. fr. Defaults to the post's language."
            >
              <input
                id="language"
                type="text"
                list="kavannah-languages"
                className={cn(INPUT_CLASS, "max-w-[12rem]")}
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
                onBlur={commitLanguage}
                onKeyDown={onEnter(commitLanguage)}
                placeholder="Same as the post"
                spellCheck={false}
                autoComplete="off"
              />
              <datalist id="kavannah-languages">
                {LANGUAGE_SUGGESTIONS.map((code) => (
                  <option key={code} value={code} />
                ))}
              </datalist>
            </Field>
          </section>

          <p className="text-[12px] leading-5 text-muted-foreground">
            Kavannah holds no AI API key and no prompts. It reads posts on x.com, calls the Kavannah server you configured
            above and copies text you approve. Nothing is ever posted or submitted for you.
          </p>
        </div>
      </main>
    </div>
  );
}
