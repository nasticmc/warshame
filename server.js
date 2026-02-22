import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import mqtt from 'mqtt';
import { fileURLToPath } from 'node:url';
import { MeshCorePacketDecoder } from 'meshcore-decoder';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 8080);
const mqttUrl = process.env.MESHCORE_MQTT_URL || '';
const mqttTopic = process.env.MESHCORE_MQTT_TOPIC || 'meshcore/#';
const mqttBroker = process.env.MQTT_BROKER || '';
const mqttPort = process.env.MQTT_PORT || '';
const mqttProtocol = process.env.MQTT_PROTOCOL || 'ws';
const mqttPath = process.env.MQTT_PATH || '/mqtt';
const mqttUsername = process.env.MQTT_USERNAME || '';
const mqttPassword = process.env.MQTT_PASSWORD || '';
const wardriveKeys = new Set(
  (process.env.MESHCORE_WARDRIVE_CHANNEL_KEYS || '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
);

const logPath = process.env.MARKER_LOG_PATH || path.join(__dirname, 'data', 'markers-log.json');
const retentionMs = 7 * 24 * 60 * 60 * 1000;

fs.mkdirSync(path.dirname(logPath), { recursive: true });

function loadMarkers() {
  if (!fs.existsSync(logPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let markers = loadMarkers();

function persistMarkers() {
  fs.writeFileSync(logPath, JSON.stringify(markers, null, 2));
}

function cleanupOldMarkers() {
  const cutoff = Date.now() - retentionMs;
  const before = markers.length;
  markers = markers.filter((m) => new Date(m.time).getTime() >= cutoff);
  if (markers.length !== before) persistMarkers();
}

function isHex(value) {
  return typeof value === 'string' && /^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0;
}

function parsePayload(buf) {
  const raw = buf.toString();
  try {
    return { type: 'json', data: JSON.parse(raw) };
  } catch {
    return { type: 'text', data: raw };
  }
}

function extractPacketHex(parsed) {
  if (parsed.type === 'text') {
    const v = parsed.data.trim();
    return isHex(v) ? v : null;
  }
  const candidates = [parsed.data?.packet, parsed.data?.packetHex, parsed.data?.payloadHex, parsed.data?.hex, parsed.data?.data];
  return candidates.find((v) => isHex(v)) || null;
}

function decodedKeys(decodedPacket) {
  const payload = decodedPacket?.payload?.decoded;
  const keys = [payload?.publicKey, payload?.senderPublicKey, payload?.sourceHash, payload?.destinationHash];
  if (Array.isArray(decodedPacket?.path)) keys.push(...decodedPacket.path);
  return keys.filter(Boolean).map((k) => String(k).toLowerCase().trim());
}

function packetMatchesKeys(decodedPacket) {
  if (wardriveKeys.size === 0) return false;
  return decodedKeys(decodedPacket).some((k) => wardriveKeys.has(k));
}

function locationFromDecoded(decodedPacket) {
  const loc = decodedPacket?.payload?.decoded?.appData?.location;
  if (!loc) return null;
  if (Number.isFinite(Number(loc.latitude)) && Number.isFinite(Number(loc.longitude))) {
    return { lat: Number(loc.latitude), lon: Number(loc.longitude) };
  }
  return null;
}

function getTime(val) {
  const d = val ? new Date(val) : new Date();
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function pushMarker({ lat, lon, user, time, topic }) {
  markers.push({ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, lat, lon, user, time, topic });
  cleanupOldMarkers();
  persistMarkers();
}

function buildMqttUrl() {
  if (mqttUrl) return mqttUrl;
  if (!mqttBroker) return '';
  const portPart = mqttPort ? `:${mqttPort}` : '';
  const pathPart = mqttProtocol.startsWith('ws') ? mqttPath : '';
  return `${mqttProtocol}://${mqttBroker}${portPart}${pathPart}`;
}

function startMqtt() {
  const resolvedMqttUrl = buildMqttUrl();
  if (!resolvedMqttUrl) {
    console.warn('No MQTT settings found. Set MESHCORE_MQTT_URL or MQTT_BROKER (+ optional MQTT_PORT/protocol/path).');
    return;
  }

  const client = mqtt.connect(resolvedMqttUrl, {
    reconnectPeriod: 3000,
    clean: true,
    username: mqttUsername || undefined,
    password: mqttPassword || undefined
  });
  client.on('connect', () => {
    client.subscribe(mqttTopic, (err) => {
      if (err) console.error('subscribe failed', err.message);
    });
  });

  client.on('message', (topic, payload) => {
    const parsed = parsePayload(payload);
    const packetHex = extractPacketHex(parsed);
    if (!packetHex) return;

    let decoded;
    try {
      decoded = MeshCorePacketDecoder.decode(packetHex);
    } catch {
      return;
    }

    if (!packetMatchesKeys(decoded)) return;

    const loc = locationFromDecoded(decoded);
    if (!loc) return;

    const p = decoded.payload?.decoded || {};
    pushMarker({
      lat: loc.lat,
      lon: loc.lon,
      user: p.sender || p.sourceHash || p.publicKey || 'unknown-user',
      time: getTime(p.timestamp),
      topic
    });
  });

  client.on('error', (err) => console.error('mqtt error', err.message));
}

cleanupOldMarkers();
persistMarkers();
setInterval(cleanupOldMarkers, 60 * 60 * 1000);
startMqtt();

app.use(express.static(__dirname));
app.get('/api/markers', (_req, res) => {
  cleanupOldMarkers();
  res.json({ markers: markers.slice().sort((a, b) => new Date(b.time) - new Date(a.time)) });
});

app.listen(port, () => {
  console.log(`server listening on ${port}`);
});
