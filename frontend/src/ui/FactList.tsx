import { Fragment, type ReactNode } from "react";
import "./FactList.css";

export function FactList({ facts }: { facts: ReadonlyArray<[string, ReactNode]> }) {
  return (
    <dl className="facts">
      {facts.map(([term, value]) => (
        <Fragment key={term}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
