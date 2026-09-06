#!/bin/sh
set -eu

REPOSITORY="qoherent/sigil"
DEFAULT_VERSION="__SIGIL_VERSION__"
VERSION="${SIGIL_VERSION:-$DEFAULT_VERSION}"
INSTALL_ROOT="${SIGIL_INSTALL_DIR:-$HOME/.local/share/sigil}"
BIN_DIR="${SIGIL_BIN_DIR:-$HOME/.local/bin}"

fail() { echo "sigil installer: $*" >&2; exit 1; }
command -v tar >/dev/null 2>&1 || fail "tar is required"
command -v curl >/dev/null 2>&1 || [ -n "${SIGIL_ARCHIVE_PATH:-}" ] || fail "curl is required"

case "$(uname -s)" in
  Darwin) os="apple-darwin" ;;
  Linux) os="unknown-linux-gnu" ;;
  *) fail "unsupported operating system: $(uname -s)" ;;
esac
case "$(uname -m)" in
  arm64|aarch64) arch="aarch64" ;;
  x86_64|amd64) arch="x86_64" ;;
  *) fail "unsupported architecture: $(uname -m)" ;;
esac

archive="${SIGIL_ARCHIVE_PATH:-}"
checksums="${SIGIL_CHECKSUMS_PATH:-}"
if [ -n "$archive" ] || [ -n "$checksums" ]; then
  [ -n "$archive" ] && [ -n "$checksums" ] || fail "SIGIL_ARCHIVE_PATH and SIGIL_CHECKSUMS_PATH must be supplied together"
  [ -f "$archive" ] || fail "local archive does not exist"
  [ -f "$checksums" ] || fail "local checksums file does not exist"
else
  asset="sigil-${arch}-${os}.tar.gz"
  base="https://github.com/${REPOSITORY}/releases/download/cli-v${VERSION}"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT HUP INT TERM
  archive="$tmp/$asset"
  checksums="$tmp/checksums.txt"
  curl -fL --retry 3 -o "$archive" "$base/$asset"
  curl -fL --retry 3 -o "$checksums" "$base/checksums.txt"
fi

asset_name="$(basename "$archive")"
expected="$(awk -v name="$asset_name" '$2 == name { print $1 }' "$checksums")"
[ -n "$expected" ] || fail "checksum entry for $asset_name is missing"
if command -v sha256sum >/dev/null 2>&1; then actual="$(sha256sum "$archive" | awk '{print $1}')"; else actual="$(shasum -a 256 "$archive" | awk '{print $1}')"; fi
[ "$actual" = "$expected" ] || fail "checksum verification failed for $asset_name"

if [ -z "${tmp:-}" ]; then tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT HUP INT TERM; fi
tar -tzf "$archive" | while IFS= read -r entry; do
  case "$entry" in
    /*|../*|*/../*|*"/.."|*"//"*) fail "archive contains an unsafe path: $entry" ;;
  esac
done
tar -xzf "$archive" -C "$tmp"
source_dir="$tmp/sigil-$VERSION"
[ -d "$source_dir" ] || fail "archive does not contain sigil-$VERSION"
[ -x "$source_dir/bin/sigil" ] || fail "archive does not contain bin/sigil"
[ -f "$source_dir/lib/sigil/runtime/manifest.json" ] || fail "archive has no runtime manifest"
[ -f "$source_dir/lib/sigil/runtime/egglog/sigil-semantic-engine" ] || fail "archive has no native engine"
[ -f "$source_dir/lib/sigil/runtime/typescript/tsc" ] || fail "archive has no TypeScript runtime"
if find "$source_dir" -type l -print -quit | grep . >/dev/null 2>&1; then fail "archive contains a symbolic link"; fi
if command -v sha256sum >/dev/null 2>&1; then manifest_hash="$(sha256sum "$source_dir/lib/sigil/runtime/manifest.json" | awk '{print $1}')"; else manifest_hash="$(shasum -a 256 "$source_dir/lib/sigil/runtime/manifest.json" | awk '{print $1}')"; fi
manifest_prefix="$(printf '%.16s' "$manifest_hash")"
destination="$INSTALL_ROOT/versions/${VERSION}-${manifest_prefix}"
mkdir -p "$INSTALL_ROOT/versions" "$BIN_DIR"
if [ -e "$destination" ]; then
  [ -f "$destination/lib/sigil/runtime/manifest.json" ] || fail "existing installation is corrupt"
  if command -v sha256sum >/dev/null 2>&1; then existing_hash="$(sha256sum "$destination/lib/sigil/runtime/manifest.json" | awk '{print $1}')"; else existing_hash="$(shasum -a 256 "$destination/lib/sigil/runtime/manifest.json" | awk '{print $1}')"; fi
  [ "$existing_hash" = "$manifest_hash" ] || fail "existing installation has a different runtime manifest"
else
  mv "$source_dir" "$destination"
fi
"$destination/bin/sigil" doctor --format json >/dev/null || fail "runtime doctor failed; existing installation remains selected"
wrapper="$BIN_DIR/.sigil-wrapper.$$"
trap 'rm -rf "$tmp" "$wrapper"' EXIT HUP INT TERM
cat >"$wrapper" <<EOF
#!/bin/sh
exec "$destination/bin/sigil" "\$@"
EOF
chmod +x "$wrapper"
mv -f "$wrapper" "$BIN_DIR/sigil"
echo "Installed Sigil $VERSION to $destination"
