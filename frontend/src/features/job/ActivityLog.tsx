import { useLayoutEffect, useRef } from "react";
import { plural } from "../../lib/format";
import { Disclosure } from "../../ui/Disclosure";
import "./ActivityLog.css";

const FOLLOW_MARGIN = 12;

export function ActivityLog({ logs, open }: { logs: string[]; open?: boolean }) {
  const ref = useRef<HTMLPreElement>(null);
  const following = useRef(true);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element && following.current) element.scrollTop = element.scrollHeight;
  }, [logs.length]);

  return (
    <Disclosure summary={`Activité · ${plural(logs.length, "étape")}`} defaultOpen={open}>
      <pre
        ref={ref}
        className="activity-log"
        role="log"
        tabIndex={0}
        onScroll={(event) => {
          const { scrollTop, clientHeight, scrollHeight } = event.currentTarget;
          following.current = scrollTop + clientHeight >= scrollHeight - FOLLOW_MARGIN;
        }}
      >
        {logs.join("\n") || "Démarrage…"}
      </pre>
    </Disclosure>
  );
}
