import { groupLabels, LABEL_GROUPS, type ContentLabel, type GroupedLabel } from "@kavannah/shared";
import { GroupTitle } from "./SubSection";
import { Badge, ToneBadge } from "./ui/badge";

/** A label chip exactly as it appears in the analysis: coloured with an icon for findings, outlined for kinds of post. */
export function LabelChip({ item }: { item: Pick<GroupedLabel, "label" | "group" | "tone"> }) {
  return item.group === "type" ? <Badge variant="type">{item.label}</Badge> : <ToneBadge tone={item.tone}>{item.label}</ToneBadge>;
}

function LabelGroupList({ items }: { items: GroupedLabel[] }) {
  return (
    <dl className="mt-1.5 space-y-2.5">
      {items.map((item) => (
        <div key={item.id}>
          <dt>
            <LabelChip item={item} />
          </dt>
          <dd className="mt-1 text-[12.5px] leading-5 text-muted-foreground">{item.definition}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The post's labels, split into findings (most severe first) and kinds of post, each with its meaning. */
export function LabelList({ labels }: { labels: ContentLabel[] }) {
  const { findings, types } = groupLabels(labels);
  return (
    <div className="space-y-3.5" aria-label="Content labels" role="group">
      {findings.length > 0 && (
        <div>
          <GroupTitle>{LABEL_GROUPS.finding.title}</GroupTitle>
          <LabelGroupList items={findings} />
        </div>
      )}
      {types.length > 0 && (
        <div>
          <GroupTitle hint="describes the post, not a judgement">{LABEL_GROUPS.type.title}</GroupTitle>
          <LabelGroupList items={types} />
        </div>
      )}
    </div>
  );
}
