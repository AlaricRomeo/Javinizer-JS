#!/bin/bash
set -e

# Always use Xvfb (headless browser with virtual display)
# This works on all platforms and doesn't require X11 or VNC
echo "Starting with Xvfb virtual display"
exec xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24" node src/server/index.js
