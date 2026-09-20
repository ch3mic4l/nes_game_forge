# Agent workflow

Use these rules for work in this repository. Consult relevant sections of
`CLAUDE.md` for project architecture, commands, and invariants; locate headings
before reading large documents.

## Keep tool output focused

- Search filenames and symbols with `rg` before reading contents. Read relevant
  sections and changed code, expanding to dependencies when needed for correctness.
- Default to 2,000–4,000 output tokens per call; use 500–1,500 for discovery.
  Keep combined results within the outer tool's output budget. If output is
  truncated, narrow the query instead of repeating the full read.
- Batch independent, bounded reads. Keep dependent steps and mutations sequential.
- Return useful output and exit status rather than serializing entire tool results.
  For structured data, select the fields needed for the task.
- Save full test logs to a temporary file. Return exit status, pass/fail/skip counts,
  and failure details; inspect the saved log as needed. Preserve the test command's
  exit status and run all required checks. A skipped test is not a passing test.
- Poll long-running commands at 10–30-second intervals unless interactive input
  or a known shorter completion time requires otherwise.
- In follow-up reviews, inspect changes since the last reviewed state and affected
  dependencies. Reuse established findings; broaden review when changes invalidate
  them. Record the reviewed commit or diff baseline.
- After an identical sandbox startup failure, avoid repeated unchanged retries.
  Diagnose the environment or use the permitted approval path; preserve sandbox
  and permission protections.
