# Client rate grid — data-entry reference (Meeting 3)

> **These are CLIENT-BILLING rates** (what Redwave charges each partner), per client, **in the client's
> currency**. They are **not** rep commission — rep pay stays Schedule C v2, untouched (#3). Enter them via
> the admin UI (Clients & Products), not code. **Get a one-line client sign-off on the actual numbers before
> entering them** — the source sheet was titled "Commission", so confirm the values are bill rates (the
> classification is settled; the confirm is on the figures, since a wrong number = a wrong invoice).

## The grid

| Client | `client_code` | Currency | Internet (all speeds → bill) | Add-ons (bill) |
|---|---|---|---|---|
| **Valley Fiber** | `VF` | CAD | 350 | Wireless 380 · Home Phone 50 · TV 50 |
| **RF Now** | `RF` | CAD | 150/300 → 280 · 500/650 → 340 · 1000/2500 → 365 | Home Phone 90 · TV 100 · **HP+TV bundle → +35** |
| **CTI** | `CTI` | **USD** | 250 | Home Phone 50 · Protection Plan 50 · Mesh Extender 50 |
| **VF Business** | `VFB` | CAD | 400 (base speed 150) | Speed-attach 50 · Home Phone 60 · TV 60 |

Add-on **rep commission** is a separate, admin-set flat rate per add-on type — **$0 (bill-only) unless the
client actually pays the rep for it** (#8). Set it when you create the product type (below).

## Entry steps (admin UI browser pass)

1. **New add-on product types** — `/admin/product-types` → "Add product type" for each new `standard_addon`:
   **Wireless**, **Protection Plan**, **Mesh Extender**, **Speed-attach**. Optionally set the inline
   **commission** flat rate ($0 = bill-only). (internet / greenfield / tv / home_phone already exist.)
2. **Clients** — `/admin/clients` → create **VF, RF, CTI, VF Business**. Set **Billing currency = USD for
   CTI**, CAD for the others. *(Currency locks once a statement/invoice is issued — set it right the first
   time.)*
3. **Products + billing rates** — on each client's detail page: add the internet product(s) + each add-on
   product; use the inline **billing rate** (in the client's currency) from the grid, effective from the
   go-live date. The rate cards show the client's currency (USD client → `USD 250.00`).
4. **RF Now bundle** — on RF's Billing rates panel, add one rate with **rate kind = Bundle bonus**, amount
   **35** (CAD), no product (client-wide). This is a *configured* bundle — nothing is special-cased.

## Scope note — bundle application
The $35 bundle is **stored + configurable** now. **Applying** add-on / bundle rate kinds to a statement's
line totals is a separate, still-deferred billing task (statement pricing currently combines only
`rate_kind='product'`). If Redwave needs the bundle to actually appear on invoices, that's the next billing
sub-task — flag it.

## First real FX conversion (verify after entering CTI = USD)
With CTI = USD + a USD internet rate + a confirmed CTI sale, **issue a statement**: the total is in USD, and
at issue the system freezes `{currency: USD, fx_rate, amount_cad}` (rate via the Bank of Canada source when
`FX_RATE_SOURCE=bank_of_canada`, else your manual override; a foreign issue with neither → 422). The business
dashboard then consolidates CTI's **CAD equivalent**, not the raw USD. Same mechanic for a USD rep expense
(freezes at approval).
