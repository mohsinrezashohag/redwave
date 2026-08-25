# Packet 10 — Make expense categories extensible

Small, independent. Do it whenever.

## Goal
Let Redwave add an expense category without a code change.

## Why
`expense_items.category` is a Prisma enum — `km`, `meals`, `hotel`, `flight`, `rental`, `gas`, `other`.
The *field schema* per category is fully dynamic and admin-managed, but the category list itself is not.
Adding "parking" today needs a migration.

## Two options — pick one and say which in the build-log entry

**A. Add values as needed.** Minimal. Each new category is still a migration.
**B. Move to a config table** with the enum retained only for the seven built-ins that carry behaviour
(`km` drives the map/rate path; `meals` drives `multiplies_cap`). Categories without special behaviour
become data.

B is the real fix. A is fine if the list is genuinely stable — ask Redwave how often it changes.

## ⚠ Postgres gotcha
`ALTER TYPE ... ADD VALUE` cannot be **used** in the same transaction that adds it, and Prisma wraps
migrations in a transaction. So it is **two migrations**, or a raw block. This will bite whoever does
it otherwise.

## Invariants at risk
- **#10** — expense field configs are effective-dated. A new category needs its field config, or item
  entry will fail validation with no obvious cause.

## Definition of done
- A new category can be added and used end to end: create an item, validate, approve, land in an
  expense report, reach a pay run.
- `km` and `meals` keep their special behaviour.
- Existing items are unaffected.
