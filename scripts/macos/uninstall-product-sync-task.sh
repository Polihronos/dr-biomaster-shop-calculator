#!/bin/bash

set -euo pipefail

LABEL="com.drbiomaster.product-sync"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$UID"

if /bin/launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
	/bin/launchctl bootout "$DOMAIN/$LABEL"
fi

if [[ -f "$PLIST_PATH" ]]; then
	rm "$PLIST_PATH"
fi

printf 'Removed the scheduled job. Its private checkout and logs were kept for recovery.\n'
