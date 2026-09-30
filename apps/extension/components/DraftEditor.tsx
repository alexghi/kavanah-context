import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, Copy, RefreshCw, RotateCcw, TriangleAlert, X as XIcon } from "lucide-react";
import type { DraftKind } from "@kavannah/shared";
import type { DraftState } from "@/hooks/useAnalysis";
import { copyText } from "@/lib/clipboard";
import { SourceItem } from "./EvidenceList";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { Textarea } from "./ui/textarea";

export interface DraftEditorProps {
  kind: DraftKind;
  state: DraftState;
  onChange(text: string): void;
  onRegenerate(): void;
  onReset(): void;
  onRetry(): void;
  onClose?(): void;
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!copied && !failed) return;
    const timer = setTimeout(() => {
      setCopied(false);
      setFailed(false);
    }, 2000);
    return () => clearTimeout(timer);
  }, [copied, failed]);

  return (
    <Button
      size="sm"
      onClick={async () => {
        const ok = await copyText(text);
        setCopied(ok);
        setFailed(!ok);
      }}
      aria-live="polite"
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {copied ? "Copied" : failed ? "Copy failed" : label}
    </Button>
  );
}

export function DraftEditor({ kind, state, onChange, onRegenerate, onReset, onRetry, onClose }: DraftEditorProps) {
  const label = kind === "reply" ? "Reply draft" : "Community Note draft";
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const text = state.status === "ready" ? state.text : "";

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, 96)}px`;
  }, [text, state.status]);

  if (state.status === "idle") return null;

  return (
    <div className="space-y-2.5 rounded-lg border border-border bg-background p-3" aria-label={label}>
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold text-foreground">{label}</span>
        {onClose && (
          <Button variant="ghost" size="icon" className="size-6 [&_svg]:size-3.5" aria-label={`Close ${label.toLowerCase()}`} onClick={onClose}>
            <XIcon aria-hidden="true" />
          </Button>
        )}
      </div>

      {state.status === "loading" && (
        <div role="status" aria-live="polite" className="space-y-2">
          <p className="text-[12px] text-muted-foreground">Generating {label.toLowerCase()}…</p>
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-11/12" />
          <Skeleton className="h-3.5 w-2/3" />
        </div>
      )}

      {state.status === "error" && (
        <div className="space-y-2">
          <Alert variant="destructive">
            <TriangleAlert aria-hidden="true" />
            <AlertDescription>{state.error.message}</AlertDescription>
          </Alert>
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RefreshCw aria-hidden="true" />
            Try again
          </Button>
        </div>
      )}

      {state.status === "ready" && (
        <ReadyEditor
          kind={kind}
          label={label}
          state={state}
          textareaRef={textareaRef}
          onChange={onChange}
          onRegenerate={onRegenerate}
          onReset={onReset}
        />
      )}

      <p className="text-[11.5px] text-muted-foreground">Review before posting. Kavannah never posts for you.</p>
    </div>
  );
}

function ReadyEditor({
  kind,
  label,
  state,
  textareaRef,
  onChange,
  onRegenerate,
  onReset,
}: {
  kind: DraftKind;
  label: string;
  state: Extract<DraftState, { status: "ready" }>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onChange(text: string): void;
  onRegenerate(): void;
  onReset(): void;
}) {
  const { generated, text } = state;
  const count = Array.from(text).length;
  const dirty = text !== generated.text;

  return (
    <>
      <Textarea
        ref={textareaRef}
        value={text}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        rows={4}
        className="bg-card"
      />
      <div className="flex flex-wrap items-center gap-2">
        <CopyButton text={text} />
        <Button size="sm" variant="outline" onClick={onRegenerate}>
          <RefreshCw aria-hidden="true" />
          Regenerate
        </Button>
        <Button size="sm" variant="ghost" onClick={onReset} disabled={!dirty}>
          <RotateCcw aria-hidden="true" />
          Reset to generated
        </Button>
        {kind === "reply" && (
          <span className="ml-auto tabular-nums text-[12px] text-muted-foreground" aria-live="polite">
            {count} {count === 1 ? "character" : "characters"}
          </span>
        )}
      </div>
      {generated.sources.length > 0 && (
        <div>
          <p className="section-label">Sources used</p>
          <ul className="mt-1.5 space-y-1.5">
            {generated.sources.map((source) => (
              <SourceItem key={source.id} source={source} compact />
            ))}
          </ul>
        </div>
      )}
      {generated.warnings.length > 0 && (
        <Alert variant="warning">
          <TriangleAlert aria-hidden="true" />
          <AlertDescription>
            <ul className="space-y-0.5">
              {generated.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}
