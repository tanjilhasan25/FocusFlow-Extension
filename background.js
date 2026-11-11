// Keeps the dwell counter correct even when several tabs report at the same time,
// and removes old per-page reading anchors so storage does not grow forever.
const CTX_PREFIX = 'ff_ctx:';
const MAX_CONTEXTS = 150;
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

let queue = Promise.resolve();

async function prune() {
  const all = await chrome.storage.local.get(null);
  const now = Date.now();
  const entries = Object.entries(all)
    .filter(([k]) => k.startsWith(CTX_PREFIX))
    .map(([k, v]) => [k, (v && v.timestamp) || 0]);

  const stale = entries.filter(([, t]) => now - t > MAX_AGE_MS).map(([k]) => k);
  const extra = entries
    .filter(([, t]) => now - t <= MAX_AGE_MS)
    .sort((a, b) => b[1] - a[1])
    .slice(MAX_CONTEXTS)
    .map(([k]) => k);

  const remove = [...stale, ...extra];
  if (remove.length) await chrome.storage.local.remove(remove);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'FF_DWELL') {
    // one at a time, so two tabs can never overwrite each other's increment
    queue = queue
      .then(async () => {
        const { dwell_total = 0 } = await chrome.storage.local.get('dwell_total');
        const next = dwell_total + 1;
        await chrome.storage.local.set({ dwell_total: next });
        if (next % 20 === 0) await prune();
      })
      .catch(() => {});
  }
});

chrome.runtime.onStartup.addListener(() => {
  prune().catch(() => {});
});
