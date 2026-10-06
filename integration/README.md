# MobiQuant integration

This fork preserves Wealthfolio's AGPL license and uses the published v3.9.1 Rust engine as its first deployment baseline. The custom React entry is `apps/frontend/mobiquant.html`; it reuses the upstream UI but does not load add-ons, AI, device sync, brokerage cloud sync or the original application shell.

## Private deployment

The Germany machine is ARM64 with 2 CPUs, approximately 4 GiB RAM and 21 GiB free disk. On 2026-10-05 US/Pacific, available memory was 2.1 GiB; CPU was 92–94% idle, with no ongoing swap-in/out or memory pressure. Runtime capacity still requires measuring the actual deployed workload.

The container is bound only to 127.0.0.1:8793, runs UID 1000, has a read-only root, no Linux capabilities, a 512 MiB memory limit and a 0.5 CPU limit. Its network blocks outbound cloud access. A new database requires SQLCipher encryption. The master key and Argon2id hash live in `/etc/mobiquant-wealthfolio.env`, never this repository. Keep the key separately protected from data backups.

MobiQuant is the only browser entry, through private Tailscale HTTPS. Its existing authentication guards both the new frontend and narrow ledger bridge routes. The raw Rust API is not browser-proxied. Backend passwords, JWTs and profile scopes remain on the server. Synthetic validation uses a separate disposable database, never production accounts.

The frontend reads `/api/assets/context`; this collector output remains the observed-equity authority. Ledger mirroring accepts only owned, included, enabled, fresh, complete snapshots whose independently priced components reconcile to observed equity. Derivatives, overlapping DeFi components, unpriced tokens and unsupported decimal precision are refused. Empty complete snapshots clear previous holdings. Snapshot assets are versioned by observation content, so intermediate quote writes cannot revalue previous snapshots if the final publication fails. This creates additional historical asset versions; retention/compaction must preserve referenced observations before long-running ingestion.

Observed-holdings mode has no inferred cost basis, deposit history or audited return. The UI displays missing coverage and does not label balance changes as investment profit. Mirroring remains an explicit action; automatic full-history ingestion is not yet enabled.

The collector's existing credentials are encrypted separately, but its original observation database is not covered by the Rust engine's SQLCipher setting. Protect both databases and backups; do not describe the full deployment as encrypted at rest until collector storage protection is verified as well.

## Build authorization and commands

The owner's AGENTS.md requires explicit setup authorization for unfamiliar repositories. Dependency installation and build/test execution must wait for it.

After approval:

```sh
pnpm install --frozen-lockfile --ignore-scripts
BUILD_TARGET=web pnpm --filter frontend exec vite build --config vite.mobiquant.config.ts
pnpm --filter frontend exec tsc -p tsconfig.mobiquant.json
BUILD_TARGET=web pnpm --filter frontend exec vitest run --config vitest.mobiquant.config.ts
pnpm --filter frontend exec eslint src/mobiquant
```

The build is performed on the local workstation, not the trading server. Deploy committed source and build artifacts via Git fetch/pull only. Original Tencent stock services and the research/trading journal remain intact; Tencent never receives real crypto asset data.

The component can be served at `/portfolio?embed=1` in the Germany MobiQuant website. Only that endpoint permits same-origin framing; other private pages reject framing. Actual main-site replacement requires separately verifying the Germany dashboard entry and its stock/research routes. A standalone page must not be reported as a completed main-site migration.
