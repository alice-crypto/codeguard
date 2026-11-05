import { useEffect, useRef, useState } from "react";
import { Button } from "./Button";

const CONFIRM_MS = 1600;

export function CopyButton({ text, label = "Copier" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("done");
    } catch {
      setState("failed");
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), CONFIRM_MS);
  }

  return (
    <Button small onClick={copy} aria-live="polite">
      {state === "done" ? "Copié ✓" : state === "failed" ? "Échec de la copie" : label}
    </Button>
  );
}
