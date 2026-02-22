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
const messagesLogPath = process.env.MESSAGES_LOG_PATH || path.join(dataDir, 'messages-log.json');
const configPath = process.env.CONFIG_PATH || path.join(dataDir, 'config.json');
const retentionMs = 7 * 24 * 60 * 60 * 1000;

fs.mkdirSync(path.dirname(markerLogPath), { recursive: true });
fs.mkdirSync(path.dirname(messagesLogPath), { recursive: true });
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
let messages = loadJsonArray(messagesLogPath);
const config = loadConfig();
let channelKeys = new Set(config.channelKeys);

function persistMarkers() {
  fs.writeFileSync(markerLogPath, JSON.stringify(markers, null, 2));
}

function persistMessages() {
  fs.writeFileSync(messagesLogPath, JSON.stringify(messages, null, 2));
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

function cleanupOldMessages() {
  const cutoff = Date.now() - retentionMs;
  const before = messages.length;
  messages = messages.filter((m) => new Date(m.time).getTime() >= cutoff);
  if (messages.length !== before) persistMessages();
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

function buildKeyStore() {
  return MeshCorePacketDecoder.createKeyStore({ channelSecrets: [...channelKeys] });
}

function packetMatchesKeys(decodedPacket, keyStore) {
  if (channelKeys.size === 0) return false;

  // GroupText packets use a 1-byte channelHash (first byte of SHA256 of the channel secret).
  // Compare it via the keyStore rather than against the raw key strings directly.
  const gtPayload = decodedPacket?.payload?.decoded;
  if (gtPayload?.channelHash !== undefined && keyStore) {
    if (keyStore.hasChannelKey(gtPayload.channelHash)) return true;
  }

  // For all other packet types (Advert, etc.) match via publicKey / sourceHash / etc.
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

// Parse a lat/lon coordinate pair from free-form text.
// Supported separators: comma, semicolon, slash, pipe, or whitespace.
// Validates the parsed numbers are within lat [-90,90] / lon [-180,180] ranges.
// Returns { lat, lon, fullMatch, index } on success, or null.
function locationFromMessage(text) {
  if (!text || typeof text !== 'string') return null;

  // Match two signed decimals (up to 3 integer digits) with a flexible separator.
  const re = /(-?\d{1,3}(?:\.\d+)?)(?:\s*[,;/|]\s*|\s+)(-?\d{1,3}(?:\.\d+)?)/g;

  let match;
  while ((match = re.exec(text)) !== null) {
    const lat = Number(match[1]);
    const lon = Number(match[2]);
    if (
      Number.isFinite(lat) && Number.isFinite(lon) &&
      lat >= -90 && lat <= 90 &&
      lon >= -180 && lon <= 180
    ) {
      return { lat, lon, fullMatch: match[0], index: match.index };
    }
  }

  return null;
}

// Remove the coordinate substring from a message and clean up surrounding whitespace.
function stripLocationText(text, index, fullMatch) {
  return (text.slice(0, index) + text.slice(index + fullMatch.length))
    .replace(/\s{2,}/g, ' ')
    .trim();
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

function pushMessage({ user, time, topic, message }) {
  messages.push({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    user,
    time,
    topic,
    message
  });

  cleanupOldMessages();
  persistMessages();
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

    // Build a keyStore from configured channel secrets so GroupText packets can be
    // both matched (via channelHash) and decrypted in a single decode call.
    const keyStore = buildKeyStore();

    let decoded;
    try {
      decoded = MeshCorePacketDecoder.decode(packetHex, { keyStore });
    } catch {
      console.log('[MQTT ignored] meshcore decode failed');
      return;
    }

    if (!packetMatchesKeys(decoded, keyStore)) {
      console.log('[MQTT ignored] packet does not match configured channel keys');
      return;
    }

    const location = locationFromDecoded(decoded);
    const payload = decoded.payload?.decoded || {};

    if (location) {
      pushMarker({
        lat: location.lat,
        lon: location.lon,
        user: payload.decrypted?.sender || payload.sender || payload.sourceHash || payload.publicKey || 'unknown-user',
        time: getTime(payload.decrypted?.timestamp ?? payload.timestamp),
        topic
      });
      console.log('[MQTT marker saved]', { topic, lat: location.lat, lon: location.lon });
    } else if (payload.decrypted) {
      // GroupText: no decoded location — check the message text for a coordinate pair.
      const msgText = payload.decrypted.message || '';
      const msgLocation = locationFromMessage(msgText);

      if (msgLocation) {
        pushMarker({
          lat: msgLocation.lat,
          lon: msgLocation.lon,
          user: payload.decrypted.sender || 'unknown-user',
          time: getTime(payload.decrypted.timestamp),
          topic
        });
        console.log('[MQTT marker from message]', { topic, lat: msgLocation.lat, lon: msgLocation.lon });

        // Save any remaining text after stripping the coordinate substring.
        const strippedText = stripLocationText(msgText, msgLocation.index, msgLocation.fullMatch);
        if (strippedText) {
          pushMessage({
            user: payload.decrypted.sender || 'unknown-user',
            time: getTime(payload.decrypted.timestamp),
            topic,
            message: strippedText
          });
          console.log('[MQTT grouptext (coords stripped) saved]', { topic, user: payload.decrypted.sender });
        }
      } else {
        pushMessage({
          user: payload.decrypted.sender || 'unknown-user',
          time: getTime(payload.decrypted.timestamp),
          topic,
          message: msgText
        });
        console.log('[MQTT grouptext saved]', { topic, user: payload.decrypted.sender });
      }
    } else {
      console.log('[MQTT ignored] no location and no decrypted content');
    }
  });

  client.on('error', (err) => console.error('mqtt error', err.message));
}

cleanupOldMarkers();
cleanupOldMessages();
persistMarkers();
persistMessages();
persistConfig();
setInterval(() => { cleanupOldMarkers(); cleanupOldMessages(); }, 60 * 60 * 1000);
startMqtt();

app.use(express.json());
app.use(express.static(__dirname));

app.get('/channels', (_req, res) => {
  res.sendFile(path.join(__dirname, 'channels.html'));
});

app.get('/api/markers', (_req, res) => {
  cleanupOldMarkers();
  res.json({ markers: markers.slice().sort((a, b) => new Date(b.time) - new Date(a.time)) });
});

app.get('/api/messages', (_req, res) => {
  cleanupOldMessages();
  res.json({ messages: messages.slice().sort((a, b) => new Date(b.time) - new Date(a.time)) });
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
