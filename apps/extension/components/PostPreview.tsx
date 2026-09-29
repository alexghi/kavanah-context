import { useLayoutEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { PostContext } from "@kavannah/shared";
import { cn } from "@/lib/utils";

export function PostPreview({ post }: { post: PostContext }) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);
  const name = post.author?.displayName;
  const handle = post.author?.handle;

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    if (expanded) return;
    setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [post.text, expanded]);

  return (
    <section aria-label="Post being analyzed" className="border-b border-border px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-[13px] font-semibold text-foreground">{name ?? handle ?? "Post on X"}</span>
            {name && handle && <span className="truncate text-[12px] text-muted-foreground">{handle}</span>}
          </div>
          <p
            ref={textRef}
            className={cn("mt-1 whitespace-pre-line text-[13px] leading-5 text-foreground/90", !expanded && "line-clamp-3")}
          >
            {post.text}
          </p>
          {(clamped || expanded) && (
            <button
              type="button"
              className="mt-1 cursor-pointer text-[12px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
        </div>
        <a
          href={post.url}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex shrink-0 items-center gap-1 rounded-sm text-[12px] text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Open post
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}
