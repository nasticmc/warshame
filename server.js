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

const dataDir = path.join(__dirname, 'data');
const markerLogPath = process.env.MARKER_LOG_PATH || path.join(dataDir, 'markers-log.json');
const configPath = process.env.CONFIG_PATH || path.join(dataDir, 'config.json');
const retentionMs = 7 * 24 * 60 * 60 * 1000;

fs.mkdirSync(path.dirname(markerLogPath), { recursive: true });
fs.mkdirSync(path.dirname(configPath), { recursive: true });

function loadJsonArray(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadConfig() {
  const envKeys = (process.env.MESHCORE_WARDRIVE_CHANNEL_KEYS || '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

  if (!fs.existsSync(configPath)) {
    return { channelKeys: envKeys };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const fileKeys = Array.isArray(parsed.channelKeys) ? parsed.channelKeys : [];
    return { channelKeys: [...new Set([...fileKeys, ...envKeys].map((k) => String(k).trim().toLowerCase()).filter(Boolean))] };
  } catch {
    return { channelKeys: envKeys };
  }
}

let markers = loadJsonArray(markerLogPath);
const config = loadConfig();
let channelKeys = new Set(config.channelKeys);

function persistMarkers() {
  fs.writeFileSync(markerLogPath, JSON.stringify(markers, null, 2));
}

function persistConfig() {
  fs.writeFileSync(configPath, JSON.stringify({ channelKeys: [...channelKeys] }, null, 2));
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
    return { type: 'json', data: JSON.parse(raw), raw };
  } catch {
    return { type: 'text', data: raw, raw };
  }
}

function extractPacketHex(parsed) {
  if (parsed.type === 'text') {
    const value = parsed.data.trim();
    return isHex(value) ? value : null;
  }

  const candidates = [
    parsed.data?.raw,
    parsed.data?.packet,
    parsed.data?.packetHex,
    parsed.data?.payloadHex,
    parsed.data?.hex,
    parsed.data?.data
  ];

  return candidates.find((candidate) => isHex(candidate)) || null;
}

function decodedKeys(decodedPacket) {
  const payload = decodedPacket?.payload?.decoded;
  const keys = [
    payload?.publicKey,
    payload?.senderPublicKey,
    payload?.sourceHash,
    payload?.destinationHash,
    payload?.channelHash,
  ];
  if (Array.isArray(decodedPacket?.path)) keys.push(...decodedPacket.path);
  return keys.filter(Boolean).map((k) => String(k).toLowerCase().trim());
}

function packetMatchesKeys(decodedPacket) {
  if (channelKeys.size === 0) return false;
  return decodedKeys(decodedPacket).some((key) => channelKeys.has(key));
}

function locationFromDecoded(decodedPacket) {
  const loc = decodedPacket?.payload?.decoded?.appData?.location;
  if (!loc) return null;

  const lat = Number(loc.latitude);
  const lon = Number(loc.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return { lat, lon };
  }

  return null;
}

function getTime(value) {
  // Decoder timestamps are Unix seconds (number); Date() expects milliseconds.
  const ms = typeof value === 'number' ? value * 1000 : value;
  const parsed = ms ? new Date(ms) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function pushMarker({ lat, lon, user, time, topic }) {
  markers.push({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    lat,
    lon,
    user,
    time,
    topic
  });

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
    console.log(`Connected to MQTT broker: ${resolvedMqttUrl}`);
    client.subscribe(mqttTopic, (err) => {
      if (err) {
        console.error('subscribe failed', err.message);
      } else {
        console.log(`Subscribed to topic: ${mqttTopic}`);
      }
    });
  });

  client.on('message', (topic, payloadBuffer) => {
    const parsed = parsePayload(payloadBuffer);
    console.log('[MQTT message received]', { topic, payload: parsed.raw });

    const packetHex = extractPacketHex(parsed);
    if (!packetHex) {
      console.log('[MQTT ignored] no packet hex found');
      return;
    }

    let decoded;
    try {
      decoded = MeshCorePacketDecoder.decode(packetHex);
    } catch {
      console.log('[MQTT ignored] meshcore decode failed');
      return;
    }

    if (!packetMatchesKeys(decoded)) {
      console.log('[MQTT ignored] packet does not match configured channel keys');
      return;
    }

    const location = locationFromDecoded(decoded);
    if (!location) {
      console.log('[MQTT ignored] no location in decoded payload');
      return;
    }

    const payload = decoded.payload?.decoded || {};
    pushMarker({
      lat: location.lat,
      lon: location.lon,
      user: payload.decrypted?.sender || payload.sender || payload.sourceHash || payload.publicKey || 'unknown-user',
      time: getTime(payload.decrypted?.timestamp ?? payload.timestamp),
      topic
    });

    console.log('[MQTT marker saved]', { topic, lat: location.lat, lon: location.lon });
  });

  client.on('error', (err) => console.error('mqtt error', err.message));
}

cleanupOldMarkers();
persistMarkers();
persistConfig();
setInterval(cleanupOldMarkers, 60 * 60 * 1000);
startMqtt();

app.use(express.json());
app.use(express.static(__dirname));

app.get('/api/markers', (_req, res) => {
  cleanupOldMarkers();
  res.json({ markers: markers.slice().sort((a, b) => new Date(b.time) - new Date(a.time)) });
});

app.get('/api/config', (_req, res) => {
  res.json({
    channelKeys: [...channelKeys].sort(),
    mqttTopic
  });
});

app.post('/api/channel-keys', (req, res) => {
  const key = String(req.body?.key || '').trim().toLowerCase();
  if (!key) {
    return res.status(400).json({ error: 'key is required' });
  }

  channelKeys.add(key);
  persistConfig();
  return res.json({ channelKeys: [...channelKeys].sort() });
});

app.delete('/api/channel-keys', (req, res) => {
  const key = String(req.body?.key || '').trim().toLowerCase();
  if (!key) {
    return res.status(400).json({ error: 'key is required' });
  }

  channelKeys.delete(key);
  persistConfig();
  return res.json({ channelKeys: [...channelKeys].sort() });
});

app.listen(port, () => {
  console.log(`server listening on ${port}`);
});
