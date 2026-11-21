# AGENTS.md — working on Redwave with parallel agents

This file is for coding agents (Claude Code subagents and any other agent) working in this repo. Read it with
`CLAUDE.md`, which always wins on rules, invariants and conventions. This file only covers **how work is split
between agents** so they do not collide.

## Roles

| Agent | Use it for | May edit files? |
| --- | --- | --- |
| **Coordinator** (the main session) | Plans the batch, owns shared files, migrations and the contract, merges, runs the full verification gate, writes docs, commits. | Yes |
| `Explore` | Read-only fan-out search: "where is X", "how does Y work". Returns conclusions with `file:line`. | No |
| `Plan` | Designs an implementation for one area from the Explore findings. | No |
| `general-purpose` | **Implementer** for one workstream with a fixed file-ownership list. | Yes, only owned files |
| `qa-reviewer` | Read-only QA against BRD/SRS, CLAUDE.md invariants and the meeting deltas. Used for the final audit. | No |
| `ux-reviewer` | Read-only UI/UX review against `docs/design-system.md` and CLAUDE.md §7/§13. Used for the final audit. | No |

## Rules for implementer agents

1. **Stay inside your ownership list.** The coordinator gives each workstream a list of folders/files it owns.
   If you need a change in a file you do not own, do not make it: put it in your final report under
   **"Shared-file edits needed"** with the exact change.
2. **Coordinator-only files** (never edit them from a workstream):
   - `backend/prisma/schema.prisma`, `backend/prisma/migrations/**`, `backend/prisma/seed/**`
   - `contract/openapi.yaml` (final export is done by the coordinator)
   - `frontend/src/components/layout/Sidebar.tsx`, `frontend/src/routes/router.tsx`, `frontend/src/routes/crumbs.ts`,
     `frontend/src/features/admin/pages/AdminHomePage.tsx`, `frontend/src/features/notifications/eventCatalogue.ts`
   - `CLAUDE.md`, `AGENTS.md`, `docs/**`
   - `package.json` / lockfile changes: report the dependency you need instead of installing it.
3. **The invariants in CLAUDE.md §3 are hard constraints.** Money is exact decimal, snapshots are immutable, the
   two rate streams never mix, the engine stays pure. The structural guard specs (§14 rule 10) must stay green;
   if one fails, fix your code, never the spec.
4. **Follow the screen playbook** (CLAUDE.md §13): tokens only (stylelint), shared primitives, `DataState`,
   react-hook-form + zod, `useConfirm`, no em-dash inside user-facing sentences, responsive down to 360px.
5. **Generated API types.** You may run `npm -w backend run contract:export` then `npm -w frontend run gen:api` to
   type a new endpoint. Other workstreams edit the backend at the same time, so a failure caused by someone
   else's in-progress code is not yours: retry later. The coordinator does the final export.
6. **Verify your own slice before reporting:** the jest specs / vitest tests for the files you changed, plus
   `npm -w backend run typecheck` and `npm -w frontend exec -- tsc --noEmit`, reading only the errors in your
   files (other workstreams may be mid-change).
7. **Never** run anything against `backend/.env` (it points at production): no `prisma migrate`, no seed, no
   scripts that connect to the database. Never commit or push; the coordinator does.
8. **Final report:** what you changed (files), what you verified and how, what you could not verify, and the
   shared-file edits you need.

## How a batch runs

1. Coordinator explores (Explore agents), plans, and gets the human's approval.
2. Coordinator lands the schema migration and anything shared first, then runs `prisma:generate`.
3. Implementer agents run in parallel, one per workstream, each with its ownership list.
4. Coordinator applies the shared-file edits, runs `contract:export` → `gen:api`, the full verification gate
   (CLAUDE.md §2.5), updates docs, and commits.
5. Final audit: `qa-reviewer` + `ux-reviewer` (+ `/code-review`) in parallel; findings go to the human before any push.
