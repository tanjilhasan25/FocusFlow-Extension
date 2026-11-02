let dwellTimer = null;
let lastTarget = null;

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

  chrome.storage.local.get(['session_code'], (res) => {
    if (!res.session_code) {
      const randomCode = Math.floor(1000 + Math.random() * 9000).toString();
      chrome.storage.local.set({ 'session_code': randomCode });
    }
  });

  chrome.storage.local.set({ 'focusflow_live_context': contextData }, () => {
    chrome.storage.local.get(['dwell_total'], (res) => {
      chrome.storage.local.set({ 'dwell_total': (res.dwell_total || 0) + 1 });
    });
  });
}

window.addEventListener('focus', () => {
  chrome.storage.local.get(['focusflow_live_context'], (res) => {
    const data = res.focusflow_live_context;
    if (data && data.url === window.location.href) {
      window.scrollTo({ top: data.scrollY, behavior: 'smooth' });

      const elements = document.querySelectorAll('p, h1, h2, h3, article');
      elements.forEach(el => {
        if (el.innerText.includes(data.lastWord)) {
          if (!el.innerHTML.includes('focusflow-red-border-blink')) {
            el.innerHTML = el.innerHTML.replace(
              data.lastWord, 
              `<span class="focusflow-red-border-blink">${data.lastWord}</span>`
            );
          }
        }
      });
    }
  });
});

// Auto Sync with Vercel Dashboard via Content Script Injection
if (window.location.hostname.includes('vercel.app')) {
  setTimeout(autoSyncVercel, 800);
}

function autoSyncVercel() {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['focusflow_live_context', 'dwell_total', 'session_code'], (data) => {
      const badge = document.getElementById('cloud-status');
      const text = document.getElementById('status-text');
      const dwellEl = document.getElementById('cloud-dwells');
      const contextEl = document.getElementById('cloud-context');
      const codeDisplay = document.getElementById('display-session-code');

      if (badge && text) {
        badge.className = "status-badge connected";
        text.innerText = "● Live Extension Connected";
      }
      if (dwellEl) {
        dwellEl.innerText = (data.dwell_total || 0) + " Positions";
      }
      if (contextEl && data.focusflow_live_context) {
        contextEl.innerText = `"${data.focusflow_live_context.textSnippet}"`;
      }
      if (codeDisplay && data.session_code) {
        codeDisplay.innerText = data.session_code;
      }
    });
  }
}
