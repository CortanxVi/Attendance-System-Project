# Project Agent Collaboration Rules

This repository is maintained with a two-agent hybrid workflow.

1. Read `log.md`, `git status`, and the files in the intended scope before editing.
2. Keep each agent's scope explicit and avoid concurrent edits to the same files. If scope must overlap, hand off the current state before the second agent continues.
3. Preserve unrelated user changes and never discard another agent's work without an explicit, documented decision.
4. After every completed task or material change, append a detailed English entry to `log.md`. Do not rewrite or delete earlier entries.
5. Every log entry must include the date, actor, objective, files or components changed, implementation rationale, security and privacy impact, database or deployment impact, verification performed, and remaining risks or handoff work.
6. Never write secrets, access tokens, raw biometric data, student records, private URLs, or other personally identifiable information into the log.
7. Before handing work to the other agent, run checks proportional to the change and record their exact outcome in `log.md`.

