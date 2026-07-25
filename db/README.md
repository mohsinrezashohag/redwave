# `db/` — database migrations

Migrations are **Prisma-managed**. The schema lives at
[`../backend/prisma/schema.prisma`](../backend/prisma/schema.prisma), and the versioned, ordered
SQL lives under **`../backend/prisma/migrations/`** — 30 migrations, from `init` through the
2026-06 series. This `db/` directory is the documented **home/pointer** for the migration story
so the repo layout in `CLAUDE.md` §4 stays meaningful alongside Prisma's tooling conventions.

## Authoring vs. applying — do not mix these up

| Command | Does | Who |
| --- | --- | --- |
| `npm run prisma:migrate` (`migrate dev`) | **Authors** a new migration from a schema change and applies it | developer, **local only** |
| `npm -w backend run prisma:deploy` (`migrate deploy`) | **Applies** pending migrations; authors nothing, needs no shadow DB | operator / CI / production |

**Operators only ever run `deploy`.** `migrate dev` can reset a database to reconcile drift —
never point it at a deployed environment.

```sh
# Author a change (local)
cd backend && npx prisma migrate dev --name <change_name>

# Apply pending migrations (operator / CI / production)
npm -w backend run prisma:deploy
```

A few migrations are **hand-authored SQL** (e.g. the list-pagination indexes: `CREATE INDEX`
only) specifically so they apply with `migrate deploy` without a shadow database. Keep that
property when adding index-only or backfill migrations.

After applying, re-run the seed when a change adds catalogue rows — `npm -w backend run
prisma:seed` is idempotent and seeds the **bootstrap only** (the demo needs `SEED_DEMO=yes` and
must never run on a deploy). See `CLAUDE.md` §2.5 for the full command set and §4 for what each
seed writes.

## Rules (CLAUDE.md §8, §10)

- Migrations are **versioned and ordered**; never hand-edit production schema.
- Go-live data (master + opening balances) loads through the **Import** module with the
  reconcile-before-commit gate — not via ad-hoc SQL.
- Schema integrity the migrations must enforce: exact-decimal money columns
  (`Decimal @db.Decimal`), effective-dated config, FK integrity, and **`rep_code` uniqueness
  including against terminated reps** (codes are never reused — §3 #11).
- **No cascade deletes** — the ledger preserves records; the DB RESTRICTs hard deletes.
