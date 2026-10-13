let dwellTimer = null;
let tabStartTime = Date.now();
let alertFired = false;
let lastTrackedElement = null;
let lastMousePos = { x: 0, y: 0, time: Date.now() };

// 1. Spatial Dwell Engine (5-7s Dwell Coordinate Tracking)
document.addEventListener('mousemove', (e) => {
  trackMouseTrajectory(e);

  const target = document.elementFromPoint(e.clientX, e.clientY);
  
  if (target && isTrackableElement(target)) {
    if (lastTrackedElement !== target) {
      clearTimeout(dwellTimer);
      lastTrackedElement = target;

      // 5 Seconds dwell timer to save precise reading location
      dwellTimer = setTimeout(() => {
        saveSpatialContext(target);
      }, 5000); 
    }
  }
});

function isTrackableElement(el) {
  const validTags = ['P', 'H1', 'H2', 'H3', 'ARTICLE', 'SECTION', 'SPAN', 'DIV'];
  return validTags.includes(el.tagName) && el.innerText && el.innerText.trim().length > 20;
}

function saveSpatialContext(el) {
  // Remove glow from previous element
  document.querySelectorAll('.focusflow-active-context').forEach(node => {
    node.classList.remove('focusflow-active-context');
  });

  el.classList.add('focusflow-active-context');
  const textSnippet = el.innerText.substring(0, 60) + '...';

  const pageData = {
    url: window.location.href,
    title: document.title,
    textSnippet: textSnippet,
    timestamp: Date.now()
  };

  chrome.storage.local.set({ 'last_read_context': pageData });
  incrementMetric('dwell_saves_count');
}

// 2. Intent-Driven Mouse Trajectory Vector Analysis
function trackMouseTrajectory(e) {
  const now = Date.now();
  const dt = (now - lastMousePos.time) / 1000;
  if (dt <= 0) return;

  const dy = e.clientY - lastMousePos.y;
  const velocityY = dy / dt; // Negative means moving upwards to tabs

  // Detect rapid impulsive jump toward browser top tabs
  if (e.clientY < 50 && velocityY < -600 && !alertFired) {
    const activeTime = (now - tabStartTime) / 1000;
    if (activeTime >= 30) {
      triggerTabIntentAlert();
    }
  }

  lastMousePos = { x: e.clientX, y: e.clientY, time: now };
}

function triggerTabIntentAlert() {
  alertFired = true;
  incrementMetric('tab_switches_blocked');
  const stayChoice = confirm("⚡ FOCUSFLOW SHIELD: Impulsive tab switch detected after 30s of deep focus. Stay in context?");
  if (stayChoice) {
    setTimeout(() => { alertFired = false; }, 5000);
  } else {
    setTimeout(() => { alertFired = false; }, 2000);
  }
}

// 3. Context Restoration & HUD Toast on Focus
window.addEventListener('focus', () => {
  chrome.storage.local.get(['last_read_context'], (result) => {
    if (result.last_read_context && result.last_read_context.url === window.location.href) {
      showHUDToast(result.last_read_context.textSnippet);
    }
  });
});

function showHUDToast(text) {
  let existing = document.getElementById('focusflow-hud-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'focusflow-hud-toast';
  toast.innerHTML = `
    <span style="color:#00f2fe; font-weight:bold;">⚡ FOCUS ANCHOR:</span>
    <span>Last active position: "${text}"</span>
  `;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.6s ease';
    setTimeout(() => toast.remove(), 600);
  }, 5000);
}

function incrementMetric(key) {
  chrome.storage.local.get([key], (res) => {
    let count = res[key] || 0;
    chrome.storage.local.set({ [key]: count + 1 });
  });
}