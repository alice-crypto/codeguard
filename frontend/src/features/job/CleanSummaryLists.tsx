import type { CleanChange } from "../../api/types";
import { changeKindLabels } from "../../lib/labels";
import { Badge } from "../../ui/Badge";
import "./CleanSummaryLists.css";

export function ChangeList({ changes }: { changes: CleanChange[] }) {
  if (!changes.length) return null;
  return (
    <section className="clean-list">
      <h2 className="clean-list__title">Changements</h2>
      <ul>
        {changes.map((change) => (
          <li key={`${change.path}:${change.description}`}>
            <span className="clean-list__meta">
              <code>{change.path}</code>
              <Badge tone="accent">{changeKindLabels[change.kind]}</Badge>
            </span>
            {change.description}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function LeftAloneList({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <section className="clean-list">
      <h2 className="clean-list__title">Laissé en l'état</h2>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
