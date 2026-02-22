# Meshcore Wardriving Map

Web app + backend service that subscribes to MeshCore MQTT traffic, decodes packets, and displays wardriving markers on a Melbourne-centered map.

## What changed

- MQTT connection is backend-only (no broker/topic controls in the browser UI).
- Left panel shows a clickable list of recent messages/markers.
- Marker data is persisted to a log file and retained for 7 days.
- Old entries are automatically cleaned up on startup and hourly.

## Runtime configuration

Set these environment variables on the backend service:

- `MESHCORE_MQTT_URL` (required for live ingestion)
- `MESHCORE_MQTT_TOPIC` (default: `meshcore/#`)
- `MESHCORE_WARDRIVE_CHANNEL_KEYS` (comma-separated known public keys/hashes)
- `MARKER_LOG_PATH` (default: `./data/markers-log.json`)
- `PORT` (default: `8080`)

## Local run

```bash
npm install
npm start
```

Open <http://localhost:8080>.

## Docker run

```bash
docker build -t meshcore-wardrive-map .
docker run --rm -p 8080:8080 \
  -e MESHCORE_MQTT_URL="wss://your-broker:8083/mqtt" \
  -e MESHCORE_MQTT_TOPIC="meshcore/#" \
  -e MESHCORE_WARDRIVE_CHANNEL_KEYS="pubkey1,pubkey2" \
  -v $(pwd)/data:/app/data \
  meshcore-wardrive-map
```

This keeps a persistent marker log in `data/markers-log.json` with 7-day retention.
