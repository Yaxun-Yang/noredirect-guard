const toggle      = document.getElementById('toggle');
const statusText  = document.getElementById('statusText');
const statusBox   = document.getElementById('statusBox');
const prefixInput = document.getElementById('prefixInput');
const savePrefix  = document.getElementById('savePrefix');
const clearPrefix = document.getElementById('clearPrefix');
const prefixStatus = document.getElementById('prefixStatus');
const mediaToggle = document.getElementById('mediaToggle');

function applyState(enabled) {
  toggle.checked = enabled;
  if (enabled) {
    statusText.textContent = 'active';
    statusText.style.color = '#2ecc71';
    statusBox.style.opacity = '1';
  } else {
    statusText.textContent = 'disabled';
    statusText.style.color = '#e74c3c';
    statusBox.style.opacity = '.6';
  }
}

function showPrefixStatus(prefix) {
  if (prefix) {
    const display = prefix.length > 32 ? prefix.slice(0, 29) + '...' : prefix;
    prefixStatus.textContent = 'Active: ' + display;
    prefixStatus.style.color = '#2ecc71';
  } else {
    prefixStatus.textContent = 'No prefix set';
    prefixStatus.style.color = '#555';
  }
}

function normalizePrefix(raw) {
  // Parse to validate and canonicalize the URL
  const u = new URL(raw);
  let href = u.href;
  // If the path has no extension in the last segment and doesn't end with /, append /
  const lastSeg = u.pathname.split('/').pop();
  if (!lastSeg.includes('.') && !href.endsWith('/')) {
    href += '/';
  }
  return href;
}

/* Load saved state */
chrome.storage.local.get(['enabled', 'urlPrefix', 'blockFloatingMedia'], function (result) {
  applyState(result.enabled !== false);
  const prefix = result.urlPrefix || '';
  prefixInput.value = prefix;
  showPrefixStatus(prefix);
  mediaToggle.checked = result.blockFloatingMedia !== false;
});

toggle.addEventListener('change', function () {
  const enabled = toggle.checked;
  chrome.storage.local.set({ enabled });
  applyState(enabled);
});

savePrefix.addEventListener('click', function () {
  const raw = prefixInput.value.trim();
  if (!raw) {
    prefixStatus.textContent = 'Enter a URL first';
    prefixStatus.style.color = '#e74c3c';
    return;
  }
  if (!/^https?:\/\//i.test(raw)) {
    prefixStatus.textContent = 'Must start with http:// or https://';
    prefixStatus.style.color = '#e74c3c';
    return;
  }
  let normalized;
  try {
    normalized = normalizePrefix(raw);
  } catch (e) {
    prefixStatus.textContent = 'Invalid URL';
    prefixStatus.style.color = '#e74c3c';
    return;
  }
  prefixInput.value = normalized;
  chrome.storage.local.set({ urlPrefix: normalized });
  showPrefixStatus(normalized);
});

clearPrefix.addEventListener('click', function () {
  prefixInput.value = '';
  chrome.storage.local.set({ urlPrefix: '' });
  showPrefixStatus('');
});

mediaToggle.addEventListener('change', function () {
  chrome.storage.local.set({ blockFloatingMedia: mediaToggle.checked });
});
