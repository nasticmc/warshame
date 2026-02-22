const countElement = document.getElementById('messageCount');
const messageList = document.getElementById('messageList');
const decodedMsgCountEl = document.getElementById('decodedMsgCount');
const decodedMsgList = document.getElementById('decodedMsgList');

const map = L.map('map').setView([-37.8136, 144.9631], 11);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

const markersLayer = L.layerGroup().addTo(map);
const rendered = new Map();

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

function renderMessages(msgs) {
  decodedMsgList.innerHTML = '';
  msgs.slice(0, 250).forEach((m) => {
    const item = document.createElement('li');
    item.className = 'message-item';
    item.innerHTML = `<strong>${m.user}</strong><span>${m.time}</span><small>${m.topic}</small><p class="msg-text">${m.message}</p>`;
    decodedMsgList.appendChild(item);
  });
  decodedMsgCountEl.textContent = String(msgs.length);
}

async function refreshMessages() {
  const response = await fetch('/api/messages');
  if (!response.ok) return;
  const data = await response.json();
  renderMessages(data.messages || []);
}

async function refresh() {
  await Promise.all([refreshMarkers(), refreshMessages()]);
}

refresh();
setInterval(() => Promise.all([refreshMarkers(), refreshMessages()]), 5000);
