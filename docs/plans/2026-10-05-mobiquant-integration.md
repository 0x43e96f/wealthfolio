# MobiQuant Portfolio Integration Implementation Plan

**Goal:** Use the Wealthfolio fork as the private Portfolio foundation on Germany, retaining verified exchange and wallet collectors.

**Approved architecture:** A fixed-version ARM64 Rust engine runs on loopback behind authenticated MobiQuant routes. A separate React entry uses Wealthfolio UI components and reads canonical collector observations. Credentials stay in the collector vault. Missing history never becomes inferred investment profit. The existing Tencent host receives no crypto data. Website replacement remains conditional on the Germany entry being verified.

**Baseline:** Upstream release v3.9.1, commit 392f272c5b15a4af45dc2ff71dcbec474f47112a. Preserve AGPL license and upstream attribution.

## Tasks

- [x] Inspect source, create fork and isolate an integration branch.
- [x] Measure Germany resources and find a released ARM64 image.
- [x] Prepare a typed normalized-observation client and React Portfolio page with safe text rendering and explicit coverage. Frontend runtime validation remains pending.
- [x] Implement protected same-origin frontend serving and a restricted engine bridge in MobiQuant, with CSRF and no-store enforcement. Backend regression tests pass.
- [ ] Verify the real engine using disposable observed-holdings, failed-publication and clearing fixtures. Mock-transport regression tests pass; no synthetic production data is permitted.
- [ ] Build and test frontend only after the owner's explicit repository setup authorization.
- [x] Commit and push integration sources in both repositories. MobiQuant bridge: 62c6d73a; fork implementation: 34e273fe. Germany fetch remains part of the authorized deployment step.
- [ ] Deploy the engine with a pinned digest, non-root user, encrypted database, no public port, resource limits and no addon/AI/Connect access.
- [ ] Verify private HTTPS login, empty real accounts, denied anonymous/cross-site access and actual resource use.
- [ ] Integrate the verified component into the Germany MobiQuant website and preserve the original research/trading journal.

## Review Checklist

- All asset and ledger routes require MobiQuant authentication.
- Engine credentials, exchange keys and wallet addresses never appear in logs or source.
- No stock server receives crypto requests or data.
- Observed equity is counted once; notional positions are separate.
- Unknown valuation, cost basis or cash-flow coverage is explicit.
- Watch and duplicate accounts are excluded using the collector's authoritative inclusion flags.
- Ledger access rejects addons, cloud sync, arbitrary network providers, AI and unsafe database imports.
- Builds happen off the trading server; runtime has measured memory and CPU limits.
- Static assets are local; sensitive responses and PWA caches do not persist portfolio data.
- Main website migration is reported separately from standalone validation.

## Current validation

The MobiQuant backend suite covering asset collectors, the new bridge, authentication, CSRF, framing, traversal, portfolio, database and scheduler behavior passed 102 tests. Ruff and JavaScript syntax checks passed. Scoped Python and security reviews found no confirmed blocking issue after fixing empty-position clearing and interrupted quote/snapshot publication.

The frontend dependency install, TypeScript/Vite/Vitest checks and container run await the explicitly requested unfamiliar-repository setup authorization. The Germany service has not been updated, and the main website Portfolio has not yet been replaced. No live exchange credentials or owned wallet addresses were used in these tests.
