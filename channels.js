const channelForm = document.getElementById('channelForm');
const channelKeyInput = document.getElementById('channelKeyInput');
const channelStatus = document.getElementById('channelStatus');
const channelKeysList = document.getElementById('channelKeys');

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
  channelStatus.textContent = `Saved key: ${key}`;
  await refreshConfig();
});

refreshConfig();
