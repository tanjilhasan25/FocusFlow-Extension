// Live bridge: runs ONLY on the FocusFlow hub page (see manifest) and shows the
// extension's latest reading anchor and dwell count there.
(() => {
  function render(data) {
    const badge = document.getElementById('cloud-status');
    const text = document.getElementById('status-text');
    const dwellEl = document.getElementById('cloud-dwells');
    const contextEl = document.getElementById('cloud-context');
    const ctx = data.focusflow_live_context;

    if (badge && text) {
      badge.className = 'status-badge connected';
      text.innerText = '● Live Extension Connected';
    }
    if (dwellEl) dwellEl.innerText = (data.dwell_total || 0) + ' Dwells Anchored';
    if (contextEl && ctx) {
      contextEl.innerText = `[Mode: ${ctx.mode}] "${ctx.fullSentence}"`;
    }
  }

  function read() {
    try {
      chrome.storage.local.get(['focusflow_live_context', 'dwell_total']).then(render).catch(() => {});
    } catch (_) { /* extension was reloaded; refresh the page */ }
  }

  read();
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (changes.focusflow_live_context || changes.dwell_total)) read();
    });
  } catch (_) { /* ignore */ }
})();
