#!/usr/bin/env bash
set -euo pipefail

if [[ $# != 3 ]]; then
  echo "Usage: $0 VERSION BINARY_DIRECTORY OUTPUT_DIRECTORY" >&2
  exit 1
fi

version=$1
if [[ ! $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo 'Version must have the form 1.2.3.' >&2
  exit 1
fi

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_dir=$(cd -- "$script_dir/../.." && pwd)
binary_dir=$2
output_dir=$3

for name in Logtext logtext-import-logseq; do
  binary="$binary_dir/$name"
  if [[ ! -f $binary ]]; then
    echo "Missing binary: $binary" >&2
    exit 1
  fi
  if ! header=$(LC_ALL=C readelf --file-header -- "$binary" 2>/dev/null) ||
    [[ $header != *'Advanced Micro Devices X86-64'* ]]; then
    echo "Expected an x86_64 ELF binary: $binary" >&2
    exit 1
  fi
done

desktop-file-validate "$script_dir/logtext.desktop"
build_dir=$(mktemp -d -t logtext-arch.XXXXXXXX)
trap 'rm -rf -- "$build_dir"' EXIT
install -m644 "$script_dir/PKGBUILD" "$script_dir/logtext.desktop" "$build_dir/"
install -m755 "$binary_dir/Logtext" "$binary_dir/logtext-import-logseq" "$build_dir/"
install -m644 "$repo_dir/src-tauri/icons/128x128@2x.png" "$build_dir/logtext.png"
install -m644 "$repo_dir/LICENSE" "$build_dir/LICENSE"
mkdir -p -- "$output_dir"
output_dir=$(cd -- "$output_dir" && pwd)

cd -- "$build_dir"
LOGTEXT_VERSION="$version" PKGDEST="$output_dir" PKGEXT='.pkg.tar.zst' \
  makepkg --nodeps --noconfirm
