#!/bin/sh
set -eu
if [ "$(uname -s)" != Darwin ]; then
  echo 'This setup script requires macOS.' >&2
  exit 1
fi
plugin_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
command -v node >/dev/null
command -v npm >/dev/null
command -v swift >/dev/null
node -e 'if (Number(process.versions.node.split(".")[0]) < 20) { console.error("Node.js 20+ required"); process.exit(1); }'
npm --prefix "$plugin_dir/mcp/xunji" ci --omit=dev --ignore-scripts
# Swift uses Security.framework directly: no key in process arguments or stdout.
exec /usr/bin/swift "$plugin_dir/mcp/xunji/scripts/keychain-credential.swift" set
