#!/bin/bash

set -euo pipefail

LABEL="com.drbiomaster.product-sync"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_RUNTIME="$SCRIPT_DIR/product-sync-runtime.sh"
TEMPLATE="$SCRIPT_DIR/$LABEL.plist.template"
APP_SUPPORT="$HOME/Library/Application Support/DrBiomasterProductSync"
LOG_DIR="$HOME/Library/Logs/DrBiomasterProductSync"
INSTALLED_RUNTIME="$APP_SUPPORT/product-sync-runtime.sh"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$UID"
TIME="${1:-08:00}"

if [[ ! "$TIME" =~ ^([01][0-9]|2[0-3]):([0-5][0-9])$ ]]; then
	printf 'Usage: %s [HH:MM]\n' "$0" >&2
	exit 2
fi

HOUR="${BASH_REMATCH[1]}"
MINUTE="${BASH_REMATCH[2]}"
HOUR="$((10#$HOUR))"
MINUTE="$((10#$MINUTE))"

for source_file in "$SOURCE_RUNTIME" "$TEMPLATE"; do
	if [[ ! -f "$source_file" ]]; then
		printf 'Missing source file: %s\n' "$source_file" >&2
		exit 1
	fi
done

xml_escape() {
	printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

sed_escape() {
	printf '%s' "$1" | sed -e 's/[&|]/\\&/g'
}

mkdir -p "$APP_SUPPORT" "$LOG_DIR" "$HOME/Library/LaunchAgents"
chmod 700 "$APP_SUPPORT" "$LOG_DIR"
/usr/bin/install -m 700 "$SOURCE_RUNTIME" "$INSTALLED_RUNTIME"

home_xml="$(sed_escape "$(xml_escape "$HOME")")"
support_xml="$(sed_escape "$(xml_escape "$APP_SUPPORT")")"
runtime_xml="$(sed_escape "$(xml_escape "$INSTALLED_RUNTIME")")"
launch_log_xml="$(sed_escape "$(xml_escape "$LOG_DIR/launchd.log")")"
launch_error_xml="$(sed_escape "$(xml_escape "$LOG_DIR/launchd-error.log")")"
plist_tmp="$PLIST_PATH.$$"

sed \
	-e "s|__HOME__|$home_xml|g" \
	-e "s|__APP_SUPPORT__|$support_xml|g" \
	-e "s|__RUNTIME_SCRIPT__|$runtime_xml|g" \
	-e "s|__LAUNCH_LOG__|$launch_log_xml|g" \
	-e "s|__LAUNCH_ERROR_LOG__|$launch_error_xml|g" \
	-e "s|__HOUR__|$HOUR|g" \
	-e "s|__MINUTE__|$MINUTE|g" \
	"$TEMPLATE" > "$plist_tmp"

/usr/bin/plutil -lint "$plist_tmp" >/dev/null
chmod 600 "$plist_tmp"

if /bin/launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
	/bin/launchctl bootout "$DOMAIN/$LABEL"
fi

mv "$plist_tmp" "$PLIST_PATH"
/bin/launchctl bootstrap "$DOMAIN" "$PLIST_PATH"
/bin/launchctl enable "$DOMAIN/$LABEL"

printf 'Installed %s. It runs at %02d:%02d, catches up after login, and retries hourly only until the day succeeds.\n' "$LABEL" "$HOUR" "$MINUTE"
