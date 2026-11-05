import type { CredentialSource } from "../../api/types";
import { Badge } from "../../ui/Badge";

const LABELS: Record<Exclude<CredentialSource, null>, string> = {
  env: "environnement",
  session: "session",
};

export function CredentialStatus({ name, source }: { name: string; source: CredentialSource }) {
  return (
    <Badge tone={source ? "ok" : "neutral"}>
      {name} : {source ? LABELS[source] : "non définie"}
    </Badge>
  );
}
