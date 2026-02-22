# Meshcore Wardriving Map

Web app + backend service that subscribes to MeshCore MQTT traffic, decodes packets, and displays wardriving markers on a Melbourne-centered map.

## What changed

- MQTT connection is backend-only (no broker/topic controls in the browser UI).
- Left panel shows a clickable list of recent messages/markers.
- Marker data is persisted to a log file and retained for 7 days.
- Old entries are automatically cleaned up on startup and hourly.

## Runtime configuration

Set these environment variables on the backend service:

- `MESHCORE_MQTT_URL` (optional; full URL takes precedence when set)
- `MQTT_BROKER` / `MQTT_PORT` / `MQTT_PROTOCOL` / `MQTT_PATH` (used when `MESHCORE_MQTT_URL` is not set)
- `MQTT_USERNAME` / `MQTT_PASSWORD` (optional MQTT auth credentials)
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

## Docker Compose

```bash
docker compose up --build -d
```

This runs the app on <http://localhost:8080> and persists markers in `./data/markers-log.json`.

`docker-compose.yml` now defaults to the provided broker/credentials (`mqtt.eastmesh.au:8001` with username/password auth) and MeshCore topic values. You can override any of these settings as needed.
