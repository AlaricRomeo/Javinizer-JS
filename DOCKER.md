# Docker Guide for Javinizer-js

## Quick Start

```bash
# Build and run with docker-compose
docker-compose up -d

# View logs
docker-compose logs -f

# Stop container
docker-compose down
```

## Configuration

### 1. Edit docker-compose.yml

Update the volume mounts for your library:

```yaml
volumes:
  - ./config.json:/config/config.json
  - /path/to/your/jav/library:/library:ro  # ← Change this
```

### 2. Create config.json

```bash
cp config.example.json config.json
nano config.json
```

Set `libraryPath` to `/library` (the mounted path inside the container):

```json
{
  "libraryPath": "/library",
  "language": "en"
}
```

## Manual Docker Build

```bash
# Build image
docker build -t javinizer-js .

# Run container
docker run -d \
  --name javinizer-js \
  -p 4004:4004 \
  -v $(pwd)/config.json:/config/config.json \
  -v /path/to/your/library:/library:ro \
  javinizer-js
```

## Docker Hub (Future)

When published to Docker Hub, you can use:

```bash
docker pull your-username/javinizer-js:latest
```

## Environment Variables

Available environment variables:

- `NODE_ENV` - Set to `production` (default in Dockerfile)
- `CONFIG_PATH` - Path to config file (default: `/config/config.json`)
- `TZ` - Timezone (default: `Europe/Rome` in docker-compose)

## Health Check

The container includes a health check that pings `/item/config` every 30 seconds.

View health status:

```bash
docker ps
# Look for "healthy" in STATUS column
```

## Resource Limits

Default limits in docker-compose.yml:

- Memory limit: 512MB
- Memory reservation: 256MB

Adjust based on your library size.

## Troubleshooting

### Container won't start

```bash
# Check logs
docker-compose logs

# Check if port 4004 is already in use
sudo lsof -i :4004
```

### Can't access library

- Ensure the library path in docker-compose.yml is correct
- Check file permissions (the container runs as node user)
- Verify the mount is read-only (`:ro`) to prevent accidental writes

### Config not persisting

- Make sure `config.json` exists before starting
- Verify the volume mount path in docker-compose.yml

## Updating

```bash
# Pull latest code
git pull

# Rebuild and restart
docker-compose up -d --build
```

## Backup

Important files to backup:

- `config.json` - Your configuration
- Your NFO files (should be in your library, not in container)

The container is stateless - all data is in volumes.

## Development with Docker

For development with hot-reload:

```bash
docker run -it \
  -p 4004:4004 \
  -v $(pwd):/app \
  -v /app/node_modules \
  node:18-alpine \
  sh -c "cd /app && npm install && npm start"
```

Or use nodemon:

```bash
npm install -g nodemon
nodemon src/server/server.js
```
