import { CopyButton } from "./CopyButton";
import "./CodeBlock.css";

export function CodeBlock({ code }: { code: string }) {
  return (
    <div className="code">
      <pre>
        <code>{code}</code>
      </pre>
      <CopyButton text={code} />
    </div>
  );
}
