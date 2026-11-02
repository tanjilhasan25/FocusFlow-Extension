document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get(['focusflow_live_context', 'dwell_total', 'session_code'], (data) => {
    if (data.session_code) {
      document.getElementById('popup-code').innerText = data.session_code;
    } else {
      const newCode = Math.floor(1000 + Math.random() * 9000).toString();
      chrome.storage.local.set({ 'session_code': newCode }, () => {
        document.getElementById('popup-code').innerText = newCode;
      });
    }
    document.getElementById('ext-dwells').innerText = data.dwell_total || 0;
  });
});

function openCloudHub() {
  window.open("https://focusflow-extension.vercel.app", "_blank");
}
