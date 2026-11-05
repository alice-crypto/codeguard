import { plural } from "../../lib/format";
import { Disclosure } from "../../ui/Disclosure";
import "./DroppedFindings.css";

export function DroppedFindings({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <Disclosure
      summary={`${plural(items.length, "remarque écartée", "remarques écartées")} : lignes non vérifiables`}
    >
      <ul className="dropped-findings">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </Disclosure>
  );
}
