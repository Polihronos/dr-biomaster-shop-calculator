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

## Automatic product sync on macOS

The macOS task performs one successful catalogue check per calendar day. It normally starts at 08:00. If the Mac is asleep or powered off then, it catches up after wake or the next login. Failed checks retry quietly once per hour; after a successful check, later triggers exit immediately without network access or a new log.

The maintained scripts stay in this repository. Because macOS blocks background jobs from reading the Documents folder, the installer places a private runtime copy and managed Git checkout in `~/Library/Application Support/DrBiomasterProductSync` and logs in `~/Library/Logs/DrBiomasterProductSync`. This avoids granting broad Full Disk Access and keeps unfinished project files isolated. The job has no UI or notifications and runs with low CPU and I/O priority.

Install or refresh the task:

```sh
bash scripts/macos/install-product-sync-task.sh
```

Remove the scheduled task without deleting its recovery checkout or logs:

```sh
bash scripts/macos/uninstall-product-sync-task.sh
```

When catalogue data changes, the task verifies types, builds the site, rechecks live prices, commits only `src/lib/products.ts`, and pushes it to `main`. The normal GitHub Pages workflow then deploys the update.
