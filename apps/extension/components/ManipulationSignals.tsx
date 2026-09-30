import { MANIPULATION_SIGNAL_ORDER, MANIPULATION_SIGNALS, type ManipulationSignal } from "@kavannah/shared";
import type { DecisionVerdict } from "@/lib/decisions";
import { ToneBadge } from "./ui/badge";

/** The signals in the display order, without duplicates or values this build doesn't know. */
const ordered = (signals: readonly ManipulationSignal[]) => MANIPULATION_SIGNAL_ORDER.filter((id) => signals.includes(id));

/**
 * "Verdict" and "Manipulation signals" as two separate lines, visible whether the section is open
 * or not. `signals` is undefined when the server predates them: that line is left out.
 */
export function VerdictAndSignals({ verdict, signals }: { verdict: DecisionVerdict; signals?: readonly ManipulationSignal[] }) {
  const items = signals ? ordered(signals) : [];
  const row = "flex flex-wrap items-center gap-x-1.5 gap-y-1";
  return (
    <dl className="space-y-1.5 text-[12px] leading-5">
      <div className={row}>
        <dt className="font-semibold text-foreground">Verdict:</dt>
        <dd>
          <ToneBadge tone={verdict.tone}>{verdict.label}</ToneBadge>
        </dd>
      </div>
      {signals && (
        <div className={row}>
          <dt className="font-semibold text-foreground">Manipulation signals:</dt>
          {items.length === 0 ? (
            <dd className="text-muted-foreground">None detected</dd>
          ) : (
            items.map((id) => (
              <dd key={id}>
                <ToneBadge tone="caution">{MANIPULATION_SIGNALS[id].label}</ToneBadge>
              </dd>
            ))
          )}
        </div>
      )}
    </dl>
  );
}

/** Each signal found in the post with its meaning. */
export function ManipulationSignalList({ signals }: { signals: readonly ManipulationSignal[] }) {
  const items = ordered(signals);
  if (items.length === 0) return <p className="text-[12.5px] leading-5 text-muted-foreground">No manipulation signal was detected.</p>;
  return (
    <dl className="space-y-2.5" aria-label="Manipulation signals found">
      {items.map((id) => (
        <div key={id}>
          <dt>
            <ToneBadge tone="caution">{MANIPULATION_SIGNALS[id].label}</ToneBadge>
          </dt>
          <dd className="mt-1 text-[12.5px] leading-5 text-muted-foreground">{MANIPULATION_SIGNALS[id].definition}</dd>
        </div>
      ))}
    </dl>
  );
}
