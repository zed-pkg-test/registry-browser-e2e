#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${TARGET_URL:?TARGET_URL is required}"
cd "$root"; npm install; npx playwright install --with-deps; npm run test:browser
