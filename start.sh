#!/bin/bash

echo "============================================"
echo "   Javinizer-JS - JAV Metadata Manager"
echo "============================================"
echo ""

# Function to detect package manager
detect_package_manager() {
    if command -v apt &> /dev/null; then
        PKG_MANAGER="apt"
    elif command -v dnf &> /dev/null; then
        PKG_MANAGER="dnf"
    elif command -v yum &> /dev/null; then
        PKG_MANAGER="yum"
    elif command -v pacman &> /dev/null; then
        PKG_MANAGER="pacman"
    elif command -v zypper &> /dev/null; then
        PKG_MANAGER="zypper"
    elif command -v emerge &> /dev/null; then
        PKG_MANAGER="emerge"
    elif command -v apk &> /dev/null; then
        PKG_MANAGER="apk"
    else
        echo "[ERROR] No supported package manager found!"
        echo "Please install Node.js manually from: https://nodejs.org/"
        exit 1
    fi
}

# Function to install Node.js based on package manager
install_nodejs() {
    case $PKG_MANAGER in
        "apt")
            echo "[INFO] Installing Node.js using apt..."
            sudo apt update
            sudo apt install -y nodejs npm
            ;;
        "dnf"|"yum")
            echo "[INFO] Installing Node.js using $PKG_MANAGER..."
            sudo $PKG_MANAGER install -y nodejs npm
            ;;
        "pacman")
            echo "[INFO] Installing Node.js using pacman..."
            sudo pacman -S --noconfirm nodejs npm
            ;;
        "zypper")
            echo "[INFO] Installing Node.js using zypper..."
            sudo zypper install -y nodejs npm
            ;;
        "emerge")
            echo "[INFO] Installing Node.js using emerge..."
            sudo emerge -av nodejs npm
            ;;
        "apk")
            echo "[INFO] Installing Node.js using apk..."
            sudo apk add nodejs npm
            ;;
    esac
}

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "[INFO] Node.js is not installed. Detecting package manager..."
    detect_package_manager
    install_nodejs

    # Verify installation
    if ! command -v node &> /dev/null; then
        echo "[ERROR] Failed to install Node.js!"
        exit 1
    fi
    echo "[INFO] Node.js installed successfully."
else
    echo "[INFO] Node.js is already installed."
fi

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
echo "[INFO] Opening browser at http://localhost:4004"
echo ""
echo "Press Ctrl+C to stop the server"
echo "============================================"
echo ""

# Open browser after a short delay (works on Linux and macOS)
(sleep 2 && xdg-open http://localhost:4004 2>/dev/null || open http://localhost:4004 2>/dev/null) &

# Start the Node.js server
node src/server/index.js
