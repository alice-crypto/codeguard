import { useParams } from "react-router";
import { JobView } from "../features/job/JobView";

export function JobPage() {
  const { id = "" } = useParams();
  return <JobView key={id} id={id} />;
}
