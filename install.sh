#!/bin/sh
# Litopys one-line installer.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/litopys-dev/litopys/main/install.sh | sh
#
# With environment overrides (place the assignment AFTER the pipe — variables
# set before `curl` only scope to curl, not to the piped shell):
#   curl -fsSL https://raw.githubusercontent.com/litopys-dev/litopys/main/install.sh | LITOPYS_VERSION=v0.1.1 sh
#
# Environment:
#   LITOPYS_VERSION       Release tag to install (default: newest release,
#                         including prereleases)
#   LITOPYS_INSTALL_DIR   Directory for the binary (default: ~/.local/bin)
#   LITOPYS_GRAPH_PATH    Graph root (default: ~/.litopys/graph)
#   LITOPYS_ENABLE_VIEWER Set to "1" to install+enable the systemd user unit
#                         for the web dashboard (requires systemd + lingering
#                         user session; Linux only)
#
# Exits 0 on success; non-zero on any failure. Idempotent — re-running
# updates the binary without touching an existing graph.

set -eu

REPO="litopys-dev/litopys"
GRAPH_DIRS="people projects systems concepts events lessons"

BOLD=$(printf '\033[1m' 2>/dev/null || printf '')
RESET=$(printf '\033[0m' 2>/dev/null || printf '')
YELLOW=$(printf '\033[33m' 2>/dev/null || printf '')
GREEN=$(printf '\033[32m' 2>/dev/null || printf '')
RED=$(printf '\033[31m' 2>/dev/null || printf '')

log() { printf '%s[litopys]%s %s\n' "$BOLD" "$RESET" "$1"; }
ok()  { printf '%s[litopys]%s %s\n' "$GREEN" "$RESET" "$1"; }
warn(){ printf '%s[litopys]%s %s\n' "$YELLOW" "$RESET" "$1"; }
die() { printf '%s[litopys]%s %s\n' "$RED" "$RESET" "$1" >&2; exit 1; }

need() {
  command -v "$1" >/dev/null 2>&1 || die "missing required tool: $1"
}

need curl
need uname
need mkdir
need chmod

# sha256sum on Linux, shasum on macOS. We probe at install time and pick the
# first one available — the verification step below uses whichever we found.
sha256_cmd=""
if command -v sha256sum >/dev/null 2>&1; then
  sha256_cmd="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
  sha256_cmd="shasum -a 256"
fi

# ---------------------------------------------------------------------------
# Platform detection
# ---------------------------------------------------------------------------

os_raw=$(uname -s 2>/dev/null | tr '[:upper:]' '[:lower:]')
arch_raw=$(uname -m 2>/dev/null)

case "$os_raw" in
  linux) os_tag="linux" ;;
  darwin) os_tag="darwin" ;;
  msys*|mingw*|cygwin*) os_tag="windows" ;;
  *) die "unsupported OS: $os_raw" ;;
esac

case "$arch_raw" in
  x86_64|amd64) arch_tag="x64" ;;
  aarch64|arm64) arch_tag="arm64" ;;
  *) die "unsupported arch: $arch_raw" ;;
esac

binary_name="litopys-${os_tag}-${arch_tag}"
if [ "$os_tag" = "windows" ]; then
  binary_name="${binary_name}.exe"
fi

# ---------------------------------------------------------------------------
# Resolve release tag
# ---------------------------------------------------------------------------

if [ -z "${LITOPYS_VERSION:-}" ]; then
  log "Resolving latest release..."
  # /releases/latest excludes prereleases and returns 404 when the only
  # tagged releases are alpha/beta/rc. Fall back to /releases (array of
  # all releases, newest first) and pick the first tag_name.
  LITOPYS_VERSION=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null \
    | grep -m 1 '"tag_name"' \
    | cut -d'"' -f 4 || true)
  if [ -z "$LITOPYS_VERSION" ]; then
    LITOPYS_VERSION=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases" 2>/dev/null \
      | grep -m 1 '"tag_name"' \
      | cut -d'"' -f 4 || true)
  fi
  if [ -z "$LITOPYS_VERSION" ]; then
    die "could not resolve latest release (rate-limited or no releases yet). Set LITOPYS_VERSION explicitly."
  fi
fi

url="https://github.com/${REPO}/releases/download/${LITOPYS_VERSION}/${binary_name}"

# ---------------------------------------------------------------------------
# Install paths
# ---------------------------------------------------------------------------

install_dir=${LITOPYS_INSTALL_DIR:-"$HOME/.local/bin"}
graph_path=${LITOPYS_GRAPH_PATH:-"$HOME/.litopys/graph"}
target_name="litopys"
if [ "$os_tag" = "windows" ]; then
  target_name="litopys.exe"
fi
target="${install_dir}/${target_name}"

mkdir -p "$install_dir" || die "failed to create $install_dir"

log "Version:   $LITOPYS_VERSION"
log "Platform:  ${os_tag}-${arch_tag}"
log "Binary:    $target"
log "Graph:     $graph_path"

# ---------------------------------------------------------------------------
# Download binary
# ---------------------------------------------------------------------------

log "Downloading ${binary_name}..."
tmp=$(mktemp)
sums_tmp=$(mktemp)
trap 'rm -f "$tmp" "$sums_tmp"' EXIT

if ! curl -fsSL -o "$tmp" "$url"; then
  die "download failed: $url"
fi

# Verify SHA-256 against SHASUMS256.txt published with the release.
# Fail closed: if we cannot fetch SHASUMS256.txt or cannot find a sha256 tool,
# we refuse to install the binary. Set LITOPYS_SKIP_VERIFY=1 to override
# (only useful for one-off testing against a release that hasn't published
# checksums yet, e.g. pre-v0.1.2).
sums_url="https://github.com/${REPO}/releases/download/${LITOPYS_VERSION}/SHASUMS256.txt"

if [ "${LITOPYS_SKIP_VERIFY:-0}" = "1" ]; then
  warn "LITOPYS_SKIP_VERIFY=1 — skipping checksum verification (NOT RECOMMENDED)."
elif [ -z "$sha256_cmd" ]; then
  die "no sha256 tool found (need 'sha256sum' or 'shasum'). Install one or set LITOPYS_SKIP_VERIFY=1 to override."
else
  log "Fetching checksums..."
  if ! curl -fsSL -o "$sums_tmp" "$sums_url"; then
    die "could not fetch $sums_url — old releases (<v0.1.2) ship without checksums; pin a newer LITOPYS_VERSION or set LITOPYS_SKIP_VERIFY=1 to skip."
  fi

  expected=$(grep " ${binary_name}\$" "$sums_tmp" | awk '{print $1}')
  if [ -z "$expected" ]; then
    die "checksum for ${binary_name} not present in SHASUMS256.txt"
  fi

  actual=$($sha256_cmd "$tmp" | awk '{print $1}')
  if [ "$expected" != "$actual" ]; then
    die "checksum mismatch for ${binary_name} — refusing to install. expected=$expected actual=$actual"
  fi
  ok "Checksum verified ($expected)"
fi

mv "$tmp" "$target"
chmod +x "$target"
trap - EXIT

ok "Installed $target"

# ---------------------------------------------------------------------------
# Initialize graph skeleton
# ---------------------------------------------------------------------------

mkdir -p "$graph_path"
for d in $GRAPH_DIRS; do
  mkdir -p "${graph_path}/${d}"
done
ok "Graph skeleton ready at $graph_path"

# ---------------------------------------------------------------------------
# PATH hint
# ---------------------------------------------------------------------------

case ":${PATH:-}:" in
  *":${install_dir}:"*) ;;
  *)
    warn "$install_dir is not on your PATH."
    warn "Add this to your shell rc (e.g. ~/.bashrc, ~/.zshrc):"
    printf '    export PATH="%s:$PATH"\n' "$install_dir"
    ;;
esac

# ---------------------------------------------------------------------------
# Optional — auto-start web dashboard via systemd user unit
# ---------------------------------------------------------------------------

if [ "${LITOPYS_ENABLE_VIEWER:-0}" = "1" ]; then
  if [ "$os_tag" = "linux" ] && command -v systemctl >/dev/null 2>&1; then
    log "Installing litopys-viewer systemd user unit..."
    if "$target" viewer install >/dev/null 2>&1; then
      ok "Dashboard running at http://localhost:3999/"
      ok "Check:   systemctl --user status litopys-viewer"
    else
      warn "Viewer install failed. Run manually: $target viewer install"
    fi
  else
    warn "LITOPYS_ENABLE_VIEWER=1 ignored — requires Linux with systemd."
  fi
fi

# ---------------------------------------------------------------------------
# MCP client registration hints
# ---------------------------------------------------------------------------

printf '\n'
ok "Next steps — register Litopys with your MCP client:"
printf '\n'
printf '  %sClaude Code:%s\n' "$BOLD" "$RESET"
printf '    claude mcp add litopys -- %s mcp stdio\n' "$target"
printf '\n'
printf '  %sClaude Desktop%s (edit ~/Library/Application Support/Claude/claude_desktop_config.json):\n' "$BOLD" "$RESET"
printf '    "litopys": { "command": "%s", "args": ["mcp", "stdio"], "env": { "LITOPYS_GRAPH_PATH": "%s" } }\n' "$target" "$graph_path"
printf '\n'
printf '  %sRemote / HTTP mode:%s\n' "$BOLD" "$RESET"
printf '    LITOPYS_MCP_TOKEN=your-secret %s mcp http\n' "$target"
printf '\n'
printf 'See %shttps://github.com/%s%s for full docs.\n' "$BOLD" "$REPO" "$RESET"
