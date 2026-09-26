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

## Catalogue synchronization

The GitHub `Daily product sync` workflow and repository variable `CATALOGUE_RELAY_URL` were removed on 27 September 2026. There are no scheduled catalogue updates or retry jobs in GitHub Actions. The normal `Deploy to GitHub Pages` workflow remains active for changes pushed to `main`, including catalogue updates from the Mac.

The earlier cloud collection experiment was blocked by the source website's bot challenge. Its Cloudflare Worker/KV service and unused Google script were not removed as part of removing the GitHub job; neither supplies updates to this repository. The Mac remains the working automatic catalogue updater.

The importer, `npm run check:prices`, and the calculator's “Свери цени” share `src/lib/catalogue.ts`. They compare current and regular prices, sale flags, promotion rules, public offer text, and product additions/removals. Explicit “take X, pay Y” offers and stated quantity percentage thresholds are calculated from public descriptions, including banner alternative text. Ordinary and package sale prices come from the Store API and are not discounted twice.

Unclear offers, image-only terms, coupons, customer/cart conditions, conflicting rules, and unverified combinations are flagged for review rather than guessed. The importer reports those flags, and the calculator shows them after a live check. Hidden rules not exposed in the public catalogue cannot be detected. `npm run check:prices` fails on unresolved offers; `npm run check:prices -- --allow-review` permits explicit review flags but still fails on catalogue mismatches.

## macOS updater

The Mac updater remains active. Preserve its launch agent. Keep its private checkout in `~/Library/Application Support/DrBiomasterProductSync` and logs in `~/Library/Logs/DrBiomasterProductSync` for recovery. The Mac validation permits explicit review flags while still rejecting price or catalogue mismatches.

The task normally runs at 08:00, catches up after wake/login, and retries failures hourly. Its installer and removal commands remain:

```sh
bash scripts/macos/install-product-sync-task.sh
bash scripts/macos/uninstall-product-sync-task.sh
```
