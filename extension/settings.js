// Settings shared by the home/listener page and the settings page. Stored in
// chrome.storage.local; outside the extension (dev server) the defaults are used.

(() => {
  const DEFAULTS = {
    wakeWord: 'computer',       // one word the speech model knows; yours to choose
    continueWord: 'continue',
    threshold: 0.5,            // 0..1, lower triggers more easily
    silenceTimeoutSec: 30,     // quiet time before a conversation is closed
    voiceButtonLabel: 'voice mode', // accessible name of Claude's voice button
    chimeEnabled: true,
    chimeVolume: 0.6,          // 0..1
    dimEnabled: true,
    dimStart: '22:00',         // night dimming window, 24-hour local time
    dimEnd: '07:00',
    paused: false,             // state, not a preference: "Pause listening" on the home screen
  };

  const store = typeof chrome !== 'undefined' && chrome.storage ? chrome.storage.local : null;

  async function load() {
    const saved = store ? await store.get(Object.keys(DEFAULTS)) : {};
    const out = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS)) {
      if (saved[key] !== undefined && saved[key] !== null && saved[key] !== '') out[key] = saved[key];
    }
    return out;
  }

  async function save(changes) {
    if (store) await store.set(changes);
  }

  // Calls back with { key: newValue } whenever a setting changes (from any page).
  function onChange(callback) {
    if (!store) return;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const out = {};
      for (const key of Object.keys(changes)) {
        if (key in DEFAULTS) {
          const v = changes[key].newValue;
          out[key] = v === undefined || v === null || v === '' ? DEFAULTS[key] : v;
        }
      }
      if (Object.keys(out).length) callback(out);
    });
  }

  // True when the local time is inside the dimming window (which may cross midnight).
  function isDimTime(settings, date = new Date()) {
    if (!settings.dimEnabled) return false;
    const toMinutes = (hhmm) => {
      const [h, m] = String(hhmm).split(':').map(Number);
      return (h || 0) * 60 + (m || 0);
    };
    const now = date.getHours() * 60 + date.getMinutes();
    const start = toMinutes(settings.dimStart);
    const end = toMinutes(settings.dimEnd);
    if (start === end) return false;
    return start < end ? now >= start && now < end : now >= start || now < end;
  }

  window.VLSettings = { DEFAULTS, load, save, onChange, isDimTime };
})();
