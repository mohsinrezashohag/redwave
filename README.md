# Redwave ERP / HRM Platform

A custom ERP/HRM platform for **Redwave Marketing Inc.** — a single-stack TypeScript modular
monolith. This repository is a **monorepo** managed with **npm workspaces**.

> Read [`CLAUDE.md`](CLAUDE.md) first — it carries the invariants (exact-decimal money,
> immutable snapshots, separated rate streams, server-side RBAC) that every change must uphold.
> **CLAUDE.md §2.5 is the full command reference**; this file is the short onboarding path.
> The authoritative specs live in [`docs/`](docs/).

## Repository layout

| Path        | What it is                                                                          |
| ----------- | ----------------------------------------------------------------------------------- |
| `backend/`  | NestJS app (TypeScript). Prisma ORM → PostgreSQL. 21 domain modules; owns migrations. |
| `frontend/` | React + Vite SPA (TypeScript). Consumes the API via the generated contract.          |
| `contract/` | OpenAPI 3 spec — the stable seam between backend, web, and the future mobile app.    |
| `db/`       | Database migrations home (Prisma-managed — see [`db/README.md`](db/README.md)).      |
| `docs/`     | Canonical specs: BRD, SRS, data model, architecture, design system, security.        |

## Prerequisites

- **Node.js ≥ 20** (developed on v24) and **npm ≥ 10**.
- A running **PostgreSQL** instance with a database named **`redwave`**.

## First-time setup

```sh
# 1. Install all workspace dependencies (one hoisted install at the root).
npm install

# 2. Configure the backend database connection.
#    Copy the template, then edit backend/.env with YOUR real Postgres password.
#    Keep the database name `redwave`. Create it if it does not exist:
#       (in psql)  CREATE DATABASE redwave;
cp backend/.env.example backend/.env      # PowerShell: Copy-Item backend/.env.example backend/.env
cp frontend/.env.example frontend/.env    # optional — Maps key, API origin

# 3. Generate the Prisma client from the schema.
npm run prisma:generate

# 4. Generate the typed API client. REQUIRED — src/api/generated/ is gitignored, so this
#    file does not exist on a fresh clone and the frontend build fails without it.
#    It reads the committed contract/openapi.yaml: no backend and no database needed.
npm -w frontend run gen:api

# 5. Create the schema and seed the day-one catalogue (roles, permissions, Super Admin,
#    commission config, pay periods). Add SEED_DEMO=yes for rich demo data — never in prod.
npm -w backend run prisma:deploy
npm -w backend run prisma:seed
```

## Running

```sh
# Backend — boots NestJS on http://localhost:3000
npm run dev:backend

# Verify end-to-end wiring (backend ↔ Postgres):
#   GET http://localhost:3000/health  → 200  { "status": "ok", ... "database": { "status": "up" } }
#   If the DB is unreachable you get 503 — proving the check is real.
#   Swagger UI is at /docs (dev only; disabled in production unless ENABLE_SWAGGER=true).

# Frontend — boots the Vite dev server on http://localhost:5173
# It proxies /v1, /api and /health to the backend on :3000.
npm run dev:frontend
```

## Common scripts

Run from the repo root. **CLAUDE.md §2.5 has the rest**, including how to run a single test and
the full pre-merge verification gate.

| Script                              | Does                                                        |
| ----------------------------------- | ----------------------------------------------------------- |
| `npm run dev:backend`               | Start NestJS in watch mode.                                  |
| `npm run dev:frontend`              | Start the Vite dev server.                                   |
| `npm run build`                     | Build backend, then frontend.                                |
| `npm run lint`                      | ESLint across both apps.                                     |
| `npm test`                          | Backend jest **only** — frontend tests are a separate run.   |
| `npm -w frontend run test`          | Frontend vitest.                                             |
| `npm -w frontend run stylelint`     | Enforce design tokens (no raw hex/px outside `theme.css`).   |
| `npm run format`                    | Prettier-format the repo.                                    |
| `npm -w backend run contract:export`| Regenerate `contract/openapi.yaml` from the controllers.     |
| `npm -w frontend run gen:api`       | Regenerate the typed client — always run after the export.   |
| `npm run prisma:generate`           | Regenerate the Prisma client from the schema.                |
| `npm run prisma:migrate`            | Author + apply a **dev** migration. Never against prod.      |
| `npm -w backend run prisma:deploy`  | Apply pending migrations (operator / CI / production).       |
| `npm -w backend run prisma:seed`    | Seed the bootstrap catalogue (idempotent).                   |
| `npm run prisma:studio`             | Open Prisma Studio.                                          |

## Tech stack

TypeScript end to end — **NestJS** backend, **React + Vite** frontend, **Prisma** ORM on
**PostgreSQL**, a **REST/OpenAPI 3** contract, and JWT + server-side RBAC. See
[`docs/architecture.md`](docs/architecture.md) for the full picture and
[`docs/security.md`](docs/security.md) for the security posture.
