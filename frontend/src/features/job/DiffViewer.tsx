import { useMemo } from "react";
import { parseDiff, type DiffFile } from "../../lib/diff";
import { Disclosure } from "../../ui/Disclosure";
import "./DiffViewer.css";

const MAX_OPEN_FILES = 8;
const MAX_OPEN_LINES = 500;

function FileDiff({ file, open }: { file: DiffFile; open: boolean }) {
  return (
    <Disclosure
      defaultOpen={open}
      summary={
        <span className="diff-file__summary">
          <span className="diff-file__path">{file.path}</span>
          <span className="diff-file__stat">
            <span className="diff-file__added">+{file.added}</span>{" "}
            <span className="diff-file__removed">-{file.removed}</span>
          </span>
        </span>
      }
    >
      <div className="diff-file__body" tabIndex={0}>
        {file.lines.map((line, index) => (
          <span key={index} className={`diff-line diff-line--${line.kind}`}>
            {line.text || " "}
          </span>
        ))}
      </div>
    </Disclosure>
  );
}

export function DiffViewer({ diff }: { diff: string }) {
  const files = useMemo(() => parseDiff(diff), [diff]);
  const fewFiles = files.length <= MAX_OPEN_FILES;
  return (
    <div className="diff-viewer">
      {files.map((file) => (
        <FileDiff
          key={file.path}
          file={file}
          open={fewFiles && file.lines.length < MAX_OPEN_LINES}
        />
      ))}
    </div>
  );
}
