import { exportUrl, type ExportFormat } from "../../api/endpoints";
import { buttonClass } from "../../ui/Button";
import { Icon } from "../../ui/Icon";

const FORMATS: ReadonlyArray<[ExportFormat, string]> = [
  ["markdown", "Markdown"],
  ["json", "JSON"],
  ["sarif", "SARIF"],
];

export function ExportLinks({ jobId }: { jobId: string }) {
  return (
    <>
      {FORMATS.map(([format, label]) => (
        <a
          key={format}
          className={buttonClass("secondary", true)}
          href={exportUrl(jobId, format)}
          download
        >
          <Icon name="download" size={14} />
          {label}
        </a>
      ))}
    </>
  );
}
