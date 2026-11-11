let dwellTimer = null;
let lastTarget = null;

// 1. Mouse Dwell Tracking (Exact 3 Seconds)
document.addEventListener('mousemove', (e) => {
  const target = document.elementFromPoint(e.clientX, e.clientY);
  if (target && isReadable(target)) {
    if (lastTarget !== target) {
      clearTimeout(dwellTimer);
      lastTarget = target;
      dwellTimer = setTimeout(() => {
        saveReadingContext(target);
      }, 3000);
    }
  }
});

// Viewport Fallback for Keyboard Arrow Users
window.addEventListener('scroll', () => {
  const paras = document.querySelectorAll('p, h1, h2, h3, article');
  for (let p of paras) {
    const rect = p.getBoundingClientRect();
    if (rect.top >= 100 && rect.top <= 300) {
      saveReadingContext(p);
      break;
    }
  }
});

function isReadable(el) {
  const tags = ['P', 'H1', 'H2', 'H3', 'ARTICLE', 'SECTION', 'DIV'];
  return tags.includes(el.tagName) && el.innerText && el.innerText.trim().length > 15;
}

function saveReadingContext(el) {
  const text = el.innerText.trim();
  const words = text.split(" ");
  const lastWord = words[words.length - 1];

  const contextData = {
    url: window.location.href,
    title: document.title,
    lastWord: lastWord,
    textSnippet: text.substring(0, 50) + '...',
    scrollY: window.scrollY,
    timestamp: Date.now()
  };

  chrome.storage.local.set({ 'focusflow_live_context': contextData }, () => {
    chrome.storage.local.get(['dwell_total'], (res) => {
      const updatedTotal = (res.dwell_total || 0) + 1;
      chrome.storage.local.set({ 'dwell_total': updatedTotal });
    });
  });
}

// 2. Tab Return Recovery (Auto Scroll + 3 Second Red Border Blink)
window.addEventListener('focus', () => {
  chrome.storage.local.get(['focusflow_live_context'], (res) => {
    const data = res.focusflow_live_context;
    if (data && data.url === window.location.href) {
      // Auto Scroll up or down to saved reading position
      window.scrollTo({ top: data.scrollY, behavior: 'smooth' });

      // Highlight the exact last word with a subtle border for ONLY 3 Seconds
      const elements = document.querySelectorAll('p, h1, h2, h3, article');
      elements.forEach(el => {
        if (el.innerText.includes(data.lastWord) && !el.querySelector('.focusflow-border-pulse')) {
          el.innerHTML = el.innerHTML.replace(
            data.lastWord,
            `<span class="focusflow-border-pulse">${data.lastWord}</span>`
          );

          // Auto-remove blinking effect strictly after 3 seconds
          setTimeout(() => {
            const span = el.querySelector('.focusflow-border-pulse');
            if (span) {
              span.outerHTML = span.innerText;
            }
          }, 3000);
        }
      });
    }
  });
});

// 3. YouTube Hard Shielding (No Unblur on Mouse Hover)
if (window.location.hostname.includes('youtube.com')) {
  const style = document.createElement('style');
  style.innerHTML = `
    #related, ytd-watch-next-secondary-results-renderer, #comments, ytd-reel-shelf-renderer, ytd-rich-grid-renderer {
      filter: blur(16px) opacity(0.15) !important;
      pointer-events: none !important;
    }
  `;
  document.head.appendChild(style);
}

// 4. Live Bridge for Vercel Dashboard Sync
if (window.location.hostname.includes('vercel.app')) {
  setInterval(syncVercelDashboard, 800);
}

function syncVercelDashboard() {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['focusflow_live_context', 'dwell_total'], (data) => {
      const statusBadge = document.getElementById('cloud-status');
      const statusText = document.getElementById('status-text');
      const dwellEl = document.getElementById('cloud-dwells');
      const contextEl = document.getElementById('cloud-context');

      if (statusBadge && statusText) {
        statusBadge.className = "status-badge connected";
        statusText.innerText = "● Live Extension Connected";
      }
      if (dwellEl) {
        dwellEl.innerText = (data.dwell_total || 0) + " Dwells Anchored";
      }
      if (contextEl && data.focusflow_live_context) {
        contextEl.innerText = `"${data.focusflow_live_context.textSnippet}"`;
      }
    });
  }
}
