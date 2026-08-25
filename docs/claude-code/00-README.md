# Redwave — Claude Code work packets

Feed these **one at a time**. Each is scoped to be verifiable on its own.

## Order and dependencies

```
01 rate-grid-load ──┬─> 02 payroll-report ──┬─> 03 rep-pay-statement
                    │                       └─> 09 configurable-exports
                    └─> 07 rate-transparency

04 backdate-import      (independent)
05 teams-target-spiff   (independent — largest, scope it before starting)
06 bulk-statements      (independent, small)
08 configurable-periods (independent, wide blast radius)
10 expense-category     (independent, tiny)
```

**Do 01 first.** It changes no code, but without real rates every downstream
build is verified against $60 placeholder data, which proves nothing.

## House rules — apply to every packet

`CLAUDE.md` is loaded automatically; it is authoritative. In particular:

- **§3 invariants.** Each packet below names the ones it can break. Re-read them before writing code.
- **§9 comment standard**, **§13 frontend conventions**. Follow both.
- **Contract-first.** If an endpoint or DTO changes:
  `npm -w backend run contract:export` → then `npm -w frontend run gen:api`. In that order.
- **Effective-dated config** goes through `backend/src/common/effective-dating.ts`
  (`planSupersession` / `selectEffectiveRate` / `deriveStatus`). Never reimplement it.
- **RBAC server-side on every endpoint.** No exceptions, no client-only gating.
- **Money is a decimal string in DTOs**, Prisma `Decimal` in storage. Never a JS `number`.

## The verification gate — run before calling anything done

```sh
npm -w backend run test
npm -w backend run lint
npm -w backend run build
npm -w backend run contract:export   # only if an endpoint/DTO changed
npm -w frontend run gen:api          # must follow contract:export
npm -w frontend run build
npm -w frontend run lint
npm -w frontend run stylelint
npm -w frontend run test
```

## Every packet ends with

1. A new entry in `docs/build-log.md` — what it built, **why**, the migration it added,
   what it deliberately left out, how it was verified.
2. `CLAUDE.md` updated **only** if a durable convention changed. Do not duplicate
   build-log narrative into CLAUDE.md.

## Scope discipline

If a packet turns out to need a schema change that is not listed in it, **stop and say so**
before writing the migration. Several of these touch the money path; an unplanned schema
change there is how a frozen snapshot gets corrupted.
