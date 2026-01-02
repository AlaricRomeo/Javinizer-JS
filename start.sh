#!/bin/bash

echo "============================================"
echo "   Javinizer-JS - JAV Metadata Manager"
echo "============================================"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed!"
    echo ""
    echo "Please install Node.js from: https://nodejs.org/"
    echo ""
    echo "Or use your package manager:"
    echo "  Ubuntu/Debian: sudo apt install nodejs npm"
    echo "  Fedora:        sudo dnf install nodejs npm"
    echo "  Arch:          sudo pacman -S nodejs npm"
    echo "  macOS:         brew install node"
    echo ""
    exit 1
fi

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "[INFO] Installing dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        echo "[ERROR] Failed to install dependencies!"
        exit 1
    fi
    echo ""
fi

# Start the server and open browser
echo "[INFO] Starting Javinizer-JS server..."
echo "[INFO] Opening browser at http://localhost:4004"
echo ""
echo "Press Ctrl+C to stop the server"
echo "============================================"
echo ""

# Open browser after a short delay (works on Linux and macOS)
(sleep 2 && xdg-open http://localhost:4004 2>/dev/null || open http://localhost:4004 2>/dev/null) &

# Start the Node.js server
node src/server/index.js
