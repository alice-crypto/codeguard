import { CodeBlock } from "../../ui/CodeBlock";
import "./BranchCommands.css";

export function BranchCommands({ branch }: { branch: string }) {
  return (
    <section className="branch-commands">
      <h2 className="branch-commands__title">
        Branche <code>{branch}</code>
      </h2>
      <p className="branch-commands__label">Voir les changements</p>
      <CodeBlock code={`git diff HEAD...${branch}`} />
      <p className="branch-commands__label">Fusionner dans ta branche</p>
      <CodeBlock code={`git merge --squash ${branch}`} />
    </section>
  );
}
