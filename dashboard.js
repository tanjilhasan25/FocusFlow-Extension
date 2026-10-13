document.addEventListener('DOMContentLoaded', () => {
  loadDashboardData();

  document.getElementById('reset-btn').addEventListener('click', () => {
    chrome.storage.local.set({
      'dwell_saves_count': 0,
      'tab_switches_blocked': 0,
      'last_read_context': null
    }, () => {
      loadDashboardData();
    });
  });
});

function loadDashboardData() {
  chrome.storage.local.get(['last_read_context', 'dwell_saves_count', 'tab_switches_blocked'], (data) => {
    // 1. Render Last Active Spatial Context
    const contextEl = document.getElementById('context-text');
    if (data.last_read_context && data.last_read_context.textSnippet) {
      contextEl.innerHTML = `<strong>${data.last_read_context.title.substring(0, 30)}...</strong><br>"${data.last_read_context.textSnippet}"`;
    } else {
      contextEl.innerText = "No spatial dwell context captured yet. Move cursor on text for 5s.";
    }

    // 2. Render Metrics
    document.getElementById('dwell-count').innerText = data.dwell_saves_count || 0;
    document.getElementById('shield-count').innerText = data.tab_switches_blocked || 0;

    // 3. Compute Cognitive Resumption Score (CRS Formula)
    const dwells = data.dwell_saves_count || 0;
    const blocks = data.tab_switches_blocked || 0;
    let crs = 85 + (dwells * 2) - (blocks * 3);
    if (crs > 100) crs = 100;
    if (crs < 50) crs = 50;

    document.getElementById('crs-score').innerText = crs + '%';
  });
}