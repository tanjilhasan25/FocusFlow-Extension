// FocusFlow content script
// - Tracks the exact word under the mouse (5s dwell) or the paragraph near the top of the
//   viewport (keyboard / non-mouse scrolling).
// - When you come back to the tab, scrolls to that spot (only if needed) and blinks a red
//   border around it for ~3 seconds. The page's own DOM is never modified.
(() => {
  'use strict';

  if (window.top !== window) return;
  if (window.__focusflowLoaded) return;
  window.__focusflowLoaded = true;

  // ---------- Settings ----------
  const DWELL_MS = 5000;        // exact dwell needed for the mouse anchor
  const SOFT_DWELL_MS = 1500;   // shorter rest, only used if you leave the tab before 5s
  const SOFT_VALID_MS = 8000;   // how long a soft anchor stays usable
  const REST_RADIUS = 12;       // px of jitter allowed while "resting"
  const PULSE_MS = 3000;
  const MIN_AWAY_TAB_MS = 600;  // minimum time away (tab switch) before we recover
  const MIN_AWAY_BLUR_MS = 4000; // minimum time away (app switch / clicking elsewhere)
  const MAX_AGE_MS = 7 * 24 * 3600 * 1000;
  const CTX_PREFIX = 'ff_ctx:';

  const SKIP_SELECTOR =
    'script, style, noscript, textarea, input, select, option, svg, canvas, ' +
    '[contenteditable=""], [contenteditable="true"], [type="password"]';
  const KB_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, dd, figcaption';

  // ---------- Safe extension API access (handles "Extension context invalidated") ----------
  function extOK() {
    try {
      return !!(chrome && chrome.runtime && chrome.runtime.id && chrome.storage && chrome.storage.local);
    } catch (_) {
      return false;
    }
  }

  function urlKey() {
    const u = new URL(location.href);
    u.hash = '';
    return CTX_PREFIX + u.href;
  }

  // ---------- Word / text helpers ----------
  const WORD_CH = /[\p{L}\p{N}\p{M}_]/u;

  function isWordCh(s, i) {
    const c = s[i];
    if (c === undefined) return false;
    if (WORD_CH.test(c)) return true;
    if ((c === "'" || c === '’' || c === '-') && i > 0 && i < s.length - 1 &&
        WORD_CH.test(s[i - 1]) && WORD_CH.test(s[i + 1])) return true;
    return false;
  }

  function wordAt(text, off) {
    let i = off;
    if (!isWordCh(text, i)) {
      if (isWordCh(text, i - 1)) i = i - 1;
      else return null;
    }
    let s = i;
    let e = i + 1;
    while (s > 0 && isWordCh(text, s - 1)) s--;
    while (e < text.length && isWordCh(text, e)) e++;
    return { start: s, end: e, word: text.slice(s, e) };
  }

  function caretFromPoint(x, y) {
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      if (p && p.offsetNode) return { node: p.offsetNode, offset: p.offset };
    }
    if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      if (r) return { node: r.startContainer, offset: r.startOffset };
    }
    return null;
  }

  // The exact word under a screen point (null if the point is not really over a word).
  function wordFromPoint(x, y) {
    const c = caretFromPoint(x, y);
    if (!c || !c.node || c.node.nodeType !== Node.TEXT_NODE) return null;
    const node = c.node;
    const parent = node.parentElement;
    if (!parent || parent.closest(SKIP_SELECTOR)) return null;
    const w = wordAt(node.data, c.offset);
    if (!w || w.word.length < 2) return null;

    // caret APIs snap to the nearest text, so confirm the pointer is truly over the word
    const r = document.createRange();
    r.setStart(node, w.start);
    r.setEnd(node, w.end);
    let hit = false;
    for (const rc of r.getClientRects()) {
      if (x >= rc.left - 4 && x <= rc.right + 4 && y >= rc.top - 4 && y <= rc.bottom + 4) {
        hit = true;
        break;
      }
    }
    return hit ? { node, start: w.start, end: w.end, word: w.word } : null;
  }

  function blockOf(node) {
    let el = node.nodeType === 1 ? node : node.parentElement;
    while (el && el !== document.body && el !== document.documentElement) {
      const d = getComputedStyle(el).display;
      if (!d.startsWith('inline') && d !== 'contents') return el;
      el = el.parentElement;
    }
    return document.body;
  }

  // Concatenated raw text of all text nodes under root, with a node -> offset map.
  function buildTextMap(root, cap = 400000) {
    const nodes = [];
    let text = '';
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentElement;
        if (!p || p.closest(SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
        return n.data.length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });
    let n;
    while ((n = walker.nextNode())) {
      nodes.push({ node: n, start: text.length });
      text += n.data;
      if (text.length > cap) break;
    }
    return { text, nodes };
  }

  function locate(map, off) {
    if (!map.nodes.length) return null;
    let lo = 0;
    let hi = map.nodes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (map.nodes[mid].start <= off) lo = mid;
      else hi = mid - 1;
    }
    const e = map.nodes[lo];
    return { node: e.node, offset: off - e.start };
  }

  function rangeFor(map, start, end) {
    const a = locate(map, start);
    const b = locate(map, end - 1);
    if (!a || !b) return null;
    const r = document.createRange();
    r.setStart(a.node, Math.min(a.offset, a.node.data.length));
    r.setEnd(b.node, Math.min(b.offset + 1, b.node.data.length));
    return r;
  }

  function rendered(range) {
    for (const rc of range.getClientRects()) {
      if (rc.width > 0 && rc.height > 0) return true;
    }
    return false;
  }

  function pathOf(el) {
    const parts = [];
    while (el && el.nodeType === 1 && el !== document.documentElement) {
      if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) {
        parts.unshift('#' + CSS.escape(el.id));
        break;
      }
      const parent = el.parentElement;
      if (!parent) break;
      const tag = el.tagName.toLowerCase();
      const same = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
      parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(el) + 1})` : tag);
      el = parent;
    }
    return parts.join(' > ');
  }

  function resolvePath(path) {
    if (!path) return null;
    try {
      return document.querySelector(path);
    } catch (_) {
      return null;
    }
  }

  function collapse(s) {
    return s.replace(/\s+/g, ' ').trim();
  }

  // Sentence (max ~90 chars) around a position, shown in the popup / dashboard.
  function sentenceAround(text, pos) {
    const stops = ['.', '?', '!', '।', '\n'];
    let left = 0;
    let right = text.length;
    for (const s of stops) {
      const l = text.lastIndexOf(s, pos - 1);
      if (l + 1 > left) left = l + 1;
      const r = text.indexOf(s, pos);
      if (r !== -1 && r + 1 < right) right = r + 1;
    }
    let sentence = collapse(text.slice(left, right));
    if (sentence.length > 90) {
      const rel = Math.max(0, Math.min(pos - left, sentence.length));
      const from = Math.max(0, rel - 40);
      sentence = (from > 0 ? '...' : '') + sentence.slice(from, from + 90) + '...';
    }
    return sentence;
  }

  // ---------- Building anchors ----------
  function buildMouseAnchor(x, y) {
    const w = wordFromPoint(x, y);
    if (!w) return null;
    const block = blockOf(w.node);
    const map = buildTextMap(block);
    const entry = map.nodes.find((n) => n.node === w.node);
    if (!entry) return null;
    const start = entry.start + w.start;
    const end = entry.start + w.end;
    return {
      mode: 'MOUSE',
      targetWord: w.word,
      before: map.text.slice(Math.max(0, start - 30), start),
      after: map.text.slice(end, end + 30),
      offset: start,
      path: pathOf(block),
      fullSentence: sentenceAround(map.text, start)
    };
  }

  function pickViewportBlock() {
    const vh = window.innerHeight;
    for (const el of document.querySelectorAll(KB_SELECTOR)) {
      const rc = el.getBoundingClientRect();
      if (rc.height < 8 || rc.width < 40) continue;
      if (rc.bottom < 120 || rc.top > vh * 0.7) continue;
      if (el.closest('nav, header, footer, aside, [role="navigation"]')) continue;
      if (el.closest(SKIP_SELECTOR)) continue;
      const t = (el.innerText || '').trim();
      if (t.length < 25) continue;
      return el;
    }
    return null;
  }

  function buildKeyboardAnchor(el) {
    const map = buildTextMap(el);
    const lead = map.text.search(/\S/);
    if (lead === -1) return null;
    const needle = map.text.slice(lead, lead + 50);
    const shown = collapse(el.innerText || map.text);
    return {
      mode: 'KEYBOARD',
      targetWord: '',
      needle,
      offset: lead,
      path: pathOf(el),
      fullSentence: shown.length > 90 ? shown.slice(0, 90) + '...' : shown
    };
  }

  // ---------- Saving ----------
  let lastSig = '';
  let suppressSaveUntil = 0;

  function commit(anchor, force) {
    if (!anchor || !extOK()) return;
    if (!force && document.visibilityState !== 'visible') return;
    const data = Object.assign({}, anchor, {
      url: location.href,
      title: (document.title || '').slice(0, 120),
      scrollY: Math.round(window.scrollY),
      timestamp: Date.now()
    });
    try {
      chrome.storage.local.set({ [urlKey()]: data, focusflow_live_context: data }).catch(() => {});
      const sig = [data.mode, data.path, data.offset, data.targetWord || data.needle].join('|');
      if (sig !== lastSig) {
        lastSig = sig;
        chrome.runtime.sendMessage({ type: 'FF_DWELL' }).catch(() => {});
      }
    } catch (_) { /* extension was reloaded; ignore */ }
  }

  // ---------- Mouse dwell ----------
  const mouse = { x: 0, y: 0, restX: -1000, restY: -1000, has: false, inside: false };
  let dwellTimer = null;
  let softTimer = null;
  let softAnchor = null; // { a, at }

  function armDwell() {
    clearTimeout(dwellTimer);
    clearTimeout(softTimer);
    mouse.restX = mouse.x;
    mouse.restY = mouse.y;
    const rx = mouse.restX;
    const ry = mouse.restY;

    softTimer = setTimeout(() => {
      if (document.visibilityState !== 'visible') return;
      const a = buildMouseAnchor(rx, ry);
      if (a) softAnchor = { a, at: Date.now() };
    }, SOFT_DWELL_MS);

    dwellTimer = setTimeout(() => {
      if (document.visibilityState !== 'visible' || Date.now() < suppressSaveUntil) return;
      const a = buildMouseAnchor(rx, ry);
      if (a) {
        softAnchor = { a, at: Date.now() };
        commit(a, false);
      }
    }, DWELL_MS);
  }

  document.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.has = true;
    mouse.inside = true;
    if (Math.hypot(e.clientX - mouse.restX, e.clientY - mouse.restY) > REST_RADIUS) armDwell();
  }, { passive: true });

  document.addEventListener('mouseout', (e) => {
    if (!e.relatedTarget) mouse.inside = false; // pointer left the page
  }, { passive: true });

  // ---------- Keyboard / non-mouse scrolling ----------
  let lastKeyNavAt = 0;
  let scrollTimer = null;

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(e.key)) {
      const t = e.target;
      if (t && t.closest && t.closest('input, textarea, select, [contenteditable]')) return;
      lastKeyNavAt = Date.now();
    }
  }, true);

  window.addEventListener('scroll', () => {
    softAnchor = null; // content moved, old soft anchor no longer reflects where you are
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(onScrollSettled, 350);
  }, { passive: true, capture: true });

  function onScrollSettled() {
    if (document.visibilityState !== 'visible' || Date.now() < suppressSaveUntil) return;
    const keyboard = Date.now() - lastKeyNavAt < 1500;
    if (keyboard || !mouse.has || !mouse.inside) {
      const el = pickViewportBlock();
      if (el) commit(buildKeyboardAnchor(el), false);
    } else {
      // mouse is parked, text moved underneath it: restart the dwell at the pointer
      armDwell();
    }
  }

  // ---------- Leaving / returning ----------
  let leftAt = 0;
  let wasHidden = false;

  function flushOnLeave() {
    clearTimeout(dwellTimer);
    clearTimeout(softTimer);
    if (softAnchor && Date.now() - softAnchor.at < SOFT_VALID_MS) {
      commit(softAnchor.a, true);
    }
    softAnchor = null;
  }

  function markLeft(hidden) {
    if (!leftAt) leftAt = Date.now();
    if (hidden) wasHidden = true;
    flushOnLeave();
  }

  function markBack() {
    if (!leftAt || document.visibilityState !== 'visible') return;
    const away = Date.now() - leftAt;
    const hidden = wasHidden;
    leftAt = 0;
    wasHidden = false;
    if (away < (hidden ? MIN_AWAY_TAB_MS : MIN_AWAY_BLUR_MS)) return;
    restoreAnchor({ allowScroll: hidden });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') markLeft(true);
    else markBack();
  });
  window.addEventListener('blur', () => markLeft(false));
  window.addEventListener('focus', markBack);
  window.addEventListener('pagehide', flushOnLeave);

  // ---------- Restoring ----------
  function searchRange(root, needle, wordPos, wordLen, hint, wholeWord) {
    const map = buildTextMap(root);
    let from = 0;
    let best = null;
    let bestDist = Infinity;
    for (;;) {
      const i = map.text.indexOf(needle, from);
      if (i === -1) break;
      const s = i + wordPos;
      const e = s + wordLen;
      const okBoundary = !wholeWord || (!isWordCh(map.text, s - 1) && !isWordCh(map.text, e));
      if (okBoundary) {
        const dist = hint == null ? 0 : Math.abs(s - hint);
        if (dist < bestDist) {
          const r = rangeFor(map, s, e);
          if (r && rendered(r)) {
            best = r;
            bestDist = dist;
          }
        }
      }
      from = i + 1;
    }
    return best;
  }

  function findWordRange(ctx) {
    const full = ctx.before + ctx.targetWord + ctx.after;
    const wordPos = ctx.before.length;
    const block = resolvePath(ctx.path);
    let r = null;
    if (block) {
      r = searchRange(block, full, wordPos, ctx.targetWord.length, ctx.offset - wordPos, false) ||
          searchRange(block, ctx.targetWord, 0, ctx.targetWord.length, ctx.offset, true);
      if (r) return r;
    }
    return searchRange(document.body, full, wordPos, ctx.targetWord.length, null, false);
  }

  function findKeyboardBlock(ctx) {
    const block = resolvePath(ctx.path);
    if (block && buildTextMap(block).text.includes(ctx.needle)) return block;
    const r = searchRange(document.body, ctx.needle, 0, ctx.needle.length, null, false);
    return r ? blockOf(r.startContainer) : null;
  }

  function resolveAnchor(ctx) {
    if (ctx.mode === 'MOUSE' && ctx.targetWord) {
      const range = findWordRange(ctx);
      if (!range) return null;
      return {
        scrollNode: range.startContainer.parentElement,
        getRects: () => Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0)
      };
    }
    if (ctx.mode === 'KEYBOARD' && ctx.needle) {
      const el = findKeyboardBlock(ctx);
      if (!el) return null;
      return { scrollNode: el, getRects: () => [el.getBoundingClientRect()] };
    }
    return null;
  }

  function nearViewport(rects) {
    if (!rects.length) return false;
    const r = rects[0];
    return r.bottom > 60 && r.top < window.innerHeight - 40;
  }

  let pulseActive = false;
  let overlayRoot = null;

  function ensureRoot() {
    if (!overlayRoot || !overlayRoot.isConnected) {
      overlayRoot = document.createElement('div');
      overlayRoot.id = 'focusflow-overlay-root';
      document.documentElement.appendChild(overlayRoot);
    }
    return overlayRoot;
  }

  function startPulse(target, mode) {
    pulseActive = true;
    const root = ensureRoot();
    const boxes = [];
    const cls = mode === 'MOUSE' ? 'focusflow-pulse-word' : 'focusflow-pulse-block';
    const pad = mode === 'MOUSE' ? 3 : 6;
    const t0 = performance.now();

    function end() {
      boxes.forEach((b) => b.remove());
      pulseActive = false;
    }

    function frame(now) {
      const rects = target.getRects();
      while (boxes.length < rects.length) {
        const b = document.createElement('div');
        b.className = 'focusflow-pulse-box ' + cls;
        root.appendChild(b);
        boxes.push(b);
      }
      boxes.forEach((b, i) => {
        const r = rects[i];
        if (!r) {
          b.style.display = 'none';
          return;
        }
        b.style.display = 'block';
        b.style.left = r.left - pad + 'px';
        b.style.top = r.top - pad + 'px';
        b.style.width = r.width + pad * 2 + 'px';
        b.style.height = r.height + pad * 2 + 'px';
      });
      if (now - t0 < PULSE_MS) requestAnimationFrame(frame);
      else end();
    }
    requestAnimationFrame(frame);
  }

  async function restoreAnchor({ allowScroll, fallbackScroll }) {
    if (!extOK() || pulseActive) return;
    const key = urlKey();
    let ctx;
    try {
      ctx = (await chrome.storage.local.get(key))[key];
    } catch (_) {
      return;
    }
    if (!ctx || Date.now() - ctx.timestamp > MAX_AGE_MS) return;

    suppressSaveUntil = Date.now() + 2500; // our own scroll must not overwrite the anchor
    const target = resolveAnchor(ctx);
    if (!target) {
      if (fallbackScroll && typeof ctx.scrollY === 'number') window.scrollTo(0, ctx.scrollY);
      return;
    }
    if (allowScroll && !nearViewport(target.getRects()) && target.scrollNode) {
      target.scrollNode.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    startPulse(target, ctx.mode);
  }

  // Tab was discarded by the browser and reloaded: recover as soon as the page is usable.
  if (document.wasDiscarded) {
    leftAt = Date.now() - 60000;
    wasHidden = true;
    setTimeout(() => {
      if (!leftAt || document.visibilityState !== 'visible') return;
      leftAt = 0;
      wasHidden = false;
      restoreAnchor({ allowScroll: true, fallbackScroll: true });
    }, 1200);
  }
})();
