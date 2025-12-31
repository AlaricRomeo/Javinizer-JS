# VNC Setup for Windows Users

This guide explains how to access the JavLibrary browser via VNC on Windows.

## Why VNC?

JavLibrary requires solving Cloudflare challenges manually in a browser. On Windows, we use VNC to access the browser running inside the Docker container.

## Prerequisites

1. **Docker Desktop for Windows** installed and running
2. **VNC Viewer** (download free from [RealVNC](https://www.realvnc.com/en/connect/download/viewer/) or use [TightVNC](https://www.tightvnc.com/))

## Setup Instructions

### 1. Use the Windows Docker Compose File

Use `docker-compose.windows.yml` instead of the default `docker-compose.yml`:

```bash
docker-compose -f docker-compose.windows.yml up -d
```

This configuration:
- Enables VNC server on port 5900
- Sets a VNC password (default: `javinizer`)

### 2. Check Container Logs

Verify VNC server started correctly:

```bash
docker-compose -f docker-compose.windows.yml logs
```

You should see:
```
VNC server started. Connect with VNC viewer to localhost:5900
VNC password: javinizer
```

### 3. Connect via VNC Viewer

1. Open your VNC Viewer application
2. Connect to: `localhost:5900`
3. Enter password: `javinizer` (or your custom password)
4. You'll see the virtual desktop with Chromium browser

### 4. Use JavLibrary Scraper

1. Start scraping via the WebUI (http://localhost:4004)
2. When JavLibrary scraper runs, Chromium will open in the VNC session
3. Solve the Cloudflare challenge manually
4. Click "Continue" in the browser prompt
5. Scraping will proceed automatically

## Custom VNC Password

To set a custom VNC password, edit `docker-compose.windows.yml`:

```yaml
environment:
  - VNC_PASSWORD=your_secure_password_here
```

## Troubleshooting

### VNC Connection Refused
- Check container is running: `docker ps`
- Check port 5900 is exposed: `docker port javinizer-js`
- Check firewall isn't blocking port 5900

### Can't See Browser
- Wait a few seconds for Xvfb to initialize
- Check container logs for errors
- Try restarting container: `docker-compose -f docker-compose.windows.yml restart`

### Browser Crashes
- Increase shared memory: edit `shm_size: '2gb'` to `'4gb'` in docker-compose file

## Linux Users

Linux users don't need VNC. The browser will open directly on your desktop using X11 forwarding. Use the default `docker-compose.yml`.

## Security Note

VNC traffic is **not encrypted** by default. Only use on localhost or secure networks. For remote access, consider using an SSH tunnel:

```bash
ssh -L 5900:localhost:5900 user@remote-host
```

Then connect VNC viewer to `localhost:5900` on your local machine.
