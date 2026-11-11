document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get(['focusflow_live_context', 'dwell_total'], (data) => {
    const ctx = data.focusflow_live_context;
    if (ctx) {
      const word = ctx.mode === 'MOUSE' && ctx.targetWord ? ` (word: ${ctx.targetWord})` : '';
      document.getElementById('ext-context').innerText = `"${ctx.fullSentence}"${word}`;
    }
    document.getElementById('ext-dwells').innerText = data.dwell_total || 0;
  });

  // Inline onclick="" is blocked in Manifest V3 extension pages, so attach the handler here.
  document.getElementById('open-hub').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://focusflow-extension.vercel.app' });
  });
});
