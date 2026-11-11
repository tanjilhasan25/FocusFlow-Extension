document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get(['focusflow_live_context', 'dwell_total'], (data) => {
    if (data.focusflow_live_context) {
      document.getElementById('ext-context').innerText = `"${data.focusflow_live_context.fullSentence}"`;
    }
    document.getElementById('ext-dwells').innerText = data.dwell_total || 0;
  });
});

function openCloudHub() {
  window.open("https://focusflow-extension.vercel.app", "_blank");
}
