/**
 * IssueText — an import row's issue in its standard form, "<Column>: <problem>. <fix>." (server
 * `issue-format.logic`), with the column name in bold so the eye lands on WHICH cell is wrong first. A
 * message that does not start with a short "Column:" prefix (an older batch, or an informational note) is
 * shown as written. 2026-11-28
 */
import { splitIssue } from '../issueText';

export function IssueText({ text }: { text: string | null | undefined }) {
  if (!text) return <>—</>;
  const { column, message } = splitIssue(text);
  if (!column) return <>{text}</>;
  return (
    <>
      <strong>{column}:</strong> {message}
    </>
  );
}
