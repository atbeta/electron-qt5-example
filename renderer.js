function readHostRect() {
  const host = document.getElementById('host');
  if (!host) return null;

  const rect = host.getBoundingClientRect();

  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
}

function syncHostRect() {
  const rect = readHostRect();
  if (!rect) return;
  window.qtSync.syncHostRect(rect);
}

let hasIframeRect = false;

function syncFromIframeRect(payload) {
  const iframe = document.getElementById('nuxt-frame');
  if (!iframe || !payload) return;
  const iframeRect = iframe.getBoundingClientRect();
  hasIframeRect = true;
  window.qtSync.syncHostRect({
    x: Math.round(iframeRect.left + Number(payload.x || 0)),
    y: Math.round(iframeRect.top + Number(payload.y || 0)),
    width: Math.max(1, Math.round(Number(payload.width || 1))),
    height: Math.max(1, Math.round(Number(payload.height || 1))),
  });
}

function renderQtState(result) {
  const stateEl = document.getElementById('qt-state');
  if (!stateEl || !result || !result.ok) return;
  stateEl.textContent = `状态：mode=${result.mode} visible=${result.visible} autoVisible=${result.autoVisible}`;
}

async function setQtVisibility(action) {
  if (!window.qtSync || !window.qtSync[action]) return;
  const result = await window.qtSync[action]();
  renderQtState(result);
}

let queued = false;
function scheduleSync() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    // If iframe is actively reporting target DOM rect, avoid sending fallback host rect.
    if (hasIframeRect) return;
    syncHostRect();
  });
}

window.addEventListener('DOMContentLoaded', () => {
  const host = document.getElementById('host');
  if (!host) return;
  const iframe = document.getElementById('nuxt-frame');
  const btnShow = document.getElementById('btn-qt-show');
  const btnHide = document.getElementById('btn-qt-hide');
  const btnToggle = document.getElementById('btn-qt-toggle');
  const btnAuto = document.getElementById('btn-qt-auto');

  const observer = new ResizeObserver(() => {
    scheduleSync();
  });
  observer.observe(host);

  window.addEventListener('resize', scheduleSync);
  window.addEventListener('scroll', scheduleSync, true);
  window.addEventListener('mousemove', scheduleSync);
  window.addEventListener('transitionend', scheduleSync, true);
  window.addEventListener('animationend', scheduleSync, true);

  const mutationObserver = new MutationObserver(() => {
    scheduleSync();
  });
  mutationObserver.observe(document.body, {
    attributes: true,
    childList: true,
    subtree: true,
  });

  const timer = setInterval(scheduleSync, 120);
  const onMessage = (event) => {
    if (!iframe || !event.data || event.data.type !== 'qt-follow-rect') {
      return;
    }
    if (event.source !== iframe.contentWindow) {
      return;
    }
    syncFromIframeRect(event.data);
  };
  window.addEventListener('message', onMessage);

  window.addEventListener('beforeunload', () => {
    clearInterval(timer);
    mutationObserver.disconnect();
    window.removeEventListener('message', onMessage);
  });

  if (btnShow) btnShow.addEventListener('click', () => setQtVisibility('show'));
  if (btnHide) btnHide.addEventListener('click', () => setQtVisibility('hide'));
  if (btnToggle) btnToggle.addEventListener('click', () => setQtVisibility('toggle'));
  if (btnAuto) btnAuto.addEventListener('click', () => setQtVisibility('auto'));

  scheduleSync();
  setQtVisibility('getState');
});
