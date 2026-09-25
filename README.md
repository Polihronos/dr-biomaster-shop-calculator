# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project
npx sv create my-app
```

To recreate this project with the same configuration:

```sh
# recreate this project
npx sv@0.16.1 create --template minimal --types ts --install npm shop-calculator
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.

## Automatic catalogue sync in the cloud

Status (25 September 2026): the snapshot service is deployed at `https://biomaster-catalogue.polihronovnikola.workers.dev/catalogue` on the confirmed Workers Free ($0) plan. Its scheduled handler fetched and stored all 105 products in the free `biomaster-catalogue-snapshots` KV namespace. The timer-triggered refresh and complete Actions/Pages run are being verified. GitHub's `CATALOGUE_RELAY_URL` variable points to this service. The Mac updater remains enabled in parallel as an independent fallback, as requested.

Direct source requests from the tested GitHub and Google Apps Script runtimes were blocked. The earlier `google-catalogue.gs` is unused; no Google trigger or relay deployment is active. The Cloudflare Worker only reads the public product endpoint, accepts bounded page numbers, and has no Google account access, website administrator credentials, or paid services.

`.github/workflows/sync-products.yml` runs on standard GitHub-hosted Ubuntu runners, which are free for this public repository. Its first daily slot is 05:23 UTC (08:23 in Bulgarian summer time, 07:23 in winter). Later hourly slots through 23:23 UTC retry a failed day; they skip fetching after a successful run. GitHub schedules can be delayed. The workflow can also be started manually from Actions → Daily product sync.

Cloudflare runs `scripts/cloud/catalogue-worker.mjs` every 15 minutes; `scripts/cloud/wrangler.jsonc` records its binding and schedule. The scheduler fetches every page from the fixed public source, validates counts and unique product IDs, then atomically replaces the complete KV snapshot. HTTP requests only read that snapshot and cannot initiate source requests or writes. At 96 snapshot writes per day this is within the free KV allowance. A failed refresh preserves the previous snapshot, and snapshots older than 30 minutes are rejected.

The GitHub job reads the public snapshot, rejects stale evidence, mixed snapshot IDs and inconsistent pagination totals, checks prices and public promotion terms, runs the focused catalogue tests and type/build checks, commits only `src/lib/products.ts`, and deploys the validated build to GitHub Pages in the same workflow. This explicit deployment is necessary because pushes using `GITHUB_TOKEN` do not trigger the normal push workflow. A daily `catalogCheckedAt` date records completed source checks and keeps the repository active even when prices do not change. Failed or incomplete source requests never replace the published catalogue.

The importer, `npm run check:prices`, and the calculator's “Свери цени” share `src/lib/catalogue.ts`. They compare current and regular prices, sale flags, promotion rules, public offer text, and product additions/removals. Explicit “take X, pay Y” offers and stated quantity percentage thresholds are calculated from public descriptions, including banner alternative text. Ordinary and package sale prices come from the Store API and are not discounted twice.

Unclear offers, image-only terms, coupons, customer/cart conditions, conflicting rules, and unverified combinations are flagged for review rather than guessed. The cloud run publishes those flags and lists them in its Actions summary; the calculator keeps them visible after a live check. Hidden rules not exposed in the public catalogue cannot be detected. `npm run check:prices` fails on unresolved offers; `npm run check:prices -- --allow-review` permits explicit review flags but still fails on catalogue mismatches.

## Legacy macOS updater

The Mac updater remains active in parallel with the cloud updater as an independent fallback. Do not disable its launch agent as part of cloud setup. Keep its private checkout in `~/Library/Application Support/DrBiomasterProductSync` and logs in `~/Library/Logs/DrBiomasterProductSync` for recovery. Once the permanent relay and deployment are verified, the cloud updater will not need this Mac or Codex running. The Mac validation permits explicit review flags while still rejecting price or catalogue mismatches.

The legacy task normally runs at 08:00, catches up after wake/login, and retries failures hourly. Its installer and removal commands remain:

```sh
bash scripts/macos/install-product-sync-task.sh
bash scripts/macos/uninstall-product-sync-task.sh
```
