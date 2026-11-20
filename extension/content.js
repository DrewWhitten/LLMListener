// Content script (claude.ai).
// If this tab was opened by LLMListener: find the voice mode button by its accessible name, click it,
// then keep watching so the extension knows which chat this is and when voice mode ends.

(() => {
  const FIND_TIMEOUT_MS = 20000;
  const SETTLE_MS = 4000;      // how long after the click we wait before recording what changed
  const WATCH_INTERVAL_MS = 1000;
  const ENDED_AFTER_CHECKS = 3; // voice controls must be gone for this many checks in a row

  const log = (...args) => console.log('[LLMListener]', ...args);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function send(message) {
    try {
      chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError);
    } catch (e) {
      // extension was reloaded; nothing to report to
    }
  }

  // ---- microphone state, reported by mic-hook.js from the page's own context ----
  let micLive = 0;        // audio tracks the page holds right now
  let micEverLive = false;
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== 'vl-mic-hook') return;
    micLive = Number(e.data.live) || 0;
    if (micLive > 0) micEverLive = true;
  });

  // ---- on-page status banner ----
  let banner;
  function show(lines) {
    if (!banner) {
      banner = document.createElement('div');
      banner.style.cssText =
        'position:fixed;left:12px;bottom:12px;z-index:2147483647;max-width:520px;' +
        'padding:8px 10px;border-radius:8px;background:#111;color:#eee;' +
        'font:11px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap;' +
        'box-shadow:0 2px 12px rgba(0,0,0,.5);pointer-events:none;opacity:.85';
      document.documentElement.appendChild(banner);
    }
    banner.textContent = ['LLMListener'].concat(lines).join('\n');
    log(lines.join(' | '));
  }

  // ---- finding buttons by accessible name ----
  function nameOf(el) {
    return (
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.textContent ||
      ''
    ).replace(/\s+/g, ' ').trim();
  }

  function isUsable(el) {
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function allButtons() {
    return Array.from(document.querySelectorAll('button, [role="button"]'));
  }

  function buttonNames() {
    return new Set(allButtons().filter(isUsable).map(nameOf).filter(Boolean));
  }

  function findVoiceButton(label) {
    const want = label.toLowerCase();
    const matches = allButtons()
      .filter(isUsable)
      .map((el) => ({ el, name: nameOf(el).toLowerCase() }))
      .filter((b) => b.name.includes(want));
    if (!matches.length) return null;
    // Exact match wins; otherwise the shortest name (least likely to be "voice mode settings").
    matches.sort((a, b) => (b.name === want) - (a.name === want) || a.name.length - b.name.length);
    return matches[0].el;
  }

  function waitForVoiceButton(label) {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        const el = findVoiceButton(label);
        if (el) return resolve(el);
        if (Date.now() - started > FIND_TIMEOUT_MS) return resolve(null);
        setTimeout(tick, 250);
      };
      tick();
    });
  }

  // ---- clicking ----
  function scriptedClick(el) {
    const r = el.getBoundingClientRect();
    const init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
      button: 0,
    };
    // Some UI libraries act on pointerdown rather than click, so send the whole sequence.
    el.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerId: 1, pointerType: 'mouse', buttons: 1 }));
    el.dispatchEvent(new MouseEvent('mousedown', { ...init, buttons: 1 }));
    el.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerId: 1, pointerType: 'mouse' }));
    el.dispatchEvent(new MouseEvent('mouseup', init));
    el.click();
  }

  async function micPermission() {
    try {
      return (await navigator.permissions.query({ name: 'microphone' })).state;
    } catch (e) {
      return 'unknown';
    }
  }

  function fail(reason) {
    show(['FAILED: ' + reason]);
    send({ type: 'vl-failed', reason });
  }

  // ---- after voice mode has started ----
  // Voice mode counts as ended when the page has released the microphone. If the page was
  // never seen holding the microphone, fall back to the buttons: `controls` are the ones that
  // appeared when voice mode started, and it has ended when they are gone and the voice button
  // is back.
  function watch(label, controls) {
    let misses = 0;
    let reportedUrl = '';
    let ended = false;

    setInterval(() => {
      if (location.pathname.startsWith('/chat/')) {
        const url = location.origin + location.pathname;
        if (url !== reportedUrl) {
          reportedUrl = url;
          send({ type: 'vl-chat-url', url });
        }
      }

      if (ended) return;
      let active;
      if (micEverLive) {
        active = micLive > 0;
      } else if (controls.length) {
        const now = buttonNames();
        active = controls.some((name) => now.has(name)) || !findVoiceButton(label);
      } else {
        return; // nothing to go on; the listener's silence timer will end it
      }
      misses = active ? 0 : misses + 1;
      if (misses >= ENDED_AFTER_CHECKS) {
        ended = true;
        show(['voice mode ended (' + (micEverLive ? 'microphone released' : 'voice controls gone') + ')']);
        send({ type: 'vl-voice-ended', how: micEverLive ? 'microphone released' : 'voice controls gone' });
      }
    }, WATCH_INTERVAL_MS);
  }

  async function run({ label }) {
    if (location.pathname.startsWith('/login')) {
      return fail('not signed in to claude.ai');
    }

    show([`looking for a button named "${label}"...`]);
    const button = await waitForVoiceButton(label);
    if (!button) {
      const names = Array.from(buttonNames()).sort().slice(0, 30).map((n) => n.slice(0, 40));
      return fail(`no button named "${label}". Buttons on the page: ${names.join('; ')}`);
    }

    const clickedName = nameOf(button);
    const before = buttonNames();
    scriptedClick(button);
    show([`clicked "${clickedName}"`]);
    await sleep(SETTLE_MS);

    const after = buttonNames();
    const report = {
      clickedName,
      micPermission: await micPermission(),
      micInUse: micEverLive ? micLive > 0 : null, // null = the page was not seen opening the mic
      buttonsAdded: Array.from(after).filter((n) => !before.has(n)).sort(),
      buttonsRemoved: Array.from(before).filter((n) => !after.has(n)).sort(),
    };
    send({ type: 'vl-voice-started', report });
    show([
      `clicked "${clickedName}"  (mic permission: ${report.micPermission})`,
      micEverLive
        ? 'page is using the microphone; will end when it is released'
        : report.buttonsAdded.length
          ? 'voice controls: ' + report.buttonsAdded.map((n) => n.slice(0, 30)).join('; ')
          : 'no microphone use or voice controls detected; relying on the silence timer',
    ]);
    watch(label, report.buttonsAdded);
  }

  chrome.runtime.sendMessage({ type: 'vl-ready' }, (res) => {
    if (chrome.runtime.lastError || !res || !res.launch) return;
    run(res).catch((err) => fail('error: ' + (err && err.message ? err.message : err)));
  });
})();
