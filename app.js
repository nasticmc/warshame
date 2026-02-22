const countElement = document.getElementById('messageCount');
const messageList = document.getElementById('messageList');
const channelForm = document.getElementById('channelForm');
const channelKeyInput = document.getElementById('channelKeyInput');
const channelStatus = document.getElementById('channelStatus');
const channelKeysList = document.getElementById('channelKeys');

const map = L.map('map').setView([-37.8136, 144.9631], 11);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

const markersLayer = L.layerGroup().addTo(map);
const rendered = new Map();

function renderChannelKeys(keys) {
  channelKeysList.innerHTML = '';
  keys.forEach((key) => {
    const item = document.createElement('li');
    item.innerHTML = `<code>${key}</code>`;

    const btn = document.createElement('button');
    btn.textContent = 'Remove';
    btn.className = 'delete-btn';
    btn.addEventListener('click', async () => {
      await fetch('/api/channel-keys', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key })
      });
      await refreshConfig();
    });

    item.appendChild(btn);
    channelKeysList.appendChild(item);
  });
}

function renderList(markers) {
  messageList.innerHTML = '';
  markers.slice(0, 250).forEach((m) => {
    const item = document.createElement('li');
    item.className = 'message-item';
    item.innerHTML = `<strong>${m.user}</strong><span>${m.time}</span><small>${m.topic}</small>`;
    item.addEventListener('click', () => {
      const marker = rendered.get(m.id);
      if (marker) {
        map.setView([m.lat, m.lon], Math.max(map.getZoom(), 13));
        marker.openPopup();
      }
    });
    messageList.appendChild(item);
  });
}

function syncMarkers(markers) {
  const nextIds = new Set(markers.map((m) => m.id));

  for (const [id, marker] of rendered.entries()) {
    if (!nextIds.has(id)) {
      markersLayer.removeLayer(marker);
      rendered.delete(id);
    }
  }

  markers.forEach((m) => {
    if (rendered.has(m.id)) return;
    const marker = L.marker([m.lat, m.lon]);
    marker.bindPopup(`<strong>${m.user}</strong><br/>${m.time}<br/><small>${m.topic}</small>`);
    marker.addTo(markersLayer);
    rendered.set(m.id, marker);
  });

  countElement.textContent = String(markers.length);
  renderList(markers);
}

async function refreshMarkers() {
  const response = await fetch('/api/markers');
  if (!response.ok) return;
  const data = await response.json();
  syncMarkers(data.markers || []);
}

async function refreshConfig() {
  const response = await fetch('/api/config');
  if (!response.ok) return;
  const data = await response.json();
  renderChannelKeys(data.channelKeys || []);
}

channelForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const key = channelKeyInput.value.trim();
  if (!key) return;

  const response = await fetch('/api/channel-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key })
  });

  if (!response.ok) {
    channelStatus.textContent = 'Could not save channel key.';
    return;
  }

  channelKeyInput.value = '';
  channelStatus.textContent = `Saved key ${key}`;
  await refreshConfig();
});

async function refresh() {
  try {
    await Promise.all([refreshMarkers(), refreshConfig()]);
  } catch {
    channelStatus.textContent = 'Connection issue while refreshing data.';
  }
}

refresh();
setInterval(refreshMarkers, 5000);
