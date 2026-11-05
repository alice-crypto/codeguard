import { useFx } from "../fx/useFx";

export function ReadingProgress() {
  const ref = useFx<HTMLDivElement>();
  return <div ref={ref} data-fx="progress-bar" aria-hidden="true" />;
}
