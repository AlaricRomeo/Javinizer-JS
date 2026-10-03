#!/bin/bash

echo "============================================"
echo "   Javinizer-JS - JAV Metadata Manager"
echo "============================================"
echo ""

cd "$(dirname "$0")" || exit 1

PORT=4004

# Already running: just open the browser
port_in_use() {
    if command -v ss &> /dev/null; then
        ss -ltn | grep -q ":$PORT "
    elif command -v lsof &> /dev/null; then
        lsof -iTCP:"$PORT" -sTCP:LISTEN &> /dev/null
    else
        return 1
    fi
}

open_browser() {
    xdg-open "http://localhost:$PORT" 2>/dev/null || open "http://localhost:$PORT" 2>/dev/null
}

if port_in_use; then
    echo "[INFO] Server already running on port $PORT, opening the browser..."
    open_browser &
    exit 0
fi

# Node.js: use the system one if recent enough (engines.node in package.json,
# checked by bin/check-node-version.js), otherwise a private copy in
# data/runtime/node, downloaded on first start and again whenever a new
# release raises the minimum version
NODE_RUNTIME="$PWD/data/runtime/node"
NODE_REQUIRED=$(sed -n 's/.*"node": *">=\([0-9.]*\)".*/\1/p' package.json | head -1)

node_ok() {
    command -v node &> /dev/null && node bin/check-node-version.js 2>/dev/null
}

fetch() {
    if command -v curl &> /dev/null; then
        curl -fsSL "$1" -o "$2"
    elif command -v wget &> /dev/null; then
        wget -q -O "$2" "$1"
    else
        echo "[ERROR] curl or wget is required to download Node.js"
        return 1
    fi
}

# Latest Node.js LTS from nodejs.org (official tarball, checksum verified)
install_node() {
    local os arch index_key tmp version name expected actual
    case "$(uname -s)" in
        Linux) os=linux ;;
        Darwin) os=darwin ;;
        *) echo "[ERROR] Unsupported OS: $(uname -s)"; return 1 ;;
    esac
    case "$(uname -m)" in
        x86_64|amd64) arch=x64 ;;
        aarch64|arm64) arch=arm64 ;;
        *) echo "[ERROR] Unsupported architecture: $(uname -m)"; return 1 ;;
    esac
    local platform="$os-$arch"
    # musl libc (e.g. Alpine): nodejs.org only publishes an x64 musl build
    if [ "$os" = linux ] && { [ -f /etc/alpine-release ] || ldd --version 2>&1 | grep -qi musl; }; then
        if [ "$arch" != x64 ]; then
            echo "[ERROR] No official Node.js build for musl on $arch, install Node.js $NODE_REQUIRED+ with your package manager (e.g. apk add nodejs npm)"
            return 1
        fi
        platform="linux-x64-musl"
    fi
    if [ "$os" = darwin ]; then index_key="osx-$arch-tar"; else index_key="$platform"; fi

    tmp=$(mktemp -d) || return 1
    fetch https://nodejs.org/dist/index.tab "$tmp/index.tab" || { rm -rf "$tmp"; return 1; }
    version=$(awk -F'\t' -v key="$index_key" 'NR > 1 && $10 != "-" && index("," $3 ",", "," key ",") { print $1; exit }' "$tmp/index.tab")
    if [ -z "$version" ]; then
        echo "[ERROR] No Node.js LTS release found for $platform"
        rm -rf "$tmp"
        return 1
    fi

    name="node-$version-$platform"
    echo "[INFO] Downloading Node.js $version ($platform)..."
    fetch "https://nodejs.org/dist/$version/$name.tar.gz" "$tmp/$name.tar.gz" &&
        fetch "https://nodejs.org/dist/$version/SHASUMS256.txt" "$tmp/SHASUMS256.txt" || { rm -rf "$tmp"; return 1; }

    expected=$(awk -v f="$name.tar.gz" '$2 == f { print $1 }' "$tmp/SHASUMS256.txt")
    if command -v sha256sum &> /dev/null; then
        actual=$(sha256sum "$tmp/$name.tar.gz" | awk '{ print $1 }')
    else
        actual=$(shasum -a 256 "$tmp/$name.tar.gz" | awk '{ print $1 }')
    fi
    if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
        echo "[ERROR] Checksum mismatch for $name.tar.gz"
        rm -rf "$tmp"
        return 1
    fi

    tar -xzf "$tmp/$name.tar.gz" -C "$tmp" || { rm -rf "$tmp"; return 1; }
    mkdir -p "$(dirname "$NODE_RUNTIME")"
    rm -rf "$NODE_RUNTIME"
    mv "$tmp/$name" "$NODE_RUNTIME"
    rm -rf "$tmp"
    echo "[INFO] Node.js $version ready in $NODE_RUNTIME"
}

if ! node_ok && [ -x "$NODE_RUNTIME/bin/node" ]; then
    export PATH="$NODE_RUNTIME/bin:$PATH"
fi
if ! node_ok; then
    echo "[INFO] Node.js $NODE_REQUIRED or newer not found, downloading a private copy..."
    if ! install_node; then
        echo "[ERROR] Failed to download Node.js!"
        echo "Please install Node.js $NODE_REQUIRED or newer from: https://nodejs.org/"
        exit 1
    fi
    export PATH="$NODE_RUNTIME/bin:$PATH"
    echo ""
fi
if ! node_ok; then
    echo "[ERROR] Node.js $NODE_REQUIRED or newer is required!"
    exit 1
fi
echo "[INFO] Using Node.js $(node -v) ($(command -v node))"

# Check if npm is available
if ! command -v npm &> /dev/null; then
    echo "[ERROR] npm is not installed!"
    exit 1
fi

# Check if dependencies are installed and up-to-date
if [ ! -d "node_modules" ] || [ ! -f "package-lock.json" ] || [ "$(find package.json -newer package-lock.json 2>/dev/null)" ]; then
    echo "[INFO] Installing or updating dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        echo "[ERROR] Failed to install dependencies!"
        exit 1
    fi
    echo ""
else
    # Check if any dependencies are missing by trying to require them
    echo "[INFO] Checking if all dependencies are installed..."
    missing_deps=0

    # Check for each dependency in package.json
    deps=$(node -p "Object.keys(require('./package.json').dependencies).join(' ')")
    for dep in $deps; do
        if ! node -e "require('$dep')" 2>/dev/null; then
            echo "[INFO] Missing dependency: $dep"
            missing_deps=1
        fi
    done

    if [ $missing_deps -eq 1 ]; then
        echo "[INFO] Installing missing dependencies..."
        npm install
        if [ $? -ne 0 ]; then
            echo "[ERROR] Failed to install dependencies!"
            exit 1
        fi
        echo ""
    fi
fi

# Start the server and open browser
echo "[INFO] Starting Javinizer-JS server..."
echo "[INFO] Opening browser at http://localhost:$PORT"
echo ""
echo "Press Ctrl+C to stop the server"
echo "============================================"
echo ""

# Open browser after a short delay (works on Linux and macOS)
(sleep 2 && open_browser) &

# Start the Node.js server
node src/server/index.js
