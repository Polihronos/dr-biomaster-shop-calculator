#!/bin/bash

set -euo pipefail

APP_SUPPORT="$HOME/Library/Application Support/DrBiomasterProductSync"
CHECKOUT_DIR="$APP_SUPPORT/checkout"
LOG_DIR="$HOME/Library/Logs/DrBiomasterProductSync"
LOCK_DIR="$APP_SUPPORT/sync.lock"
LAST_SUCCESS_FILE="$APP_SUPPORT/last-success-date"
DEPENDENCY_STATE="$APP_SUPPORT/package-lock.sha256"
PRODUCTS_FILE="src/lib/products.ts"
REMOTE_URL="https://github.com/Polihronos/dr-biomaster-shop-calculator.git"
EXPECTED_REMOTE="Polihronos/dr-biomaster-shop-calculator"
AUTO_COMMIT_MESSAGE="chore: sync product catalogue [macos-auto]"

CODEX_NODE_BIN="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
CODEX_FALLBACK_BIN="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback"
export PATH="/opt/homebrew/bin:/usr/local/bin:$CODEX_NODE_BIN:$CODEX_FALLBACK_BIN:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

mkdir -p "$APP_SUPPORT" "$LOG_DIR"
chmod 700 "$APP_SUPPORT" "$LOG_DIR" 2>/dev/null || true

today="$(date '+%Y-%m-%d')"
if [[ "$(cat "$LAST_SUCCESS_FILE" 2>/dev/null || true)" == "$today" ]]; then
	exit 0
fi

timestamp="$(date '+%Y%m%d-%H%M%S')"
log_path="$LOG_DIR/product-sync-$timestamp.log"
exec >>"$log_path" 2>&1

log() {
	printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

release_lock() {
	rm -f "$LOCK_DIR/pid"
	rmdir "$LOCK_DIR" 2>/dev/null || true
}

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
	lock_pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
	if [[ -n "$lock_pid" ]] && kill -0 "$lock_pid" 2>/dev/null; then
		log "Skipped: another product sync is already running."
		exit 0
	fi

	rm -f "$LOCK_DIR/pid"
	rmdir "$LOCK_DIR" 2>/dev/null || {
		log "Skipped: the sync lock could not be recovered safely."
		exit 75
	}
	mkdir "$LOCK_DIR"
fi

printf '%s\n' "$$" > "$LOCK_DIR/pid"
trap release_lock EXIT INT TERM

# Two launchd triggers can arrive together at login or wake.
if [[ "$(cat "$LAST_SUCCESS_FILE" 2>/dev/null || true)" == "$today" ]]; then
	exit 0
fi

require_command() {
	if ! command -v "$1" >/dev/null 2>&1; then
		log "Required command '$1' is unavailable; the job will retry later."
		exit 75
	fi
}

for command_name in git node shasum tar; do
	require_command "$command_name"
done

if command -v npm >/dev/null 2>&1; then
	PACKAGE_MANAGER="npm"
elif command -v pnpm >/dev/null 2>&1; then
	PACKAGE_MANAGER="pnpm"
else
	log "Neither npm nor pnpm is available; the job will retry later."
	exit 75
fi

if [[ ! -d "$CHECKOUT_DIR/.git" ]]; then
	if [[ -e "$CHECKOUT_DIR" ]]; then
		log "Stopped: the managed checkout path exists but is not a Git repository."
		exit 1
	fi

	log "Creating the private managed checkout."
	if ! git clone --quiet --branch main --single-branch "$REMOTE_URL" "$CHECKOUT_DIR"; then
		log "GitHub could not be reached; the job will retry later."
		exit 75
	fi
fi

cd "$CHECKOUT_DIR"

managed_remote_url="$(git remote get-url origin 2>/dev/null || true)"
case "$managed_remote_url" in
	https://github.com/${EXPECTED_REMOTE}.git|https://github.com/${EXPECTED_REMOTE}|git@github.com:${EXPECTED_REMOTE}.git)
		;;
	*)
		log "Stopped: the managed checkout points to an unexpected repository."
		exit 1
		;;
esac

checkout_exclude="$(git rev-parse --git-path info/exclude)"
if ! grep -Fqx '/pnpm-lock.yaml' "$checkout_exclude" 2>/dev/null; then
	printf '/pnpm-lock.yaml\n' >> "$checkout_exclude"
fi

if [[ "$(git branch --show-current)" != "main" ]]; then
	log "Stopped: the managed checkout is not on main."
	exit 1
fi

if ! git diff --cached --quiet; then
	log "Stopped: the managed checkout contains staged changes."
	exit 1
fi

if ! git diff --quiet; then
	changed_files="$(git diff --name-only)"
	if [[ "$changed_files" == "$PRODUCTS_FILE" ]]; then
		log "Recovering a catalogue left by an interrupted earlier run."
		git restore --worktree -- "$PRODUCTS_FILE"
	else
		log "Stopped: the managed checkout contains unexpected tracked changes."
		exit 1
	fi
fi

if ! git fetch --quiet origin main; then
	log "GitHub could not be reached or authenticated; the job will retry later."
	exit 75
fi

behind_count="$(git rev-list --count HEAD..origin/main)"
ahead_count="$(git rev-list --count origin/main..HEAD)"

if (( behind_count > 0 && ahead_count > 0 )); then
	log "Stopped: local main and origin/main have diverged."
	exit 1
fi

if (( behind_count > 0 )); then
	git merge --ff-only origin/main
fi

if (( ahead_count > 0 )); then
	unexpected_commits="$(git log --format=%s origin/main..HEAD | grep -Fvx "$AUTO_COMMIT_MESSAGE" || true)"
	if [[ -n "$unexpected_commits" ]]; then
		log "Stopped: the managed checkout contains an unexpected local commit."
		exit 1
	fi

	log "Retrying an automatic push interrupted earlier."
	git push origin HEAD:main
	printf '%s\n' "$today" > "$LAST_SUCCESS_FILE.tmp"
	mv "$LAST_SUCCESS_FILE.tmp" "$LAST_SUCCESS_FILE"
	exit 0
fi

dependency_hash="$(shasum -a 256 package-lock.json | awk '{print $1}')"
installed_hash="$(cat "$DEPENDENCY_STATE" 2>/dev/null || true)"

if [[ ! -x node_modules/.bin/vite || "$dependency_hash" != "$installed_hash" ]]; then
	log "Installing project dependencies because package-lock.json changed."
	if [[ "$PACKAGE_MANAGER" == "npm" ]]; then
		npm ci --no-audit --no-fund
	else
		pnpm import
		pnpm install --frozen-lockfile
	fi
	printf '%s\n' "$dependency_hash" > "$DEPENDENCY_STATE"
fi

log "Checking the complete live Dr Biomaster catalogue."
"$PACKAGE_MANAGER" run fetch:products

if git diff --quiet -- "$PRODUCTS_FILE"; then
	log "No product changes detected."
else
	unexpected_files="$(git diff --name-only | grep -Fvx "$PRODUCTS_FILE" || true)"
	if [[ -n "$unexpected_files" ]]; then
		log "Stopped: the catalogue fetch changed unexpected tracked files:"
		printf '%s\n' "$unexpected_files"
		exit 1
	fi

	restore_generated_catalogue=true
	validation_dir=""
	validation_parent="${TMPDIR:-/tmp}"
	validation_parent="${validation_parent%/}"

	remove_validation_dir() {
		if [[ -z "$validation_dir" ]]; then
			return
		fi

		case "$validation_dir" in
			"$validation_parent"/dr-biomaster-validation.*)
				rm -rf -- "$validation_dir"
				;;
			*)
				log "Refused to remove an unexpected validation path: $validation_dir"
				;;
		esac
		validation_dir=""
	}

	cleanup_generated_catalogue() {
		status=$?
		remove_validation_dir
		if (( status != 0 )) && [[ "$restore_generated_catalogue" == true ]]; then
			git restore --worktree -- "$PRODUCTS_FILE" >/dev/null 2>&1 || true
			log "The generated catalogue was restored after a failed check."
		fi
		release_lock
		exit "$status"
	}
	trap cleanup_generated_catalogue EXIT INT TERM

	log "Catalogue changed; validating it in a disposable directory."
	validation_dir="$(mktemp -d "$validation_parent/dr-biomaster-validation.XXXXXX")"
	git archive HEAD | tar -xf - -C "$validation_dir"
	mkdir -p "$validation_dir/$(dirname "$PRODUCTS_FILE")"
	cp "$PRODUCTS_FILE" "$validation_dir/$PRODUCTS_FILE"
	ln -s "$CHECKOUT_DIR/node_modules" "$validation_dir/node_modules"

	cd "$validation_dir"
	"$PACKAGE_MANAGER" run check
	"$PACKAGE_MANAGER" run build
	"$PACKAGE_MANAGER" run check:prices

	cd "$CHECKOUT_DIR"
	remove_validation_dir

	git add -- "$PRODUCTS_FILE"
	git commit -m "$AUTO_COMMIT_MESSAGE"
	restore_generated_catalogue=false
	git push origin HEAD:main
	trap release_lock EXIT INT TERM
	log "Product update committed, pushed, and queued for GitHub Pages deployment."
fi

success_tmp="$LAST_SUCCESS_FILE.$$"
printf '%s\n' "$today" > "$success_tmp"
mv "$success_tmp" "$LAST_SUCCESS_FILE"

log "Daily product check completed successfully."
find "$LOG_DIR" -type f -name 'product-sync-*.log' -mtime +14 -delete 2>/dev/null || true
