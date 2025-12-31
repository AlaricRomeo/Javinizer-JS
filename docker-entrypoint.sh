#!/bin/bash
set -e

# Start VNC server if VNC_ENABLED is set
if [ "$VNC_ENABLED" = "true" ]; then
  echo "Starting VNC server on port 5900..."

  # Set VNC password if provided, otherwise use default
  VNC_PASSWORD=${VNC_PASSWORD:-javinizer}
  mkdir -p ~/.vnc
  echo "$VNC_PASSWORD" | x11vnc -storepasswd - ~/.vnc/passwd

  # Start Xvfb
  Xvfb :99 -screen 0 1920x1080x24 &
  export DISPLAY=:99

  # Wait for Xvfb to start
  sleep 2

  # Start x11vnc
  x11vnc -display :99 -rfbauth ~/.vnc/passwd -rfbport 5900 -forever -shared &

  echo "VNC server started. Connect with VNC viewer to localhost:5900"
  echo "VNC password: $VNC_PASSWORD"

  # Start the app
  exec node src/server/index.js

# Check if DISPLAY is set (X11 forwarding available)
elif [ -n "$DISPLAY" ]; then
  echo "Using host X11 display: $DISPLAY"
  exec node src/server/index.js

else
  echo "No DISPLAY found, using Xvfb virtual display"
  exec xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24" node src/server/index.js
fi
