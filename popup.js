const toggle        = document.getElementById('toggle');
const statusText    = document.getElementById('statusText');
const statusBox     = document.getElementById('statusBox');
const prefixList    = document.getElementById('prefixList');
const addCurrent    = document.getElementById('addCurrent');
const clearPrefix   = document.getElementById('clearPrefix');
const prefixStatus  = document.getElementById('prefixStatus');
const mediaToggle   = document.getElementById('mediaToggle');
const blockedList       = document.getElementById('blockedList');
const addCurrentBlocked = document.getElementById('addCurrentBlocked');
const clearBlocked      = document.getElementById('clearBlocked');
const blockedStatus     = document.getElementById('blockedStatus');

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

/* Parse, deduplicate, normalize prefix lines */
function parsePrefixes(text) {
  return text.split('\n')
    .map(function (line) { return line.trim(); })
    .filter(function (line) { return /^https?:\/\//i.test(line); })
    .map(function (raw) {
      try {
        const u = new URL(raw);
        let href = u.origin + u.pathname;
        const lastSeg = u.pathname.split('/').pop();
        if (!lastSeg.includes('.') && !href.endsWith('/')) href += '/';
        return href;
      } catch (e) { return null; }
    })
    .filter(Boolean)
    .filter(function (v, i, a) { return a.indexOf(v) === i; });
}

function savePrefixes() {
  const prefixes = parsePrefixes(prefixList.value);
  const joined = prefixes.join('\n');
  prefixList.value = joined;
  chrome.storage.local.set({ urlPrefix: joined });
  showPrefixStatus(prefixes);
}

function showPrefixStatus(prefixes) {
  if (prefixes.length === 0) {
    prefixStatus.textContent = 'No sites locked';
    prefixStatus.style.color = '#555';
  } else {
    prefixStatus.textContent = prefixes.length + ' site' +
      (prefixes.length > 1 ? 's' : '') + ' locked';
    prefixStatus.style.color = '#2ecc71';
  }
}

/* Parse blocklist: one domain per line, trimmed, deduped */
function parseBlocked(text) {
  return text.split('\n')
    .map(function (l) { return l.trim().toLowerCase(); })
    .filter(Boolean)
    .filter(function (v, i, a) { return a.indexOf(v) === i; });
}

function saveBlocked() {
  const domains = parseBlocked(blockedList.value);
  const joined = domains.join('\n');
  blockedList.value = joined;
  chrome.storage.local.set({ blockedSites: joined });
  showBlockedStatus(domains);
}

function showBlockedStatus(domains) {
  blockedStatus.textContent = domains.length + ' domain' +
    (domains.length !== 1 ? 's' : '') + ' blocked';
  blockedStatus.style.color = domains.length > 0 ? '#e74c3c' : '#555';
}

/* Load saved state */
chrome.storage.local.get(
  ['enabled', 'urlPrefix', 'blockFloatingMedia', 'blockedSites'],
  function (result) {
    applyState(result.enabled !== false);
    const raw = result.urlPrefix || '';
    prefixList.value = raw;
    showPrefixStatus(parsePrefixes(raw));
    mediaToggle.checked = result.blockFloatingMedia !== false;
    const blocked = result.blockedSites || '';
    blockedList.value = blocked;
    showBlockedStatus(parseBlocked(blocked));
  }
);

toggle.addEventListener('change', function () {
  const enabled = toggle.checked;
  chrome.storage.local.set({ enabled });
  applyState(enabled);
});

prefixList.addEventListener('blur', savePrefixes);

addCurrent.addEventListener('click', function () {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (!tabs[0] || !tabs[0].url) return;
    try {
      const origin = new URL(tabs[0].url).origin + '/';
      const existing = prefixList.value.trim();
      if (existing.split('\n').some(function (l) { return l.trim() === origin; })) {
        prefixStatus.textContent = 'Already in list';
        prefixStatus.style.color = '#f39c12';
        return;
      }
      prefixList.value = existing ? existing + '\n' + origin : origin;
      savePrefixes();
    } catch (e) {}
  });
});

clearPrefix.addEventListener('click', function () {
  prefixList.value = '';
  chrome.storage.local.set({ urlPrefix: '' });
  showPrefixStatus([]);
});

blockedList.addEventListener('blur', saveBlocked);

addCurrentBlocked.addEventListener('click', function () {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (!tabs[0] || !tabs[0].url) return;
    try {
      const domain = new URL(tabs[0].url).hostname.toLowerCase();
      if (!domain) return;
      const existing = blockedList.value.trim();
      if (existing.split('\n').some(function (l) { return l.trim() === domain; })) {
        blockedStatus.textContent = 'Already blocked';
        blockedStatus.style.color = '#f39c12';
        return;
      }
      blockedList.value = existing ? existing + '\n' + domain : domain;
      saveBlocked();
    } catch (e) {}
  });
});

clearBlocked.addEventListener('click', function () {
  blockedList.value = '';
  chrome.storage.local.set({ blockedSites: '' });
  showBlockedStatus([]);
});

mediaToggle.addEventListener('change', function () {
  chrome.storage.local.set({ blockFloatingMedia: mediaToggle.checked });
});
