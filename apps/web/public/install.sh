#!/usr/bin/env sh
# scaffold-day installer (S49).
#
# Usage:
#   curl -fsSL https://day.scaffold.at/install.sh | sh
#   curl -fsSL https://day.scaffold.at/install.sh | sh -s -- --version v0.1.0
#   curl -fsSL https://day.scaffold.at/install.sh | sh -s -- --bin-dir /usr/local/bin
#
# What it does:
#   1. Detects OS + arch and picks the matching binary from the latest
#      GitHub Release of scaffold-at/day (or a pinned --version).
#   2. Downloads to a temp dir and verifies the binary runs (--version).
#   3. Installs into --bin-dir (default: ~/.local/bin or /usr/local/bin
#      if writable). Adds a one-line PATH hint if the dir is missing.
#   4. macOS: clears the quarantine xattr so Gatekeeper does not block
#      the unsigned v0.1 binary. (Codesigning lands post-v0.1.)
#
# This script is intentionally POSIX sh; no bash-isms.

set -eu

REPO="scaffold-at/day"
BIN_NAME="scaffold-day"
DEFAULT_BIN_DIR_USER="$HOME/.local/bin"
DEFAULT_BIN_DIR_SYSTEM="/usr/local/bin"

VERSION=""           # empty = latest
BIN_DIR=""           # empty = auto

# ─── arg parse ─────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --version)
      VERSION="$2"; shift 2 ;;
    --version=*)
      VERSION="${1#*=}"; shift ;;
    --bin-dir)
      BIN_DIR="$2"; shift 2 ;;
    --bin-dir=*)
      BIN_DIR="${1#*=}"; shift ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# //;s/^#//'; exit 0 ;;
    *)
      echo "install.sh: unknown argument '$1'" >&2; exit 2 ;;
  esac
done

# ─── platform detect ──────────────────────────────────────────────
uname_s=$(uname -s 2>/dev/null || echo unknown)
uname_m=$(uname -m 2>/dev/null || echo unknown)

case "$uname_s" in
  Darwin) os=darwin ;;
  Linux)  os=linux ;;
  *) echo "install.sh: unsupported OS '$uname_s' (Tier 1: macOS arm64, Linux x64)." >&2; exit 1 ;;
esac

case "$uname_m" in
  arm64|aarch64) arch=arm64 ;;
  x86_64|amd64)  arch=x64 ;;
  *) echo "install.sh: unsupported arch '$uname_m'." >&2; exit 1 ;;
esac

# Tier 1 v0.1: macOS arm64 + Linux x64.
case "$os/$arch" in
  darwin/arm64) asset="${BIN_NAME}-darwin-arm64" ;;
  linux/x64)    asset="${BIN_NAME}-linux-x64" ;;
  *)
    echo "install.sh: $os/$arch is not a Tier 1 target for v0.1." >&2
    echo "  Tier 1: darwin/arm64 (macOS Apple Silicon), linux/x64 (Intel/AMD)." >&2
    echo "  File a 'platform support' issue at https://github.com/${REPO}/issues if you need another." >&2
    exit 1 ;;
esac

# ─── resolve version ───────────────────────────────────────────────
if [ -z "$VERSION" ]; then
  echo "install.sh: resolving latest release of ${REPO}..."
  # GitHub redirects /releases/latest to /releases/tag/<tag>; we follow
  # to read the tag without needing curl-jq.
  resolved=$(curl -fsLI -o /dev/null -w '%{url_effective}' \
    "https://github.com/${REPO}/releases/latest" 2>/dev/null || true)
  VERSION=$(printf '%s\n' "$resolved" | sed -n 's|.*/releases/tag/||p')
  if [ -z "$VERSION" ]; then
    echo "install.sh: could not resolve latest version. Pass --version v0.1.0 explicitly." >&2
    exit 1
  fi
fi

URL="https://github.com/${REPO}/releases/download/${VERSION}/${asset}"
echo "install.sh: target ${asset} ${VERSION}"

# ─── pick install dir ──────────────────────────────────────────────
if [ -z "$BIN_DIR" ]; then
  if [ -w "$DEFAULT_BIN_DIR_SYSTEM" ] 2>/dev/null; then
    BIN_DIR="$DEFAULT_BIN_DIR_SYSTEM"
  else
    BIN_DIR="$DEFAULT_BIN_DIR_USER"
  fi
fi
mkdir -p "$BIN_DIR"

# ─── download + verify + install ──────────────────────────────────
tmp=$(mktemp -d 2>/dev/null || mktemp -d -t scaffold-day)
trap 'rm -rf "$tmp"' EXIT

dest_tmp="${tmp}/${BIN_NAME}"
echo "install.sh: downloading ${URL}"
if ! curl -fsSL "$URL" -o "$dest_tmp"; then
  echo "install.sh: download failed. Check that ${VERSION} has a ${asset} asset:" >&2
  echo "  https://github.com/${REPO}/releases/tag/${VERSION}" >&2
  exit 1
fi
chmod +x "$dest_tmp"

# macOS quarantine — v0.1 ships unsigned binaries; Gatekeeper would
# otherwise refuse to launch via /usr/local/bin. xattr is a best-effort
# clear; ignore failures so the script still works on Linux.
if [ "$os" = "darwin" ]; then
  xattr -d com.apple.quarantine "$dest_tmp" 2>/dev/null || true
fi

# Sanity check before moving into PATH.
if ! out=$("$dest_tmp" --version 2>&1); then
  echo "install.sh: downloaded binary did not run cleanly:" >&2
  echo "  $out" >&2
  exit 1
fi
echo "install.sh: $out"

dest="${BIN_DIR}/${BIN_NAME}"
mv "$dest_tmp" "$dest"
echo "install.sh: installed → $dest"

# ─── PATH hint ─────────────────────────────────────────────────────
case ":${PATH:-}:" in
  *":${BIN_DIR}:"*) ;;
  *)
    echo
    echo "install.sh: NOTE — '${BIN_DIR}' is not on your PATH."
    echo "  Add this to your shell rc (zsh/bash):"
    echo "    export PATH=\"${BIN_DIR}:\$PATH\""
    ;;
esac

# ─── next steps ────────────────────────────────────────────────────
cat <<EOF

Next steps:
  scaffold-day init                # create ~/.scaffold-day + balanced policy
  scaffold-day today --tz $(date +%Z 2>/dev/null || echo UTC)
  scaffold-day docs --for-ai       # AI-readable surface dump
EOF
