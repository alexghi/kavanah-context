import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import type { Tone } from "@kavannah/shared";
import { TONE_ICON } from "@/lib/tone";
import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11.5px] font-semibold leading-4 [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border text-foreground",
        muted: "border-transparent bg-muted text-muted-foreground",
        accent: "border-transparent bg-accent text-accent-foreground",
        critical: "border-critical-line bg-critical-soft text-critical-strong",
        warning: "border-warning-line bg-warning-soft text-warning-strong",
        caution: "border-caution-line bg-caution-soft text-caution-strong",
        positive: "border-positive-line bg-positive-soft text-positive-strong",
        neutral: "border-neutral-line bg-neutral-soft text-neutral-strong",
        /** Descriptive labels ("Kind of post"): outlined, no colour, never a judgement. */
        type: "border-neutral-line bg-card text-foreground",
      },
    },
    defaultVariants: { variant: "secondary" },
  },
);

export interface BadgeProps extends ComponentProps<"span">, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/** A severity chip: tone colours plus the tone's icon, so meaning never relies on colour alone. */
export function ToneBadge({ tone, children, ...props }: Omit<BadgeProps, "variant"> & { tone: Tone }) {
  const Icon = TONE_ICON[tone];
  return (
    <Badge variant={tone} {...props}>
      <Icon aria-hidden="true" />
      {children}
    </Badge>
  );
}
