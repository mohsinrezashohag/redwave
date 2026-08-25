# Questions for Redwave — seven open items

**Prepared 14 August 2026 · for Naimur to take to Redwave Marketing Inc.**

We are building the ERP/HRM platform and have reached seven points where we genuinely cannot proceed
without a decision from Redwave. Each one is a business question, not a technical one — the system can be
built either way, but building it the wrong way would produce wrong invoices or wrong pay, and that is not
something we want to discover after go-live.

Four of these are blocking active work today. Two are decisions we need before finishing related features.
One is something we found in Redwave's own spreadsheets that they will want to know about regardless of
what they decide.

**We are not guessing on any of these.** Where a question is unanswered, that piece of work is parked
rather than built on an assumption.

---

## At a glance

| # | The question | What it's holding up |
|---|---|---|
| 1 | Which price list is the current one? | Client billing rates; the margin/rate report |
| 2 | If an agent *and* their team both hit target, does the client pay both bonuses or the higher one? | Team bonus feature (all of it) |
| 3 | Is the team target counted on internet sales only, or all products? | Team bonus feature |
| 4 | Can a team include agents selling for different clients? | Team bonus feature |
| 5 | Should invoices already sent to clients be re-issued with the corrected Agent ID? | Closing out a fix already made |
| 6 | RF Now's $35 Home Phone + TV bundle — keep it or drop it? | Final billing setup |
| 7 | Three spreadsheet cells look like copy/paste errors — which values are right? | Confidence in the numbers we check against |

---

## Blocking questions

### 1. Which price list is the current one?

**The question.** We have two different price lists from Redwave, and they don't just differ in numbers —
they price in two fundamentally different ways. We need to know which one is live.

**Version A — the July billing spreadsheet.** Prices are set by the *product name*, the same for every
client:

| Product | Rate |
|---|---|
| Fibre 150mb/300mb | 280 |
| Fibre 500mb/650mb | 340 |
| Fibre 1gig/2.5gig | 350 |
| RF Fibre 1gig/2.5gig | 365 |
| WI Internet 25/5 · 50/10 | 380 |
| Business Internet 150 | 400 |
| Business Internet 500/1gig | 450 |

**Version B — the list from our third meeting.** Prices are set *per client*:

- **Valley Fiber** — 350 for every internet speed; Wireless 380; Home Phone 50, TV 50
- **RF Now** — 280 / 340 / 365 by speed; Home Phone 90, TV 100
- **CTI** (billed in US dollars) — Internet 250; Home Phone 50, Protection Plan 50, Mesh Extender 50
- **VF Business** — Internet 400; Speed attach 50, Home Phone 60, TV 60

**Why it matters.** These disagree in ways that change real invoices. Under Version B, Valley Fiber pays
350 for any internet sale. Under Version A, a Valley Fiber 150mb sale is billed **280**. The two also
disagree on RF Now's add-ons — 90 and 100 in Version B, but a flat 50 in the July sheet.

**If we guess wrong**, every affected invoice is wrong, and nothing in our testing would catch it — the
system would confidently produce the wrong number. That is exactly why we are asking rather than picking.

**Follow-up if Version A is the answer:** does Valley Fiber actually sell the lower speeds? And if they do,
is Valley Fiber really billed 280 for a 150mb sale?

> **Answer:**
>
>

---

### 2. If an agent and their team both hit target, does the client pay both bonuses, or just the higher one?

**The question.** We are adding team-based target bonuses on top of the existing per-agent ones. If an
agent personally hits their weekly target, *and* the team they belong to also hits its target, what does
the client pay — both bonuses, or only the larger?

**Why it matters.** This one directly changes the amount invoiced. There is no sensible default; both
answers are perfectly reasonable business rules, and we have no basis for choosing.

**If we guess wrong**, we either over-bill the client or under-pay the incentive, on every week where both
targets are met.

> **Answer:**
>
>

---

### 3. Is the team target counted on internet sales only, or all products?

**The question.** When we count whether a team has hit its target, do we count internet activations only,
or every product sold (internet, TV, home phone, and so on)?

**Why it matters.** Agent commission tiers are counted on internet activations only. We should not assume
the team target follows the same rule — it may well be intended to count everything.

> **Answer:**
>
>

---

### 4. Can a team include agents selling for different clients, or is a team always within one client?

**The question.** Is a "team" a group of agents that can span Valley Fiber, RF Now and CTI, or does each
team sit inside a single client?

**Why it matters.** It determines how teams are set up and how their totals are counted. Getting it wrong
means rebuilding the structure later rather than adjusting a setting.

> **Answer:**
>
>

*(Questions 2, 3 and 4 are all needed before we can start the team bonus feature. Question 2 is the one
that changes money.)*

---

## Decisions needed

### 5. Should invoices already sent to clients be re-issued with the corrected Agent ID?

**Background.** Client statements were printing Redwave's *internal* agent code (for example `RW-D-0001`)
in the column labelled "Agent ID". The client's own roster uses a different code — `Redwave20` — so a
partner reconciling our statement against their records could not match a single agent. We found this by
checking against Redwave's own billing workbook, and it is now fixed: new statements print the
partner-facing code.

**The question.** Statements issued *before* the fix still show the old internal code. This is deliberate —
an issued document never changes after the fact, which is what keeps the billing history trustworthy. Does
Redwave want those earlier statements re-issued with the corrected ID?

**What re-issuing involves.** It creates a new, newly numbered document and marks the original as
superseded. Nothing is deleted or edited — the original remains on record. So this is a question of whether
the correction is worth a new document, not a technical constraint.

> **Answer:**
>
>

---

### 6. RF Now's $35 Home Phone + TV bundle — keep it in the system, or drop it?

**Background.** In our third meeting it was recorded that Redwave wanted this bundle removed from the
system and handled manually. Since then, configurable bundle pricing has been built, so the system can now
apply it automatically when a sale includes both Home Phone and TV.

**The question.** Keep it switched on, or leave it unconfigured and handle it manually as originally
discussed?

**Worth noting.** Redwave's own July billing sheet is inconsistent here — one row applies the 35 bundle,
while two other rows on identical products apply nothing. That inconsistency is part of question 7 below,
and may be the reason the bundle was proposed for removal in the first place.

> **Answer:**
>
>

---

## Data integrity

### 7. Three cells in Redwave's workbooks look like copy/paste errors — which values are correct?

**Context, offered constructively.** In order to make sure our system produces numbers that match
Redwave's, we went through the sample workbooks formula by formula. They match almost everywhere. Three
cells look like ordinary spreadsheet copy/paste slips — the kind that happen in every workbook that has
been in use for a while:

1. **Payroll sheet, cell M9** — the Home Phone rate on row 9 is reading row **8**'s Home Phone tick box
   instead of row 9's. So one row's home phone pay is driven by the row above it.
2. **Billing sheet, cell N5** — the *Home Phone* rate on row 5 is reading the **TV** tick box rather than
   the Home Phone one. So that row charges home phone based on whether TV was sold.
3. **Billing sheet, cells O3 and O5** — the bundle bonus formula returns zero in both of its branches, so
   it can never pay anything. On row 4, an identical product combination correctly applies 35.

**The question.** Should we treat the *corrected* values as the intended ones — that is, each row reads its
own tick box, and the bundle applies consistently?

**Why we are raising it.** Our system will calculate these rows correctly, which means it will **disagree**
with those three cells in the sample workbooks. Anyone comparing the two side by side will see the
difference and reasonably ask which is wrong. We would rather flag it now than have it surface during
review as an apparent fault in the new system.

To be clear, this is not a criticism of the workbooks — they have been running a real business, and these
are the sort of small slips that any spreadsheet accumulates. We just need agreement on which value is
right.

> **Answer:**
>
>

---

## What happens once we have answers

| Answers received | Unblocks |
|---|---|
| Q1 | Loading the real client rates, and the margin/rate report that depends on them |
| Q2, Q3, Q4 | The team target + bonus feature |
| Q5 | Closing out the Agent ID fix |
| Q6 | Finalising billing setup |
| Q7 | Confidence that our figures and Redwave's agree, and where they intentionally don't |

Everything else that can be built without these answers is being built in the meantime.

---

## Appendix — where each question came from

*For the Redwave Marketing internal team; not needed for the conversation with the client.*

| # | Source |
|---|---|
| 1 | `docs/claude-code/system-audit.md` §2.4 (the two grids compared side by side); `docs/meeting-3-deltas.md` §1; packet `01-rate-grid-load.md` |
| 2–4 | Packet `05-teams-target-spiff.md`, "Ask before building" |
| 5 | `docs/uat/billing-target-format.md` (Agent ID column); the fix shipped in commit `44c8824` |
| 6 | `docs/meeting-3-deltas.md` §6 item 6; bundle pricing built in migration `20260616000000` |
| 7 | `docs/claude-code/system-audit.md` §1.4, cell-by-cell table |

Every figure quoted above was re-checked against those files on 14 August 2026.
