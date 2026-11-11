let dwellTimer = null;
let lastTarget = null;
let isMouseActive = false;
let mouseMoveTimeout = null;

// 1. Precise Mouse Dwell & Keyboard Detection
document.addEventListener('mousemove', (e) => {
  isMouseActive = true;
  clearTimeout(mouseMoveTimeout);
  
  mouseMoveTimeout = setTimeout(() => {
    isMouseActive = false;
  }, 2500);

  const target = document.elementFromPoint(e.clientX, e.clientY);
  if (target && isReadable(target)) {
    if (lastTarget !== target) {
      clearTimeout(dwellTimer);
      lastTarget = target;
      
      // Exactly 5 seconds dwell for mouse
      dwellTimer = setTimeout(() => {
        saveReadingContext(target, 'MOUSE');
      }, 5000);
    }
  }
});

// Viewport Fallback for Keyboard Arrow Navigation (No Mouse on text)
window.addEventListener('scroll', () => {
  if (!isMouseActive) {
    const elements = document.querySelectorAll('p, h1, h2, h3, article');
    for (let el of elements) {
      const rect = el.getBoundingClientRect();
      if (rect.top >= 100 && rect.top <= 350) {
        saveReadingContext(el, 'KEYBOARD');
        break;
      }
    }
  }
});

function isReadable(el) {
  const tags = ['P', 'H1', 'H2', 'H3', 'ARTICLE', 'SECTION', 'SPAN'];
  return tags.includes(el.tagName) && el.innerText && el.innerText.trim().length > 5;
}

function saveReadingContext(el, mode) {
  const text = el.innerText.trim();
  let targetWord = "";

  if (mode === 'MOUSE') {
    // Extract exact single word where mouse stayed
    const words = text.split(/\s+/);
    targetWord = words[Math.floor(words.length / 2)] || words[words.length - 1];
  }

  const contextData = {
    url: window.location.href,
    mode: mode, // 'MOUSE' or 'KEYBOARD'
    targetWord: targetWord,
    fullSentence: text.substring(0, 90) + '...',
    scrollY: window.scrollY,
    timestamp: Date.now()
  };

  chrome.storage.local.set({ 'focusflow_live_context': contextData }, () => {
    chrome.storage.local.get(['dwell_total'], (res) => {
      chrome.storage.local.set({ 'dwell_total': (res.dwell_total || 0) + 1 });
    });
  });
}

// 2. Tab Return: Auto-Scroll Recovery & 2-3 Sec Pulsing Border Blink
window.addEventListener('focus', () => {
  chrome.storage.local.get(['focusflow_live_context'], (res) => {
    const data = res.focusflow_live_context;
    if (data && data.url === window.location.href) {
      // Auto Scroll to exact saved Y position (up or down automatically)
      window.scrollTo({ top: data.scrollY, behavior: 'smooth' });

      setTimeout(() => {
        const elements = document.querySelectorAll('p, h1, h2, h3, article, span');
        elements.forEach(el => {
          if (data.mode === 'MOUSE' && data.targetWord) {
            // CASE 1: Mouse Mode -> Highlight ONLY the exact word
            if (el.innerText.includes(data.targetWord) && !el.querySelector('.focusflow-word-pulse')) {
              el.innerHTML = el.innerHTML.replace(
                data.targetWord,
                `<span class="focusflow-word-pulse">${data.targetWord}</span>`
              );

              // Remove blinking strictly after 3 seconds
              setTimeout(() => {
                const span = el.querySelector('.focusflow-word-pulse');
                if (span) span.outerHTML = span.innerText;
              }, 3000);
            }
          } else if (data.mode === 'KEYBOARD') {
            // CASE 2: Keyboard Mode -> Highlight Full Sentence/Paragraph
            if (el.innerText.includes(data.fullSentence.substring(0, 30))) {
              if (!el.classList.contains('focusflow-sentence-pulse')) {
                el.classList.add('focusflow-sentence-pulse');

                // Remove blinking strictly after 3 seconds
                setTimeout(() => {
                  el.classList.remove('focusflow-sentence-pulse');
                }, 3000);
              }
            }
          }
        });
      }, 400);
    }
  });
});

// 3. YouTube Real Blur Shield (Non-bypassable, clear blur effect)
if (window.location.hostname.includes('youtube.com')) {
  const ytStyle = document.createElement('style');
  ytStyle.innerHTML = `
    #related, ytd-watch-next-secondary-results-renderer, #comments, ytd-reel-shelf-renderer, ytd-rich-grid-renderer {
      filter: blur(15px) !important;
      opacity: 0.55 !important;
      pointer-events: none !important;
    }
  `;
  document.head.appendChild(ytStyle);
}

// 4. Live Vercel Dashboard Sync Bridge
if (window.location.hostname.includes('vercel.app')) {
  setInterval(() => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['focusflow_live_context', 'dwell_total'], (data) => {
        const badge = document.getElementById('cloud-status');
        const text = document.getElementById('status-text');
        const dwellEl = document.getElementById('cloud-dwells');
        const contextEl = document.getElementById('cloud-context');

        if (badge && text) {
          badge.className = "status-badge connected";
          text.innerText = "● Live Extension Connected";
        }
        if (dwellEl) {
          dwellEl.innerText = (data.dwell_total || 0) + " Dwells Anchored";
        }
        if (contextEl && data.focusflow_live_context) {
          contextEl.innerText = `[Mode: ${data.focusflow_live_context.mode}] "${data.focusflow_live_context.fullSentence}"`;
        }
      });
    }
  }, 1000);
}
