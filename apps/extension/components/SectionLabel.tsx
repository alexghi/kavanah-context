import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** 11px uppercase, tracking-wide, muted: "CONTENT ASSESSMENT", "SHOULD I ENGAGE?", ... */
export function SectionLabel({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("section-label", className)} {...props} />;
}
