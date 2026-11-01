let dwellTimer = null;
let lastElement = null;
let tabLeaveTime = 0;

// 1. Mouse & Viewport Fallback Context Tracking
document.addEventListener('mousemove', (e) => {
  const target = document.elementFromPoint(e.clientX, e.clientY);
  if (target && isReadable(target)) {
    if (lastElement !== target) {
      clearTimeout(dwellTimer);
      lastElement = target;
      dwellTimer = setTimeout(() => {
        markSpatialContext(target);
      }, 3000); // 3s Dwell threshold
    }
  }
});

// Viewport Fallback when no mouse is used
window.addEventListener('scroll', () => {
  if (!lastElement) {
    const paras = document.querySelectorAll('p, h1, h2, h3, article');
    for (let p of paras) {
      const rect = p.getBoundingClientRect();
      if (rect.top >= 150 && rect.top <= 350) {
        markSpatialContext(p);
        break;
      }
    }
  }
});

function isReadable(el) {
  const tags = ['P', 'H1', 'H2', 'H3', 'ARTICLE', 'SECTION', 'DIV', 'SPAN'];
  return tags.includes(el.tagName) && el.innerText && el.innerText.trim().length > 20;
}

function markSpatialContext(el) {
  const words = el.innerText.trim().split(" ");
  const lastWord = words[words.length - 1];
  
  const pageData = {
    url: window.location.href,
    title: document.title,
    lastWord: lastWord,
    textSnippet: el.innerText.substring(0, 60) + '...',
    scrollY: window.scrollY,
    timestamp: Date.now()
  };

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ 'focusflow_last_context': pageData });
    chrome.storage.local.get(['dwell_count'], (res) => {
      chrome.storage.local.set({ 'dwell_count': (res.dwell_count || 0) + 1 });
    });
  }
}

// 2. Return from Tab Context Recovery & Auto-Scroll Blink
window.addEventListener('focus', () => {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['focusflow_last_context'], (res) => {
      const data = res.focusflow_last_context;
      if (data && data.url === window.location.href) {
        // Auto scroll back to exact paragraph position
        window.scrollTo({ top: data.scrollY, behavior: 'smooth' });

        // Highlight & blink last word
        const paras = document.querySelectorAll('p, article, h1, h2');
        paras.forEach(p => {
          if (p.innerText.includes(data.lastWord)) {
            p.innerHTML = p.innerHTML.replace(data.lastWord, `<span class="focusflow-word-blink">${data.lastWord}</span>`);
          }
        });
      }
    });
  }
});

// 3. YouTube Hard Shielding on Video Page vs Home Page
if (window.location.hostname.includes('youtube.com')) {
  if (window.location.pathname.includes('/watch')) {
    // Hard blur on suggestions (no mouse hover unblur allowed)
    const style = document.createElement('style');
    style.innerHTML = `
      #related, ytd-watch-next-secondary-results-renderer, #comments {
        filter: blur(20px) opacity(0.05) !important;
        pointer-events: none !important;
      }
    `;
    document.head.appendChild(style);
  }
}
