# COA Architecture Audit — 2026-05-09

**Auditor:** Claude (opus, deep audit)
**Scope:** RM Entity Ring + Vendor Entity Ring + POS Product Entity Ring (RM-purchase domain only)
**Doctrine source:** `https://hnhotels.in/ops/visual/coa-doctrine/` (Doctrine v1.0, May 2026, 11 sections)
**System under test:** PR #133 preview state (worktree branch `claude/nch-l2-visual`)
**Method:** Read-only review of migrations 0001–0007, `functions/api/{rm-sourcing,vendors,pos-products}.js`, and `ops/{rm-sourcing-editor,vendor-editor,pos-editor}/index.html`. No code or data modified. Behavioural tests run against the actual regex/grammar logic in Node and Python to confirm what the API accepts.

---

## Executive Summary (≤300 words)

**Grade: B+** — strong on grammar design and the cascade keystone; **B-grade gaps** in DB-level constraint enforcement, validator parity across layers, and a doctrinal hole around I-primary RMs. Foundation is **near-complete** for current scope, but three P0 fixes are needed before declaring the ring closed.

### Top 3 strengths
1. **The vendor v8 case-encoded grammar across all four architectural dimensions is doctrinally pure.** Possibility (uppercase primary) and "also possible" (lowercase alt) are encoded in the code itself, with absent letters meaning impossible. The math holds.
2. **Vendor cascade (Framework Gap 1) is correctly atomic via `DB.batch`** — old code rewritten in every RM tree referencing it, in a single D1 transaction. Failure mode reports the attempted cascade list (`functions/api/vendors.js:656-665`).
3. **I-only on RM is correctly rejected with reasoning** ("RMs must be purchasable") at three levels: editor save button disabled, editor `deriveCode()` returns null, API `validateSourcingProfile()` rejects. Doctrine: states-of-production are not RMs.

### Top 5 gaps requiring attention
1. **P0 — DB CHECK constraints absent on `rm_sourcing_profiles`.** `brand_prefix`, `rm_type`, `usage_profile`, `sourcing_profile`, `item_abbr` are plain `TEXT NOT NULL`. Direct D1 INSERT bypasses entire validation stack. Layer-2 says schema mirrors dimensions; today the schema does not enforce any dimension.
2. **P0 — I-primary slip-through.** `validateSourcingProfile()` only rejects the literal string `'I'`. `Il`, `Ib`, `Ilb`, `Ilb` all pass — but each is "I-primary, with L/B as alt," doctrinally a state-of-production with secondary-mode purchase. Either accept these as valid points (and remove the I-only rejection) or reject all I-primary; today the system is inconsistent.
3. **P0 — `rm_type` regex over-permissive.** `^[ADP][MS]$` accepts `PM`, `PS` — neither in the doctrine's `{AM, AS, DM, DS}` set. P-prefix is silently legal.
4. **P1 — No FK from POS to RM via recipes.** Legacy `rm_recipes` table (`schema-rm.sql:135`) keys on integer Odoo `pos_product_id` and free-text `material_code` — neither references the new canonical `pos_code` or `rm_code` strings. Renaming a POS row today: silently breaks recipe lookups.
5. **P1 — Cascade integrity depends on `JSON.stringify` byte-format.** The vendor PUT cascade uses `LIKE '%"vendor_code":"<code>"%'` against `data_json` text. Any whitespace-formatted JSON (manual D1 edit, future seed via `wrangler d1 execute`) silently misses the cascade. Structural query (e.g., parsing then matching) is more robust.

### Recommendation
**Do NOT declare foundation complete yet.** Land the 3 P0 fixes (CHECK constraints + I-primary semantics + rm_type regex) — likely 30 min of work — then re-declare. P1 items can be deferred to the Action ring, since they all live at the entity-ring/action-ring boundary.

---

## Phase 1 — Doctrine Mapping

| § | Principle | Implementation | File:Line | Status |
|---|-----------|----------------|-----------|--------|
| 1 | Operations as coordinates | `vendor_code`, `rm_code`, `pos_code` are PKs; identity is composed, never typed | `functions/api/{vendors,rm-sourcing,pos-products}.js` (composeXxxCode) | OK |
| 2 | Operation space O = Cartesian product of closed dims | RM 5-segment, Vendor 5-segment, POS 3-segment grammars | `migrations/0002,0006,0007` | OK |
| 2 | Constraint set C prunes impossibilities | Validators in API + editor; `I-only` rejected; PMS pattern locked | `rm-sourcing.js:170-187`, `vendors.js:99-143` | **PARTIAL — see P0 gaps** |
| 3.G1 | No data missed | USAGE empty rejected (RM); identity_abbr required (Vendor); pos_name required (POS) | `rm-sourcing.js:144-150`, `vendors.js:147-152` | OK |
| 3.G2 | No data wrong | API validators reject malformed codes — but **DB CHECKs missing on RM table** | `migrations/0001` lacks CHECKs | **GAP** |
| 3.G3 | No data interpreted | Codes are PKs, agents would query by code — but `data_json` carries free-text `notes`, `category` | (see Phase 8) | **PARTIAL** |
| 3.G4 | Future coverage automatic | `data_json` flex columns absorb new properties without migration | All entities | OK |
| 4 | Three rings: Entity → Action → Event | **Entity ring closed; Action/Event deferred.** No `rm_recipes` v2 yet. | — | OK (ring order respected) |
| 5.L1 | Codes auto-derived from structured input | `composeRmCode`, `composeVendorCode`, `composePosCode` — yes; never typed in editor | All editors | OK |
| 5.L2 | Structured storage; no free-text where structured suffices | **`category` (POS) free-form**, `notes` everywhere, location.area, communication.* | `pos-editor/index.html:941-943` | **GAP — see Phase 8** |
| 5.L2 | Audit trails on every write | Only `updated_at`, `updated_by` columns. **No history/log table** for entity rings. | All migrations | **GAP** |
| 5.L3 | Agents read coordinates | Not yet built. Agent ring deferred. | — | DEFERRED |
| 5.L4-L7 | Crons, Comms, UI, Deployment | Editors L6 only. Rest deferred. | `ops/*-editor/` | OK (L6 partial) |
| 6 | Three roles | Editors are PIN-gated. Owner only currently. Staff dumb-proof UI deferred to Action ring. | — | DEFERRED (Action) |
| 7 | 12-step build discipline | **Steps 1–7 partially complete.** Step 6 (constraint set) has gaps; step 7 (compute |O ∩ C|) not formalized anywhere. | — | **PARTIAL** |
| 8 | Failure modes — skipping discipline | "Skipping Constraint Set → invalid combinations slip through" — applies here (Phase 2 below) | — | **WARNING** |
| 9 | Transfer pack | Available at doctrine page | doctrine HTML | OK |
| 10 | Why now: Claude Code + CF + Claude API + structured outputs | Yes, deployed on this stack | `wrangler.toml`, `functions/` | OK |
| 11 | Closing test: coordinate vs free-text? | Mostly enforced. Free-text exceptions: `notes`, `category` (POS), location & contact data on vendor. | Editors | **PARTIAL — judgment call** |

**Mapping verdict:** every doctrine principle has *some* implementation; six (G2, G3, L2-storage, L2-audit, §6 step-7, §11) are partial. None are unimplemented in spirit.

---

## Phase 2 — Possibility/Impossibility Encoding Tests

Run against the actual regex/validator logic, mirrored in Python. Goal: find combinations that pass when they shouldn't (false negatives) or fail when they shouldn't (false positives).

### RM grammar (5-segment, `{BRAND}-{TYPE}-{USAGE}-{SOURCING}-{ITEM}`)

| Test code | Expected | API verdict | Notes |
|-----------|----------|-------------|-------|
| `NCH-AM-P-Lb-MLK` | Accept | Accept | OK — buffalo milk, prod-only, loose-primary |
| `NCH-DM-Pr-Bl-OSB` | Accept | Accept | OK — Osmania, dual-USAGE, branded-primary |
| `HN-AM-O-B-LPG` | Accept | Accept | OK — operational fuel |
| `HN-AM-P-I-XYZ` | **Reject** ("I-only") | **Reject** | OK — `validateSourcingProfile`:174 |
| `HN-AM-P-Il-XYZ` | **Should reject** (I-primary = state) | **ACCEPT** | **GAP P0** — only literal `'I'` checked, not I-primary |
| `HN-AM-P-Ilb-XYZ` | **Should reject** (I-primary trifecta) | **ACCEPT** | **GAP P0** — same |
| `HN-AM-P-Lib-XYZ` | Reject (alts not sorted) | **ACCEPT** | **GAP** — regex doesn't enforce alt sort order; canonical form should be `Lbi` |
| `HN-AM-P-Lbb-XYZ` | Reject (duplicate alt letter) | **ACCEPT** | **GAP** — regex `[lbi]*` allows repeats |
| `HN-PM-P-L-XYZ` | **Should reject** (PM not in {AM,AS,DM,DS}) | **ACCEPT** | **GAP P0** — `rm_type` regex `^[ADP][MS]$` admits P-prefix |
| `HN-AM-O-L-CHL` | Accept (operational, loose) | Accept | OK |
| `HN-AM-Po-L-XYZ` | Accept | Accept | OK — production primary, operational alt — owner says "rare edge case" |
| `HN-AM-Pro-L-XYZ` | Accept | Accept | OK — trifecta usage |
| `HN-AM-PR-L-XYZ` | **Reject** (`PR` is two uppercase letters, no primary) | **Reject** | OK — `validateUsageProfile` regex `^[PRO][pro]{0,2}$` |
| `HN-AM-Pp-L-XYZ` | **Reject** (duplicate letter) | **Reject** | OK — explicit dup check in validator |

**False-negative count (slip-through gaps): 5** — `Il`, `Ilb`, `Lib`, `Lbb`, `PM/PS` rm_type.

### Vendor grammar (5-segment, `{PAY_SEQ}-{SELLS}-{OPM}-{PMS}-{IDENTITY}`)

| Test code | Expected | API verdict | Notes |
|-----------|----------|-------------|-------|
| `Rf-L-M-C-PRABHU` | Accept | Accept | OK — daily milk vendor |
| `Pf-B-A-B-ZEPTO` | Accept | Accept | OK — Zepto pre-pay app |
| `Rf-Lb-M-Cb-SHARIFF` | Accept | Accept | OK — primary loose, branded fallback |
| `Rfp-Lb-Ma-Cb-EXAMPLE` | Accept | Accept | OK — all alternates |
| `Rf-LB-M-C-X` | Reject (flat LB no longer valid) | **Reject** | OK — v8 regex requires `[LB][lb]?` |
| `Rf-Ll-M-C-X` | Reject (duplicate L) | Reject | OK — explicit dup check |
| `Pf-Pf-M-C-X` | Reject (PAY_SEQ not in segment 2) | Reject | OK — segment 2 regex `[LB][lb]?` |
| `Pfr-Lb-Ma-Cb-VENDOR` | Accept (rare PAY_SEQ all-alt) | Accept | OK |
| `Pfp-…` | Reject (Pfp not enumerated) | Reject | OK — `validatePaySeq` enumerates |
| `Rf-B-A-B-ZEPTO` (where SELLS='B' and PMS='B') | Accept; semantic ambiguity in eyeball but parser is fine | Accept | OK — dash-delimited so no actual conflict |
| `Rf-L-M-C-` (empty IDENTITY) | Reject | Reject | OK — IDENTITY length 3-10 |
| `Rf-L-M-C-AB` (IDENTITY too short) | Reject | Reject | OK |

**False-negative count: 0** on Vendor grammar. Doctrinally clean — the v8 fix worked.

**Semantic question:** `Pfr-…-PMS=C` (cash) — pay-first-primary in cash makes operational sense (walk-in market: hand cash forward, take goods). Compositionally legal. **Nothing in the architecture connects PAY_SEQ to PMS, which is correct** — they're orthogonal dimensions.

### POS grammar (3-segment, `{BRAND}-{SHAPE}-{ITEM}`)

| Test code | Expected | API verdict | Notes |
|-----------|----------|-------------|-------|
| `NCH-S5-IRC` | Accept | Accept | OK — Irani chai, batch+approx |
| `HE-S6-CKB` | Accept | Accept | OK — marinated chicken |
| `HN-S10-PKG` | Accept | Accept | OK — packaging fee, no RM |
| `HN-S6-XYZ` | **Should reject?** (S6 is "HE-side") | **ACCEPT** | **GAP** — SHAPE×BRAND not constrained. Doctrine description ties S6/S7/S8 to HE only, but math doesn't. Either lift the description (S6 is just a shape, brand-agnostic) OR add a CHECK. Lean toward lifting — keeps space tight. |
| `NCH-S99-XXX` | Reject | Reject | OK — DB CHECK and API enforce |
| `XX-S1-AAA` | Reject | Reject | OK — DB CHECK |
| `NCH-S1-IR` (2-char ITEM) | Reject | Reject | OK — `item_abbr.length !== 3` |
| `NCH-S1-IRA1` (4-char ITEM) | Reject | Reject | OK |

**False-negative count: 0** — POS grammar is the tightest of the three. Most importantly because **migration 0007 actually has CHECK constraints on `brand_prefix` and `shape`** at the DB level. (RM does not.)

### Cross-entity test cases

- **RM with USAGE='R' (retail-only) — must its supplier vendor have SELLS containing B?**
  - Today: not enforced anywhere. An R-only RM linked to a vendor `Rf-L-M-C-PRABHU` (loose only) would be silently inconsistent.
  - Doctrine: this should be a constraint set rule. Currently O ∩ C does not include this clause. **GAP P2** (low frequency in practice, but a real cross-ring constraint).

- **POS shape S10 (NO_RM) — should it have any RM linkage?**
  - Today: `pos_code` has no recipe table FK (recipes deferred), so this is N/A for now. When `rm_recipes` lands, S10 must have zero recipe rows. Adding a CHECK like "shape='S10' implies recipe count = 0" is straightforward in Action ring, but should be planned now. **NOTED for Action ring.**

- **Vendor delete with referenced RM tree → 409 OK** (verified `vendors.js:697-728` does the FK pre-check).

---

## Phase 3 — Cascade Audit

The vendor PUT cascade is the system's highest-risk operation. Tested:

### Atomicity
- **`DB.batch([…])` runs as one D1 transaction.** If any statement fails, all roll back. (`vendors.js:656-665`) **OK.**
- The order is `[DELETE old, INSERT new, UPDATE rm rows…]` — D1 batches run sequentially within one transaction, so the momentary "no row exists" between DELETE and INSERT is not externally visible. **OK.**

### Failure modes

| Scenario | Behavior | Risk |
|----------|----------|------|
| Concurrent edit on RM tree mid-cascade | D1 row-lock held during batch; new UPDATE wins last-writer | Low |
| Batch exceeds D1 limits (1000 stmts/batch) | Worker would error with batch-size error → 500 | Low (current scale: 24 vendors, 55 RMs — ceiling far away). Hard limit ~1000 stmts/batch. With 100 RMs each potentially referencing the renamed vendor, batch is ~102 stmts — fine. **At 1000 RMs+ this becomes a real concern.** **NOTED for future scale.** |
| RM tree's data_json was inserted with non-`JSON.stringify` formatting (e.g., manual `wrangler d1 execute` with pretty JSON) | LIKE `%"vendor_code":"X"%` silently misses; cascade does not rewrite | **GAP P1** |
| Vendor deleted directly from D1 (not via API), but RM tree still references it | API GET with `expand=vendors` → ref marked `vendor_missing: true`. **OK** — doesn't crash, surfaces problem. (`rm-sourcing.js:361-363`) **OK.** |
| RM tree concurrently updated to add new ref to same old vendor_code while cascade running | New ref written with old code; cascade query already evaluated, doesn't see new ref. **Race condition, low frequency, surfaces as `vendor_missing: true` next read.** Acceptable for current scale. |

### POS rm_code cascade — **does not exist**
- POS PUT changes `pos_code` (`pos-products.js:299-325`). Atomic INSERT new + DELETE old. **No downstream cascade.**
- Today: `rm_recipes` legacy table doesn't reference `pos_code`. Until Action ring lands, this is moot.
- **When recipe ring lands:** `rm_recipes.pos_code` will need cascade rewrite on POS PUT. **NOTED for Action ring.**

### RM rm_code cascade — **does not exist**
- RM PUT changes `rm_code` (`rm-sourcing.js:439-466`). Atomic INSERT new + DELETE old. **No downstream cascade.**
- Vendor records don't reference `rm_code` (correct — vendor is upstream of RM).
- Recipe ring: when it lands, both `pos_code` AND `rm_code` referenced by FK. RM rename → recipe rewrite needed. **NOTED for Action ring.**

### Cascade audit verdict
**Vendor cascade is correctly atomic and failure-aware.** One real gap (`JSON.stringify` byte-format dependency) is P1 because owner has not edited D1 directly. Future POS/RM cascades land with the recipe ring, which is appropriate (entity ring is closed first).

---

## Phase 4 — Constraint Set Audit (DB / API / UI)

### RM (`rm_sourcing_profiles`)

| Constraint | DB CHECK | API validator | Editor disable-save |
|------------|----------|---------------|---------------------|
| brand_prefix ∈ {NCH, HE, HN} | **NO** (`migrations/0001:11`: plain `TEXT NOT NULL`) | YES (`composeRmCode`:117-120) | YES (chip-row, `BRANDS`:764) |
| rm_type ∈ {AM, AS, DM, DS} | **NO** | **PARTIAL** — regex `^[ADP][MS]$` admits `PM, PS` (`composeRmCode`:121-123) | YES (`APPROXIMATIONS+USE_SCOPES`:769-776) |
| usage_profile validation | **NO** | YES (`validateUsageProfile`:144-165) | YES (`isEmptyUsage` + chip selectors) |
| sourcing_profile validation | **NO** | YES — but accepts `Lib`, `Lbb`, `Il`, `Ilb` (`validateSourcingProfile`:169-187) | YES — but `PROFILE_OPTIONS`:763 still lists `Il`, `Ib`, `Ilb` |
| item_abbr 3 chars | **NO** | YES — but accepts 2–4 chars (`composeRmCode`:132: regex `^[A-Z0-9]{2,4}$`) | YES (`maxlength=4`) |
| Code uniqueness | YES (PK) | YES (collide check before INSERT) | implicit |

**Verdict:** RM is the **leakiest entity ring**. DB has zero constraint enforcement; API has 4 leaks; editor has 1 leak (PROFILE_OPTIONS still lists `Il/Ilb`). Layer parity broken across the board.

### Vendor (`vendor_profiles`)

| Constraint | DB CHECK | API validator | Editor disable-save |
|------------|----------|---------------|---------------------|
| pay_seq ∈ {Pf, Rf, Pfr, Rfp} | YES (`migrations/0006:57`) | YES (`validatePaySeq`:89-97) | YES |
| sells ∈ {L, B, Lb, Bl} | YES (`0006:61`) | YES (`validateSells`:99-112) | YES |
| opm ∈ {M, A, Ma, Am} | YES (`0006:62`) | YES (`validateOpm`:114-127) | YES |
| pms ∈ {C, B, Cb, Bc} | YES (`0006:63`) | YES (`validatePms`:129-143) | YES |
| identity_abbr length 3-10, A-Z 0-9 | NO (just NOT NULL) | YES | YES |
| identity uniqueness | YES (UNIQUE INDEX) | YES (collide check) | YES |

**Verdict:** Vendor is the **tightest entity ring** — all four architectural dimensions have full triple-layer enforcement. The only soft spot is `identity_abbr` content rules (length, charset) only at API and editor, not DB. Acceptable.

### POS (`pos_products`)

| Constraint | DB CHECK | API validator | Editor disable-save |
|------------|----------|---------------|---------------------|
| brand_prefix ∈ {NCH, HE, HN} | YES (`0007:44`) | YES (`validateBrand`:78-82) | YES |
| shape ∈ {S1...S10} | YES (`0007:45`) | YES (`validateShape`:84-88) | YES |
| item_abbr exactly 3 chars | NO (just NOT NULL) | YES (`validateItem`:90-96) | YES (maxlength=3) |
| (brand, shape, item) uniqueness | YES (`0007:53` UNIQUE INDEX) | YES (collide check) | implicit |
| brand×shape compatibility (S6-S8 = HE-side) | NO | NO | NO |

**Verdict:** POS is **almost as tight as Vendor**, with the design-doc-only constraint that S6/S7/S8 are HE-side ignored everywhere. Recommend lifting that doc constraint (math doesn't need it; brands can use any shape) OR encoding it in the constraint set (DB CHECK + API).

---

## Phase 5 — Future-Proofing Test (8 scenarios)

| # | Scenario | Verdict | Reasoning |
|---|----------|---------|-----------|
| 1 | NCH opens 2nd outlet (NCH-B2) | **REQUIRES SCHEMA CHANGE** | BRAND prefix conflates "brand" and "outlet". Currently NCH = the one outlet. To handle multi-outlet, need OUTLET dimension separate from BRAND, e.g. `NCH-B2-S5-IRC` (4 segments). This is a real architectural gap — but scope-deferred until Smart Hotel opens. **NOTED.** |
| 2 | Tomato puree (in-house semi-finished from RMs) | **REQUIRES STATES RING** | Doctrine §4 enumerates States as the 4th entity type (`State ∈ Brand × Type × Recipe-ref × Item`). Today: not implemented. The "I-only is a state, not RM" rejection in `rm-sourcing.js:174` means the user is told "move it to States layer" — but that layer doesn't exist yet. **GAP — doctrine acknowledges, system not yet built. Acceptable for current scope (RM purchase domain).** |
| 3 | Vendor M→Ma→A transition | **HANDLED CLEANLY** | Vendor PUT with `opm: 'A'` re-keys atomically with cascade. Owner can change vendor's `opm` from `M` to `Ma` to `A` over time. v8 case-encoded grammar exactly designed for this. ✓ |
| 4 | New payment method (crypto, prepaid card) | **REQUIRES DIMENSION EXTENSION** | PMS values are enumerated ({C, B, Cb, Bc}) at DB CHECK + API + editor. Adding crypto means migration. But: the *case-encoded pattern* extends naturally — `Cb`+`crypto` would give us 3 letters. This forces a doctrinal question: PMS is binary today (C, B). Is it really binary, or is it enumeration of payment rails? If new rails appear, the dimension was always wider than 2. **Acceptable: enumeration migration is normal evolution.** |
| 5 | NCH catering pre-orders (large advance qty) | **HANDLED — new POS shape needed?** | S1-S10 covers retail/recipe/composite/no-RM. Catering = "sale today, RM consumption today, but planned days ahead" — the *recipe* is one of S3/S4/S9. The *event* (planned-vs-walkin) is an Action-ring concern, not Entity. ✓ — entity ring absorbs catering as another POS row. |
| 6 | Vendor's relationship splits (sometimes credit, sometimes prepaid) | **HANDLED VIA Pfr/Rfp** | Exactly the case the v8 grammar was designed for. `Rfp-…` = receive-first-primary + pay-first-alt. Action ring (purchase events) needs to know which mode this transaction was — `data_json` on the action will record. ✓ |
| 7 | Per-RM weekly wastage tracking | **EVENT-RING CONCERN** | Wastage is composition (consumption + write-off events). Entity ring doesn't track quantity over time, only identity. ✓ — correct deferral. Note: legacy `rm_wastage_rules` table exists in `schema-rm.sql:207-217` but it's wastage *rules*, not wastage *events*. Future work. |
| 8 | Service vendors (rent, electricity) | **REQUIRES SELLS EXTENSION** | SELLS today = {L, B, Lb, Bl} (RM-purchase scope). Adding S (services) and C (capex) was explicitly deferred — both DB CHECK and API must extend. The grammar pattern extends naturally: `Rf-S-A-Bc-RENT` is valid in shape. **Acceptable evolution path.** |

**Future-proofing verdict:** 6/8 scenarios absorbed by current architecture. 2 require migration (multi-outlet, expense vendors). Both are scoped out today by design. Doctrine §4 (Build Order) is being respected — not building scope that hasn't materialized.

---

## Phase 6 — Cross-Entity Reference Audit

### RM tree → Vendor (FK by `vendor_code`)

| Aspect | Status | File:Line |
|--------|--------|-----------|
| Ref by canonical code (not name+abbr) | **PARTIAL** — new rows use `vendor_code`; old rows have legacy `name`/`abbr` only | `rm-sourcing.js:336-365` (enrichVendorRefs handles both) |
| Cascade on vendor PUT | **YES** — atomic via DB.batch | `vendors.js:614-665` |
| Refuse vendor DELETE if referenced | **YES** — 409 response | `vendors.js:705-727` |
| Atomic on cascade failure | **YES** — single DB.batch transaction | `vendors.js:656-665` |
| Detect orphan FKs (vendor missing) | **YES** — `vendor_missing: true` flag | `rm-sourcing.js:361-363` |
| Legacy refs reconciled | **NOT YET** — owner must walk editor; supplier picker will overwrite legacy on next pick | UX flow (`rm-sourcing-editor` `pickVendor`:1330-1335) |

### Recipe → POS pos_code AND RM rm_code (deferred)

| Aspect | Status |
|--------|--------|
| FK to `pos_code` | **NOT EXIST** — legacy `rm_recipes.pos_product_id` is INTEGER (Odoo ID) |
| FK to `rm_code` | **NOT EXIST** — legacy `rm_recipes.material_code` is free-text |
| Cascade on POS PUT | **NOT EXIST** |
| Cascade on RM PUT | **NOT EXIST** |

**This is the entity-ring/action-ring boundary.** Doctrine §4 is explicit that Entity must close before Action opens — so deferring recipe-FK to the Action ring is correct. The migration 0007 comment ("Recipe FK enforcement against rm_recipes is reserved for the future Action ring") is honest. **Acceptable for scope.**

But — the legacy `rm_recipes` table is still being read by `rm-ops.js:2028`. This means **agents/UIs using `rm-ops.js` are reading recipes that don't reference our canonical entities**. Tomorrow's recipe ring needs a clean reset, not a backfill. **NOTED.**

### Vendor → outbound references

None — vendor has no outbound FKs. Correct (vendor is a leaf entity in this domain).

### RM `data_json` — embedded brand + SKU strings

Inside `data_json.branded.brands[].name` (e.g., "Amul"), and `.skus[].description` (e.g., "Amul Butter 500g") — these are strings, not entity refs.

**Doctrine question:** is "Amul" a 1st-class entity (Brand) that should have its own table?
- **Today:** No — Brand is a free-text field inside an RM's data_json.
- **Doctrinally:** if multiple RMs source the same Amul brand and the brand identifier mutates (renaming, parent-company change), there's no atomic update path.
- **Scope assessment:** This is a real entity ring gap (5th entity = Brand catalog) but **extremely low-frequency mutation** in practice — brand names like Amul, Britannia don't change. Acceptable to defer. **NOTED.**

---

## Phase 7 — Owner-Truth Reality Check

**Owner state:** 24 vendors + 55 RMs + 78 POS products, all seeded with best-guess (some MEDIUM/LOW confidence). Owner has not yet manually walked editors to refine.

**Question: Can owner walk through and refine without breaking anything?**

### Refinement flows

| Owner action | Outcome | Risk |
|--------------|---------|------|
| Open RM, change USAGE from `P` to `Pr` | Edit posts to `/api/rm-sourcing` PUT, code re-keys atomically. Vendor refs unchanged. | LOW |
| Open RM, change SOURCING from `L` to `Lb` | Editor adds `branded` bucket, code re-keys. Vendor refs in loose unchanged. | LOW |
| Open RM, change `item_abbr` from `MLK` to `BMI` | Code re-keys. **No downstream cascade exists** — but no downstream consumers either (recipe ring deferred). | LOW for now; **MEDIUM after Action ring lands**. |
| Open Vendor, change `pms` from `C` to `Cb` | Code re-keys + cascades to all RM trees that reference it. Atomic. | LOW |
| Open Vendor, change `identity_abbr` | Same path, full cascade. | LOW |
| Try to delete Vendor that has 5 RM references | 409 with `referenced_rms` list. Owner must remove refs first. | LOW (educational, not a trap) |
| Open RM, type `Il` in sourcing_profile (or pick `Il` from PROFILE_OPTIONS) | **PASSES** API silently — corrupts the space | **TRAP P0** |
| Open RM, manually set rm_type to `PM` via DevTools | API accepts | **TRAP P0** |
| Edit RM data_json directly (e.g., paste vendor_name as text without picking) | Schema works (data_json is a TEXT blob), no validation | LOW (no enforcement, but no corruption either — owner sees legacy hint) |
| Owner deletes vendor directly via `wrangler d1 execute` | RM trees orphan; `vendor_missing: true` flag surfaces but no cleanup automation | MEDIUM — same risk as concurrent direct DB writes anywhere |

**Verdict:** Owner-walks are mostly safe. Two real traps both originate in **insufficient validator parity** (Phase 4 P0 gaps). Fix those, owner can walk freely.

---

## Phase 8 — Anti-Pattern Hunt

| Anti-pattern | Found? | Location | Severity |
|--------------|--------|----------|----------|
| Free-text where structured input would work | **YES** — POS `category` (`pos-editor:941`); `notes` everywhere; vendor `area`, `phone`, `email`, `gstin` etc. (judgment call: identity-of-vendor metadata is reasonably free-text) | `*-editor/index.html` | **MEDIUM** — POS `category` is the real one. NCH categories are bounded ({chai, snacks, biscuits, …}). Should be a dimension. |
| Inline data copies that should be FK | **YES** — pre-cascade legacy supplier rows `{name, abbr}` w/o `vendor_code`. Migration path (`enrichVendorRefs`) handles read; owner-walk is needed to convert. | `rm-sourcing.js:336-365` | LOW — handled with grace |
| Magic strings that should be enums | **YES** — `V_SHAPES = ['V1a','V1b','V2','V3','V4','V5']` in editor (`rm-sourcing-editor:762`) is leftover from pre-v8 grammar. No longer drives anything but still listed. | `rm-sourcing-editor/index.html:762` | LOW — stale leftover, prune |
| Schema-level overrides that should be data | NO | — | — |
| Validators at one layer but not another | **YES** — see Phase 4 table. RM constraints exist API-only, not DB. | `migrations/0001` | **HIGH** — biggest single gap |
| Cascade logic per-entity instead of generalized | **YES** — `rewriteVendorCodeRefs` is hand-rolled, walks loose/branded/in-house. If a 4th tree shape is added, this function silently misses. | `vendors.js:216-238` | LOW — only one cascade function exists today |
| Audit trail | **MISSING** — no history table for entity rings. Doctrine L2 specifies "audit trails on every write". | All migrations | **MEDIUM** — would matter once Action ring lands and "who decided what" becomes important |
| Hard-coded USERS in every API file | **YES** — `USERS` map duplicated across `rm-sourcing.js`, `vendors.js`, `pos-products.js`. Adding a new user = 3 files. | All API files | **LOW** — small N, but dependency injection or a single auth helper would be cleaner. Refactor candidate. |

---

## Prioritized Backlog

### P0 — Must fix before declaring foundation complete

1. **Add DB CHECK constraints to `rm_sourcing_profiles`** (15 min)
   - `brand_prefix IN ('HN','NCH','HE')`
   - `rm_type IN ('AM','AS','DM','DS')`
   - `length(item_abbr) BETWEEN 2 AND 4` (or 3 if you tighten API too)
   - `usage_profile GLOB '[PRO][pro]*'` plus length ≤ 3
   - `sourcing_profile GLOB '[LB][lbi]*'` (note: requires *uppercase L or B as primary*, excluding I-primary; doubles down on the I-only rule)
   - **Migration 0008** following the recreate-table pattern from 0005/0006 since SQLite can't ALTER ADD CHECK.
   - **Reasoning:** L2 layer of doctrine says schema mirrors dimensions. Today RM table doesn't. Direct D1 writes bypass everything.

2. **Decide I-primary semantics, then enforce uniformly** (10 min)
   - Doctrine reads: "RMs must be purchasable. I-only items are states of production."
   - Two clean choices:
     - **A:** Reject all I-primary (`I`, `Il`, `Ib`, `Ilb`) — most aligned with doctrine's "states layer" deferral
     - **B:** Allow I-primary as "primarily made in-house, can be bought as fallback" — less doctrinally pure
   - **Recommendation: A.** Update `validateSourcingProfile` to reject `profile[0] === 'I'`. Update editor `PROFILE_OPTIONS` to drop `Il`, `Ib`, `Ilb`.

3. **Tighten `rm_type` regex** (1 min)
   - Change `^[ADP][MS]$` → `^[AD][MS]$`. Also add to DB CHECK in P0.1.

### P1 — Next phase (Action ring entry)

4. **Cascade integrity: replace LIKE-based scan with structural query.** Either store vendor refs as a separate table (proper relational FK) or always scan all rows + parse JSON in JS (slower but bytes-format-independent). Hybrid: keep LIKE for fast pre-filter, then verify each match by parsing.

5. **Recipe-ring FK design.** Action ring will introduce `pos_recipes` (or rename `rm_recipes` v2) with FK on `pos_code` + `rm_code`. Add cascade to POS PUT and RM PUT. Plan migration *now* even if not landing yet — keeps the design deliberate.

6. **Audit trail.** Add `entity_history` table or per-entity `*_history` tables. Capture old/new for every PUT/DELETE, with `actor`, `at`. Doctrine L2 explicitly requires.

7. **POS shape×brand constraint** — either lift the doc-only "S6-S8 are HE-side" rule (recommended; just a description aid) OR encode in CHECK + API. Pick one, document the choice.

### P2 — Future

8. **Brand catalog as 5th entity** — once a brand-level mutation actually happens (rebranding event). Today low-frequency.
9. **Outlet dimension** — once 2nd NCH outlet opens or Smart Hotel launches.
10. **Generalized cascade engine** — once a 2nd cascade pattern emerges (POS PUT + recipe + sales-events). Premature today.
11. **States entity ring** — when an actual semi-finished state matters in operations (decoction batches, marination batches with named states).
12. **Constraint-set spec doc** — formalize step 7 of the build discipline. Compute |O ∩ C| explicitly. Today the constraint set is implied across validators; a single source-of-truth spec would help future contributors and serves as the "grammar dictionary" for agents.

---

## Final Verdict

### Is the foundation doctrinally complete for current scope (RM + Vendor + POS in RM-purchase domain)?

**No, but close.** The architectural grammar is doctrinally sound (especially Vendor v8). The cascade keystone works. The three-ring discipline is being respected (Action/Event correctly deferred).

But **three P0 gaps** mean the system can today record codes that violate doctrine — `HN-PM-O-Il-XYZ` would pass API + DB. That breaks Guarantee G2 ("no data wrong"). Fix those and the foundation is closed.

**Estimated time to P0-fix: 30 minutes.** Recreate-table migration + 3 lines of validator change + 3 PROFILE_OPTIONS array entries to drop.

### What's the next architectural milestone?

After P0:

1. **Owner walk-through** — refine 24 vendors + 55 RMs + 78 POS products through editors. Migrate legacy supplier refs to canonical FK.
2. **Action ring opens.** First action: RM purchase event. References RM (rm_code) + Vendor (vendor_code) + Quantity + Date + Receiver. Composes into Purchase Event.
3. **Recipe entity** (sub-entity of POS, or its own ring depending on doctrine reading). FK to pos_code + rm_code; the constraint that S10 has zero recipes; the constraint that S3 has fixed proportions.
4. **States entity ring** — when malai, decoction, marinated chicken needs a name and audit trail.

The owner can defer all of this safely as long as P0 gaps are closed.

---

*Audit complete. No code or data modified.*
