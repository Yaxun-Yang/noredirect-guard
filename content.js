/**
 * NoRedirect Guard — content script (runs at document_start)
 *
 * Phase 1: Synchronously inject the interceptor into the page's own JS
 *          context so it runs before any site script can navigate away.
 * Phase 2: Build a Shadow-DOM notification bar and listen for messages
 *          posted by the interceptor.
 * Phase 3: Floating media blocker — hides fixed-position video overlays.
 */
(function () {
  'use strict';

  /* ── Shared secret so random page scripts can't spoof our messages ── */
  const NONCE = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

  /* ════════════════════════════════════════════════════════════════════
   * PHASE 1 — Inject interceptor into MAIN (page) context
   * ══════════════════════════════════════════════════════════════════*/
  const interceptorCode = `(function (NONCE) {
  'use strict';

  var _enabled = true; /* content script can disable via __nrg_ctrl message */
  var urlPrefix = '';  /* empty = no prefix lock; set via __nrg_ctrl */

  /* Track whether the user just interacted (tap / click / key).
     If yes, the resulting navigation is intentional — let it through
     UNLESS the prefix lock is active and the destination is outside it. */
  var userActive = false;
  var activeTimer = null;
  function markActive() {
    userActive = true;
    clearTimeout(activeTimer);
    activeTimer = setTimeout(function () { userActive = false; }, 1500);
  }
  ['click', 'touchend', 'touchstart', 'keydown', 'submit', 'pointerdown']
    .forEach(function (evt) {
      document.addEventListener(evt, markActive, { capture: true, passive: true });
    });

  /* Grab native methods before the page can overwrite them */
  var _assign  = location.assign.bind(location);
  var _replace = location.replace.bind(location);
  var _open    = window.open.bind(window);

  function emit(type, url, method, prefixBlocked) {
    window.postMessage(
      { __nrg: NONCE, type: type, url: String(url || ''), method: method || '',
        prefixBlocked: !!prefixBlocked },
      '*'
    );
  }

  /* Returns true if the URL is blocked by the prefix lock */
  function isBlockedByPrefix(url) {
    if (!urlPrefix) return false;
    try {
      var resolved = new URL(String(url || ''), location.href).href;
      return !resolved.startsWith(urlPrefix);
    } catch (ex) { return false; }
  }

  /* ── location.assign ── */
  try {
    location.assign = function (url) {
      if (!_enabled) return _assign(url);
      var pb = isBlockedByPrefix(url);
      if (!pb && userActive) return _assign(url);
      emit('redirect', url, 'assign', pb);
    };
  } catch (e) {}

  /* ── location.replace ── */
  try {
    location.replace = function (url) {
      if (!_enabled) return _replace(url);
      var pb = isBlockedByPrefix(url);
      if (!pb && userActive) return _replace(url);
      emit('redirect', url, 'replace', pb);
    };
  } catch (e) {}

  /* ── location.href = "…" ── */
  try {
    var proto    = Object.getPrototypeOf(location);
    var hrefDesc = Object.getOwnPropertyDescriptor(proto, 'href');
    if (hrefDesc && hrefDesc.set) {
      Object.defineProperty(proto, 'href', {
        get: hrefDesc.get,
        set: function (url) {
          if (!_enabled) return hrefDesc.set.call(location, url);
          var pb = isBlockedByPrefix(url);
          if (!pb && userActive) return hrefDesc.set.call(location, url);
          emit('redirect', url, 'href', pb);
        },
        configurable: true
      });
    }
  } catch (e) {}

  /* ── window.open() ── */
  try {
    window.open = function (url, target, features) {
      if (!_enabled) return _open(url, target, features);
      var pb = isBlockedByPrefix(url);
      if (!pb && userActive) return _open(url, target, features);
      emit('popup', url, 'open', pb);
      return null;
    };
  } catch (e) {}

  /* ── <a> tag click interception for prefix lock ── */
  document.addEventListener('click', function (e) {
    if (!_enabled || !urlPrefix) return;
    var t = e.target;
    while (t && t.tagName !== 'A') t = t.parentElement;
    if (!t || !t.href) return;
    var href = t.href; /* already absolute in DOM */
    /* Skip non-navigating protocols */
    if (/^(javascript|mailto|tel|data):/i.test(href)) return;
    if (!href.startsWith(urlPrefix)) {
      e.preventDefault();
      e.stopPropagation();
      emit('redirect', href, 'link', true);
    }
  }, true); /* capture phase */

  /* ── Navigation API — catches window.location = url and all other
       navigation methods that bypass location.assign/replace/href ── */
  try {
    if (window.navigation) {
      navigation.addEventListener('navigate', function (e) {
        if (!_enabled || !e.cancelable) return;
        var dest = e.destination.url;
        if (!dest) return;
        /* Prefix lock: block any navigation outside the prefix */
        var pb = isBlockedByPrefix(dest);
        if (pb) {
          e.preventDefault();
          emit('redirect', dest, 'navigate', true);
          return;
        }
        /* Normal redirect blocking: block non-user-initiated navigations */
        if (!userActive && dest !== location.href) {
          e.preventDefault();
          emit('redirect', dest, 'navigate', false);
        }
      });
    }
  } catch (e) {}

  /* ── Control messages from the isolated content script ── */
  window.addEventListener('message', function (e) {
    if (!e.data) return;
    if (e.data.__nrg_allow === NONCE) _assign(e.data.url);
    if (e.data.__nrg_ctrl  === NONCE) {
      _enabled   = !!e.data.enabled;
      urlPrefix  = e.data.urlPrefix || '';
    }
  });

  /* ── meta http-equiv="refresh" ── */
  function checkMeta(el) {
    if (!_enabled) return;
    if (!el || el.nodeType !== 1) return;
    if ((el.getAttribute('http-equiv') || '').toLowerCase() !== 'refresh') return;
    var content = el.getAttribute('content') || '';
    var m = content.match(/url=([^;]+)/i);
    var url = m ? m[1].trim().replace(/['"]/g, '') : location.href;
    el.removeAttribute('http-equiv'); /* defuse */
    emit('redirect', url, 'meta-refresh', isBlockedByPrefix(url));
  }
  function scanNode(node) {
    if (!node || node.nodeType !== 1) return;
    if (node.tagName === 'META') { checkMeta(node); return; }
    if (node.querySelectorAll) node.querySelectorAll('meta[http-equiv]').forEach(checkMeta);
  }

  new MutationObserver(function (mutations) {
    mutations.forEach(function (m) { m.addedNodes.forEach(scanNode); });
  }).observe(document.documentElement, { childList: true, subtree: true });

  if (document.querySelectorAll) {
    document.querySelectorAll('meta[http-equiv]').forEach(checkMeta);
  }

})(${JSON.stringify(NONCE)});`;

  /* Inject the script element synchronously */
  const s = document.createElement('script');
  s.textContent = interceptorCode;
  (document.documentElement || document.head || document).appendChild(s);
  s.remove();

  /* ════════════════════════════════════════════════════════════════════
   * PHASE 2 — Notification bar (Shadow DOM, isolated CSS)
   * ══════════════════════════════════════════════════════════════════*/
  let host, shadow, bar, destEl, titleEl, badgeEl;
  let hideTimer = null;

  function buildUI() {
    host = document.createElement('div');
    Object.assign(host.style, {
      position: 'fixed', top: '0', left: '0', width: '100%',
      zIndex: '2147483647', pointerEvents: 'none'
    });
    shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
      #bar {
        display: none;
        align-items: center;
        gap: 10px;
        background: #1a1a2e;
        color: #e8e8e8;
        font: 500 13px/1.4 -apple-system, system-ui, Arial, sans-serif;
        padding: 10px 14px;
        border-bottom: 3px solid #e74c3c;
        box-shadow: 0 3px 14px rgba(0,0,0,.55);
        pointer-events: all;
        box-sizing: border-box;
        width: 100%;
      }
      #bar.on { display: flex; }
      #bar.prefix { border-bottom-color: #f39c12; }
      #badge {
        font: 700 11px system-ui, sans-serif;
        background: #e74c3c;
        color: #fff;
        padding: 3px 7px;
        border-radius: 3px;
        white-space: nowrap;
        flex-shrink: 0;
      }
      #bar.prefix #badge { background: #f39c12; }
      #inf { flex: 1; min-width: 0; overflow: hidden; }
      #ttl { font-size: 12px; opacity: .8; margin-bottom: 2px; }
      #url {
        font-size: 11px; opacity: .5;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .btn {
        border: none; border-radius: 5px; padding: 7px 13px;
        cursor: pointer; font: 600 12px system-ui, sans-serif;
        white-space: nowrap; flex-shrink: 0;
        -webkit-tap-highlight-color: transparent;
      }
      #ok  { background: #27ae60; color: #fff; }
      #no  { background: #444;    color: #ccc; }
      .btn:active { opacity: .75; }
    `;

    bar = document.createElement('div');
    bar.id = 'bar';
    bar.innerHTML = `
      <span id="badge">BLOCKED</span>
      <div id="inf">
        <div id="ttl"></div>
        <div id="url"></div>
      </div>
      <button class="btn" id="ok">Allow once</button>
      <button class="btn" id="no">Dismiss</button>
    `;

    badgeEl = bar.querySelector('#badge');
    titleEl = bar.querySelector('#ttl');
    destEl  = bar.querySelector('#url');

    bar.querySelector('#ok').addEventListener('click', () => {
      const url = bar.dataset.pendingUrl;
      if (url) window.postMessage({ __nrg_allow: NONCE, url }, '*');
      hide();
    });
    bar.querySelector('#no').addEventListener('click', hide);

    shadow.appendChild(style);
    shadow.appendChild(bar);
    (document.documentElement || document.body).appendChild(host);
  }

  function show(data) {
    if (!host) buildUI();
    bar.dataset.pendingUrl = data.url;

    if (data.prefixBlocked) {
      bar.className = 'on prefix';
      badgeEl.textContent = 'PREFIX LOCK';
      titleEl.textContent = data.method === 'link'
        ? 'Link outside your zone blocked'
        : 'Redirect outside your zone blocked';
    } else if (data.type === 'popup') {
      bar.className = 'on';
      badgeEl.textContent = 'BLOCKED';
      titleEl.textContent = 'Popup window blocked';
    } else {
      bar.className = 'on';
      badgeEl.textContent = 'BLOCKED';
      titleEl.textContent = `Redirect blocked  (${data.method})`;
    }

    destEl.textContent = data.url || '(no destination)';
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 12000);
  }

  function hide() {
    if (bar) bar.className = '';
    clearTimeout(hideTimer);
  }

  /* ════════════════════════════════════════════════════════════════════
   * PHASE 3 — Floating overlay blocker
   *
   * Hides positioned overlays (fixed / absolute with high z-index)
   * that contain external links, cross-origin iframes, or video.
   * Targets JS-injected ad banners, floating video ads, etc.
   * ══════════════════════════════════════════════════════════════════*/
  function setupFloatingMediaBlocker() {
    const pageOrigin = location.origin;
    const pageHost   = location.hostname;
    const processed  = new WeakSet();

    function isCrossOrigin(href) {
      if (!href) return false;
      try { return new URL(href, location.href).hostname !== pageHost; }
      catch (e) { return false; }
    }

    /* Is this element a positioned overlay? (fixed, or absolute with high z-index) */
    function isOverlay(el) {
      try {
        const st = window.getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden') return false;
        const pos = st.position;
        if (pos === 'fixed') return true;
        if (pos === 'absolute') {
          const z = parseInt(st.zIndex, 10);
          return z >= 900;
        }
      } catch (e) {}
      return false;
    }

    /* Walk up from el to find the outermost overlay ancestor */
    function findOverlayRoot(el) {
      let root = null;
      let cur = el;
      while (cur && cur !== document.body && cur !== document.documentElement) {
        if (isOverlay(cur)) root = cur;
        cur = cur.parentElement;
      }
      return root;
    }

    /* Does this overlay contain content that links externally? */
    function hasExternalContent(el) {
      /* External <a> links */
      for (const a of el.querySelectorAll('a[href]')) {
        if (isCrossOrigin(a.href)) return true;
      }
      /* The element itself is an external link */
      if (el.tagName === 'A' && isCrossOrigin(el.href)) return true;
      /* Cross-origin iframes */
      for (const f of el.querySelectorAll('iframe')) {
        const src = f.src || f.getAttribute('src') || '';
        if (src && src !== 'about:blank' && isCrossOrigin(src)) return true;
      }
      if (el.tagName === 'IFRAME') {
        const src = el.src || el.getAttribute('src') || '';
        if (src && src !== 'about:blank' && isCrossOrigin(src)) return true;
      }
      /* <video> elements */
      if (el.tagName === 'VIDEO' || el.querySelector('video')) return true;
      return false;
    }

    function shouldHide(overlayEl) {
      if (processed.has(overlayEl)) return false;
      const rect = overlayEl.getBoundingClientRect();
      /* Skip tiny elements (tracking pixels, hidden helpers) */
      if (rect.width < 50 || rect.height < 50) return false;
      /* Skip near-full-screen elements (likely a modal or legitimate player) */
      if (rect.width > window.innerWidth * 0.9 &&
          rect.height > window.innerHeight * 0.9) return false;
      /* Skip our own notification bar host */
      if (overlayEl === host) return false;
      return hasExternalContent(overlayEl);
    }

    function hideEl(el) {
      processed.add(el);
      el.style.setProperty('display', 'none', 'important');
    }

    /* Check an element: find its overlay root and decide to hide */
    function checkEl(el) {
      if (!el || el.nodeType !== 1 || processed.has(el)) return;
      processed.add(el);
      const overlay = findOverlayRoot(el);
      if (overlay && shouldHide(overlay)) hideEl(overlay);
    }

    /* Also directly check elements that are themselves overlays */
    function checkOverlay(el) {
      if (!el || el.nodeType !== 1 || processed.has(el)) return;
      if (isOverlay(el) && shouldHide(el)) hideEl(el);
    }

    function sweep() {
      /* Check media & iframes via ancestor walk */
      document.querySelectorAll('video, iframe, a[href]').forEach(checkEl);
      /* Directly check elements with inline position styles */
      document.querySelectorAll('[style*="fixed"], [style*="absolute"]').forEach(checkOverlay);
    }

    const obs = new MutationObserver(function (mutations) {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          checkOverlay(node);
          checkEl(node);
          if (node.querySelectorAll) {
            node.querySelectorAll('video, iframe, a[href]').forEach(checkEl);
            node.querySelectorAll('[style*="fixed"], [style*="absolute"]').forEach(checkOverlay);
          }
        }
      }
    });
    obs.observe(document.documentElement || document, { childList: true, subtree: true });

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', sweep);
    } else {
      sweep();
    }

    /* Re-sweep periodically to catch late-injected ads whose styles
       change after insertion (e.g. initially hidden, then shown). */
    setInterval(sweep, 3000);
  }

  /* Check stored toggle state; default is enabled.
     If disabled, tell the page-context interceptor to pass through. */
  chrome.storage.local.get(['enabled', 'urlPrefix', 'blockFloatingMedia'], function (result) {
    const enabled            = result.enabled !== false;
    const urlPrefix          = result.urlPrefix || '';
    const blockFloatingMedia = result.blockFloatingMedia !== false;

    /* ── Safety net: if a redirect already landed us outside the prefix,
       stop the page and bounce back. This catches redirects that slip
       through before the injected interceptor receives the prefix
       (e.g. window.location = url, HTTP redirects, etc.). ── */
    if (urlPrefix && !location.href.startsWith(urlPrefix)) {
      try { window.stop(); } catch (e) {}
      if (history.length > 1) {
        history.back();
      } else {
        location.replace(urlPrefix);
      }
      return; /* don't set up anything else on this banned page */
    }

    /* Always send ctrl so injected script gets the latest urlPrefix */
    window.postMessage({ __nrg_ctrl: NONCE, enabled, urlPrefix }, '*');

    if (blockFloatingMedia) setupFloatingMediaBlocker();

    if (!enabled) return; /* don't set up redirect notification UI when disabled */

    /* Listen for interceptions from the injected page-context script */
    window.addEventListener('message', function (e) {
      if (e.data && e.data.__nrg === NONCE) show(e.data);
    });
  });
})();
