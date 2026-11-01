document.addEventListener('DOMContentLoaded', () => {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['focusflow_last_context', 'dwell_count'], (data) => {
      if (data.focusflow_last_context) {
        document.getElementById('last-context').innerText = data.focusflow_last_context.textSnippet;
      }
      document.getElementById('dwell-count').innerText = data.dwell_count || 0;
    });
  }
});

function openVercelHub() {
  window.open("https://focusflow-extension.vercel.app", "_blank");
}
