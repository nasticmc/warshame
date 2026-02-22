# MeshCore MQTT Map

A single-page web app + Node backend that:

- connects to a MeshCore MQTT broker,
- logs every MQTT packet to the server console for debugging,
- decodes packets with `meshcore-decoder`,
- filters packets by configurable channel keys,
- stores location-based markers on disk,
- renders saved markers on a Leaflet map.

## Configure

Environment variables:

- `PORT` (default `8080`)
- `MESHCORE_MQTT_URL` (full URL, optional)
- `MQTT_BROKER`, `MQTT_PORT`, `MQTT_PROTOCOL`, `MQTT_PATH` (used if `MESHCORE_MQTT_URL` is not set)
- `MQTT_USERNAME`, `MQTT_PASSWORD` (optional)
- `MESHCORE_MQTT_TOPIC` (default `meshcore/#`)
- `MESHCORE_WARDRIVE_CHANNEL_KEYS` (comma-separated initial channel keys)
- `MARKER_LOG_PATH` (default `./data/markers-log.json`)
- `CONFIG_PATH` (default `./data/config.json`)

## Run

```bash
npm install
npm start
```

Open: <http://localhost:8080>

## UI behavior

- Add/remove decoder channel keys in the left panel.
- Marker list is persisted and restored from disk.
- Clicking a marker in the list centers the map.
- MQTT debug logs are printed in the server console for each received packet.
