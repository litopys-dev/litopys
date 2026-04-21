#!/bin/sh
# Litopys one-line installer.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/litopys-dev/litopys/main/install.sh | sh
#
# Environment:
#   LITOPYS_VERSION       Release tag to install (default: latest)
#   LITOPYS_INSTALL_DIR   Directory for the binary (default: ~/.local/bin)
#   LITOPYS_GRAPH_PATH    Graph root (default: ~/.litopys/graph)
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
  LITOPYS_VERSION=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
    | grep -m 1 '"tag_name"' \
    | cut -d'"' -f 4 || true)
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
trap 'rm -f "$tmp"' EXIT

if ! curl -fsSL -o "$tmp" "$url"; then
  die "download failed: $url"
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
