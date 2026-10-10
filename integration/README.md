# MobiQuant integration

This fork preserves Wealthfolio's AGPL license and uses the published v3.9.1 Rust engine as its first deployment baseline. The custom React entry is `apps/frontend/mobiquant.html`; it reuses the upstream UI but does not load add-ons, AI, device sync, brokerage cloud sync or the original application shell.

## Private deployment

The Germany machine is ARM64 with 2 CPUs, approximately 4 GiB RAM and 21 GiB free disk. On 2026-10-05 US/Pacific, available memory was 2.1 GiB; CPU was 92–94% idle, with no ongoing swap-in/out or memory pressure. Runtime capacity still requires measuring the actual deployed workload.

The image is the published v3.9.1 engine binary copied onto a supported Alpine base (`Dockerfile.runtime`); the upstream image's Alpine 3.19 carried a high-severity musl advisory, and the upstream web UI and Connect endpoint setting are left out. The container runs as the dedicated `mq-ledger` user, has a read-only root, no Linux capabilities, a 512 MiB memory limit and a 0.5 CPU limit.

It sits only on an internal Docker network at the fixed address 192.168.193.2: no route out and no external DNS. Docker never publishes ports for such a container, so `mobiquant-wealthfolio-proxy.socket` listens on 127.0.0.1:8793 and forwards to it with `systemd-socket-proxyd`. Both properties were checked with a disposable container: the host reaches `/api/v1/healthz`, while a container on that network cannot connect out or resolve names. A new database requires SQLCipher encryption. The master key and Argon2id hash live in `/etc/mobiquant-wealthfolio.env`, never this repository. Keep the key separately protected from data backups.

MobiQuant is the only browser entry: `https://mobiquant.xyz/real-assets/`, relayed by the main site's proxy over the tailnet, with username, password and a one-time code. The page is built with relative URLs (`base: "./"`) and the MobiQuant server injects the `<base>` for that prefix. Its existing authentication guards both the new frontend and narrow ledger bridge routes. The raw Rust API is not browser-proxied. Backend passwords, JWTs and profile scopes remain on the server. Synthetic validation uses a separate disposable database, never production accounts.

The frontend reads `/api/assets/context`; this collector output remains the observed-equity authority. An opening asks for five things at once (`context`, `history`, `wealthfolio/status`, `yields`, `finance`): the page is drawn when `context` and `history` are in, which is what its first screen shows, and the other three are put in place as they arrive; nothing of a round is shown before its context or without it (`refresh()` in `apps/frontend/src/mobiquant/portfolio.tsx`). The trade ledger (`trades?days=365`) is read when its tab is opened. Each request crosses to the asset server in Germany, so their number and order are what an opening costs; the figures are in MobiQuant's `web/docs/real-assets-runbook.md`. Ledger mirroring accepts only owned, included, enabled, fresh, complete snapshots whose independently priced components reconcile to observed equity. Derivatives, overlapping DeFi components, unpriced tokens and unsupported decimal precision are refused. Empty complete snapshots clear previous holdings.

The bridge follows what the engine actually does, verified against a disposable v3.9.1 server rather than a mock:

- The engine assigns account ids and ignores a supplied one. The bridge finds its account by the `mobiquantConnection` marker in the account's `meta` and creates it once.
- The engine keeps one asset per symbol and quote currency, shared by all accounts. Scopes of one exchange asset (spot, funding) are summed into one position. Chain-qualified tokens are refused for now: an unrelated token reusing a symbol would overwrite that day's shared price for the real asset. Wallet accounts therefore stay visible through the collector but are not mirrored until tokens get their own engine identity.
- A single `POST /snapshots` resolves the assets, stores the observed price as that date's manual quote and saves the holdings. Nothing is written before the engine accepts the snapshot. The observed price is sent in the `averageCost` field because that is the field the engine turns into the manual quote; the ledger's gain for these positions is therefore zero by construction and must not be read as performance.
- One snapshot per account per UTC date; a later observation on the same date replaces it.

The page also shows allocation by platform, class and asset merged across accounts, concentration observations, a derivatives exposure summary and a daily balance history, all computed by the MobiQuant collector (`/api/assets/context`, `/api/assets/history`). The history includes deposits and withdrawals and is labelled as a balance series.

Observed-holdings mode has no inferred cost basis, deposit history or audited return. The UI displays missing coverage and does not label balance changes as investment profit. Mirroring remains an explicit action; automatic full-history ingestion is not yet enabled.

The collector's existing credentials are encrypted separately, but its original observation database is not covered by the Rust engine's SQLCipher setting. Protect both databases and backups; do not describe the full deployment as encrypted at rest until collector storage protection is verified as well.

## Build and verification commands

The owner authorized installing after a security scan with no blocking finding. The upstream lockfile had 25 advisories (1 critical); patched versions are pinned through `pnpm.overrides`, the unused `shadcn` generator that carried unfixed ones is removed, and `pnpm audit` reports none. Install scripts stay disabled. `rmcp` 1.8.0 in the engine has two high-severity advisories; they are in the `/mcp` endpoint, which stays off (`WF_MCP_ENABLED=false`, verified 404).

```sh
pnpm install --frozen-lockfile --ignore-scripts
BUILD_TARGET=web pnpm --filter frontend exec vite build --config vite.mobiquant.config.ts
pnpm --filter frontend exec tsc -p tsconfig.mobiquant.json
BUILD_TARGET=web pnpm --filter frontend exec vitest run --config vitest.mobiquant.config.ts
pnpm --filter frontend exec eslint src/mobiquant
```

The build is performed on the local workstation, not the trading server, and `dist-mobiquant/` is committed so the server only fetches. Deploy committed source and build artifacts via Git fetch/pull only. Original Tencent stock services and the research/trading journal remain intact; Tencent never receives real crypto asset data.

The component can be served at `/portfolio?embed=1` in the Germany MobiQuant website. Only that endpoint permits same-origin framing; other private pages reject framing. Actual main-site replacement requires separately verifying the Germany dashboard entry and its stock/research routes. A standalone page must not be reported as a completed main-site migration.

## Server setup

Run once as root on the Germany machine, after `/opt/mobiquant-assets` is on a commit that contains the ledger bridge:

```sh
useradd --system --no-create-home --shell /usr/sbin/nologin mq-ledger
git clone --branch feature/mobiquant-portfolio-v3.9.1 https://github.com/0x43e96f/wealthfolio.git /opt/mobiquant-wealthfolio
cd /opt/mobiquant-wealthfolio/integration
/opt/mobiquant-assets/.venv/bin/python provision.py
docker compose --project-name mobiquant-wealthfolio --env-file /etc/mobiquant-wealthfolio.env build
ln -s "$PWD"/mobiquant-wealthfolio.service "$PWD"/mobiquant-wealthfolio-proxy.socket "$PWD"/mobiquant-wealthfolio-proxy.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now mobiquant-wealthfolio.service mobiquant-wealthfolio-proxy.socket
systemctl restart mobiquant-assets
```

`provision.py` is idempotent: it generates the ledger key, password hash and gateway password once, keeps a copy of the previous collector configuration and prints no secret. Updates are `git pull --ff-only` in both checkouts, a rebuild only when `Dockerfile.runtime` changed, then a restart of the unit that changed. Rollback: `systemctl disable --now` the three ledger units and restore `/etc/mobiquant-assets.env.before-wealthfolio`; the collector then serves its built-in page again.
