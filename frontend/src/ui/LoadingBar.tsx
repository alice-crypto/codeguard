import { useFx } from "../fx/useFx";

export function LoadingBar({ label }: { label: string }) {
  const ref = useFx<HTMLDivElement>();
  return <div ref={ref} data-fx="loading-bar" role="progressbar" aria-label={label} />;
}
