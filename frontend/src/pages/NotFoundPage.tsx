import { EmptyState } from "../ui/EmptyState";
import { LinkButton } from "../ui/LinkButton";

export function NotFoundPage() {
  return (
    <EmptyState
      title="Cette page n'existe pas"
      action={
        <LinkButton to="/" variant="primary">
          Revenir à l'accueil
        </LinkButton>
      }
    >
      L'adresse a peut-être changé, ou contient une faute de frappe.
    </EmptyState>
  );
}
