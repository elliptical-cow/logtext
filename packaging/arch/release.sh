#!/usr/bin/env bash
# Run as root inside the Arch release container, never on the host.
set -euo pipefail

if [[ $# != 1 || ! $1 =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Usage: $0 VERSION (for example 1.2.3)" >&2
  exit 1
fi
export LOGTEXT_VERSION=$1
cd /workspace
# Use the package's dependency list so validation matches what pacman installs.
source packaging/arch/PKGBUILD
pacman -Syu --noconfirm --needed "${depends[@]}" desktop-file-utils python

for binary in Logtext logtext-import-logseq; do
  libraries=$(ldd "src-tauri/target/release/$binary")
  if [[ $libraries == *'not found'* ]]; then
    printf 'Unresolved Arch runtime libraries for %s:\n%s\n' "$binary" "$libraries" >&2
    exit 1
  fi
done

# Match the owner of the mounted output directory; do not chown host files.
useradd --create-home --uid "$(stat -c %u /out)" builder
su --shell /bin/bash builder -c '
  set -euo pipefail
  python3 packaging/arch/test_package.py
  bash packaging/arch/build.sh "$LOGTEXT_VERSION" src-tauri/target/release /out
'
