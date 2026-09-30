import { useId, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** One titled part of a result card ("Disinformation score", "Labels", …) with an optional status on the right. */
export function SubSection({
  icon: Icon,
  title,
  aside,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn("px-4 py-3.5", className)}>
      <div className="mb-2.5 flex min-h-6 items-center gap-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <h4 id={id} className="text-[13px] font-semibold leading-5 text-foreground">
          {title}
        </h4>
        {aside && <div className="ml-auto flex items-center">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/** Small caption above a group of items inside a sub-section ("What was found", "Sources", …). */
export function GroupTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <p className="text-[12px] leading-5">
      <span className="font-semibold text-foreground">{children}</span>
      {hint && <span className="text-muted-foreground"> · {hint}</span>}
    </p>
  );
}
