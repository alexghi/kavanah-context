import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const alertVariants = cva(
  "relative w-full rounded-md border px-3 py-2.5 text-[12.5px] leading-5 [&>svg]:absolute [&>svg]:left-3 [&>svg]:top-3 [&>svg]:size-4 [&>svg~*]:pl-6",
  {
    variants: {
      variant: {
        default: "border-border bg-card text-foreground",
        info: "border-primary/30 bg-accent text-accent-foreground [&>svg]:text-link",
        warning: "border-caution-line bg-caution-soft text-foreground [&>svg]:text-caution-strong",
        destructive: "border-critical-line bg-critical-soft text-foreground [&>svg]:text-critical-strong",
        positive: "border-positive-line bg-positive-soft text-foreground [&>svg]:text-positive-strong",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface AlertProps extends ComponentProps<"div">, VariantProps<typeof alertVariants> {}

export function Alert({ className, variant, ...props }: AlertProps) {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

export function AlertTitle({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("mb-0.5 font-semibold", className)} {...props} />;
}

export function AlertDescription({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("[&_p]:leading-5", className)} {...props} />;
}
