// Home/listener page. Shows the clock, owns the microphone and runs the offline
// wake-word engine.
//
// States:
//   idle          listening for the wake word
//   launching     wake word heard; Claude tab is opening (engine paused)
//   conversation  Claude's voice mode is running (engine paused; only the room level is watched,
//                 to notice a long silence)
// Only one conversation exists at a time, and the wake word is ignored until it has ended:
// when the Claude page reports voice mode ended, the tab is closed, or the room has been quiet
// for the silence timeout.

(async () => {
  const $ = (id) => document.getElementById(id);
  const inExtension = typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.id);
  const MAX_LOG = 200;
  const LAUNCH_TIMEOUT_MS = 60000;
  const RESUME_DELAY_MS = 1500; // let the room settle before listening again
  const CUE_MS = 2500;
  const counts = { wake: 0, rejected: 0 };

  const settings = await VLSettings.load();

  // ---- status: full text in the details panel, short text in the home-screen pill ----
  function setStatus(kind, text, pill) {
    $('status').className = 'status ' + kind;
    $('status').textContent = text;
    document.body.dataset.state = kind;
    $('pillText').textContent = pill || text;
  }

  function addLog(kind, text) {
    const li = document.createElement('li');
    li.className = kind;
    li.textContent = new Date().toLocaleTimeString() + '  ' + text;
    $('log').prepend(li);
    while ($('log').children.length > MAX_LOG) $('log').lastChild.remove();
    $('counts').textContent = `${counts.wake} triggered, ${counts.rejected} below threshold`;
  }

  // ---- clock, night dimming ----
  function tick() {
    const now = new Date();
    $('time').textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    $('date').textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    document.body.classList.toggle('dim', VLSettings.isDimTime(settings, now));
    // Nudge the clock a little each minute so a static image is not burned into the screen.
    const m = now.getMinutes();
    $('clock').style.transform = `translate(${((m % 5) - 2) * 6}px, ${((m % 3) - 1) * 6}px)`;
  }
  tick();
  setInterval(tick, 5000);

  $('clock').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  });
  $('detailsBtn').addEventListener('click', () => { $('details').hidden = false; });
  $('closeDetails').addEventListener('click', () => { $('details').hidden = true; });

  // Only one listener may run. A second copy of this page would hear the same wake word and
  // ask for a second conversation.
  const isOnlyListener = await new Promise((resolve) => {
    navigator.locks.request('vl-listener', { ifAvailable: true }, (lock) => {
      resolve(!!lock);
      return lock ? new Promise(() => {}) : undefined; // hold the lock for the life of the page
    });
  });
  if (!isOnlyListener) {
    setStatus('error', 'LLMListener is already listening in another tab. Close this one.', 'Already running in another tab');
    return;
  }

  // ---- engine ----
  $('threshold').value = settings.threshold;
  $('thresholdValue').textContent = Number(settings.threshold).toFixed(2);

  let engine;
  try {
    engine = await VLWake.create({
      threshold: settings.threshold,
      wakeWord: settings.wakeWord,
      continueWord: settings.continueWord,
    });
  } catch (err) {
    setStatus('error', 'Could not load the speech model: ' + (err && err.message ? err.message : err), 'Speech model failed to load');
    return;
  }

  if (!engine.tuned) {
    addLog('other', `wake word "${engine.wakeWord}" has no tuning profile (see PROFILES in wake.js); expect more false triggers from similar-sounding words`);
  }

  $('threshold').addEventListener('input', () => {
    settings.threshold = Number($('threshold').value);
    engine.threshold = settings.threshold;
    $('thresholdValue').textContent = settings.threshold.toFixed(2);
    VLSettings.save({ threshold: settings.threshold });
  });

  // ---- state ----
  let state = 'idle';
  let manualPause = false;
  let reloadWhenIdle = false;
  let launchTimer = null;
  let lastSoundAt = 0;
  let speechLevel = 0.02;  // room level above which we count "someone is talking"
  const idleLevels = [];   // recent room levels while idle, to learn the background noise
  let audio = null;        // AudioContext, once the microphone is open

  const wakeName = () => engine.wakeWord.charAt(0).toUpperCase() + engine.wakeWord.slice(1);

  function showListening() {
    setStatus('listening',
      `Listening offline for "${engine.wakeWord}" and "${engine.continueWord} ${engine.wakeWord}".`,
      `Say “${wakeName()}”`);
  }

  function showConversation() {
    setStatus('paused',
      `In conversation. Returns here after ${settings.silenceTimeoutSec} s of silence or when voice mode ends. The wake word is ignored until then.`,
      'In conversation');
  }

  function learnSpeechLevel() {
    if (idleLevels.length < 20) return;
    const sorted = idleLevels.slice().sort((a, b) => a - b);
    const quiet = sorted[Math.floor(sorted.length * 0.2)]; // background noise, ignoring speech
    speechLevel = Math.max(0.01, quiet * 3);
  }

  // Wake cue: full-screen pulse plus a chime.
  function cue(action) {
    $('cueText').textContent = action === 'continue' ? 'Continuing…' : 'Yes?';
    document.body.classList.toggle('cue-continue', action === 'continue');
    document.body.classList.add('cue');
    setTimeout(() => document.body.classList.remove('cue'), CUE_MS);
    if (settings.chimeEnabled && audio) VLChime.play(audio, action, settings.chimeVolume);
  }

  // Ask the background to close the conversation. If it has no record of one (the two got out
  // of step), go back to listening anyway rather than staying stuck.
  async function requestEnd(reason) {
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'vl-end', reason });
    } catch (err) {
      res = null;
    }
    if ((!res || !res.ended) && state !== 'idle') {
      addLog('other', `conversation ended: ${reason} (no open Claude tab was recorded)`);
      backToIdle();
    }
  }

  function leaveIdle() {
    engine.pause();
    learnSpeechLevel();
    $('toggle').textContent = 'End conversation';
  }

  function beginLaunch(action) {
    state = 'launching';
    leaveIdle();
    setStatus('paused', action === 'continue' ? 'Reopening the last chat…' : 'Opening a new chat…');
    clearTimeout(launchTimer);
    launchTimer = setTimeout(() => {
      addLog('rejected', 'voice mode did not start within 60 s; giving up');
      requestEnd('launch-timeout');
    }, LAUNCH_TIMEOUT_MS);
  }

  // A conversation is already running (for example this page was reloaded during one).
  // Join it: stay quiet until it ends.
  function joinConversation(why) {
    clearTimeout(launchTimer);
    state = 'conversation';
    leaveIdle();
    lastSoundAt = performance.now();
    showConversation();
    addLog('other', why);
  }

  function backToIdle() {
    clearTimeout(launchTimer);
    state = 'idle';
    if (reloadWhenIdle) return location.reload();
    engine.flush(); // drop anything half-heard from before the conversation
    $('toggle').textContent = manualPause ? 'Resume' : 'Pause';
    setStatus('paused', 'Conversation over. Resuming…');
    setTimeout(() => {
      if (state !== 'idle') return;
      if (manualPause) return setStatus('paused', 'Paused. Not reacting to audio.', 'Paused');
      engine.resume();
      showListening();
    }, RESUME_DELAY_MS);
  }

  async function onWake(action) {
    if (state !== 'idle') return;
    cue(action);
    if (!inExtension) return; // dev server: detection only
    beginLaunch(action);
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'vl-wake', action });
    } catch (err) {
      res = { ok: false, reason: String(err && err.message ? err.message : err) };
    }
    if (res && res.ok) {
      if (action === 'continue' && res.action === 'new') {
        addLog('other', 'no earlier chat saved yet, so a new chat was opened');
      }
    } else if (res && res.active) {
      joinConversation('a conversation is already open; ignoring the wake word until it ends');
    } else {
      addLog('rejected', 'could not launch: ' + ((res && res.reason) || 'no response'));
      backToIdle();
    }
  }

  if (inExtension) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg) return;
      if (msg.type === 'vl-wake-external' && state === 'idle') {
        addLog('wake', 'manual launch (keyboard shortcut)');
        beginLaunch(msg.action);
      } else if (msg.type === 'vl-started') {
        clearTimeout(launchTimer);
        if (state === 'idle') leaveIdle();
        state = 'conversation';
        lastSoundAt = performance.now();
        showConversation();
        const r = msg.report || {};
        const mic = r.micInUse == null ? 'Claude tab not seen opening the microphone' : r.micInUse ? 'Claude tab is using the microphone' : 'Claude tab opened then released the microphone';
        addLog('other',
          `voice mode started: clicked "${r.clickedName}"; ${mic}; ` +
          `appeared [${(r.buttonsAdded || []).join('; ')}]; went away [${(r.buttonsRemoved || []).join('; ')}]`);
        addLog('other', `silence timer: room level must stay under ${speechLevel.toFixed(3)} for ${settings.silenceTimeoutSec} s`);
      } else if (msg.type === 'vl-ended') {
        if (state === 'idle') return;
        addLog(msg.reason === 'failed' ? 'rejected' : 'other',
          'conversation ended: ' + msg.reason + (msg.detail ? ' (' + msg.detail + ')' : ''));
        backToIdle();
      }
    });
  }

  // Settings changed on the settings page: apply at once where possible.
  VLSettings.onChange((changes) => {
    Object.assign(settings, changes);
    if ('threshold' in changes) {
      engine.threshold = Number(settings.threshold);
      $('threshold').value = settings.threshold;
      $('thresholdValue').textContent = Number(settings.threshold).toFixed(2);
    }
    if ('wakeWord' in changes || 'continueWord' in changes) {
      // The recognizer is built around these words, so start over (after any conversation).
      if (state === 'idle') location.reload();
      else reloadWhenIdle = true;
    }
    tick();
  });

  engine.addEventListener('partial', (e) => {
    $('partial').textContent = e.detail.text || '—';
  });
  engine.addEventListener('final', (e) => {
    $('partial').textContent = '—';
    // Log everything heard, with per-word confidence, so misses can be diagnosed from the page.
    addLog('other', 'heard  ' + e.detail.words.map((w) => `${w.word} ${w.conf.toFixed(2)}`).join(', '));
  });
  engine.addEventListener('wake', (e) => {
    counts.wake++;
    const d = e.detail;
    addLog('wake', `WAKE (${d.action === 'continue' ? 'continue last chat' : 'new chat'})  confidence ${d.confidence.toFixed(2)}  "${d.text}"`);
    onWake(d.action);
  });
  engine.addEventListener('rejected', (e) => {
    counts.rejected++;
    const d = e.detail;
    addLog('rejected', `below threshold  confidence ${d.confidence.toFixed(2)} < ${d.threshold.toFixed(2)}  "${d.text}"`);
  });

  // ---- microphone ----
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    setStatus('error',
      'Microphone unavailable (' + err.name + '). Allow microphone access for this page, then reload.',
      'Microphone unavailable');
    return;
  }

  const ctx = new AudioContext({ sampleRate: engine.sampleRate });
  audio = ctx;
  await ctx.audioWorklet.addModule('capture-worklet.js');
  const capture = new AudioWorkletNode(ctx, 'wake-capture');
  ctx.createMediaStreamSource(stream).connect(capture);

  let peak = 0;
  capture.port.onmessage = (e) => {
    const samples = e.data;
    let sumSquares = 0;
    for (let i = 0; i < samples.length; i++) {
      const v = Math.abs(samples[i]);
      if (v > peak) peak = v;
      sumSquares += v * v;
    }
    const level = Math.sqrt(sumSquares / samples.length);

    if (state === 'idle') {
      idleLevels.push(level);
      if (idleLevels.length > 300) idleLevels.shift(); // about the last 30 seconds
      engine.feed(samples);
    } else if (state === 'conversation') {
      // Nothing is recognized here. We only notice whether the room (you or Claude) is making
      // sound, so a conversation that has gone quiet can be closed.
      const now = performance.now();
      if (level > speechLevel) {
        lastSoundAt = now;
      } else if (now - lastSoundAt > settings.silenceTimeoutSec * 1000) {
        lastSoundAt = now; // ask once
        requestEnd('silence');
      }
    }
  };
  setInterval(() => {
    $('level').style.width = Math.min(100, Math.round(peak * 140)) + '%';
    peak = 0;
  }, 100);

  // If a conversation is already running (this page was reloaded mid-conversation), join it
  // instead of listening.
  let alreadyActive = false;
  if (inExtension) {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'vl-status' });
      alreadyActive = !!(res && res.active);
    } catch (err) {
      // background not reachable; start listening normally
    }
  }

  const startIdle = () => { if (state === 'idle' && !manualPause) showListening(); };
  if (alreadyActive) {
    joinConversation('a conversation was already open when this page loaded; waiting for it to end');
  } else if (ctx.state === 'running') {
    showListening();
  }
  // Chrome may hold audio until the page has been clicked once.
  if (ctx.state !== 'running') {
    if (!alreadyActive) setStatus('paused', 'Click anywhere on this page to start listening.', 'Click to start listening');
    document.addEventListener('click', async () => { await ctx.resume(); startIdle(); }, { once: true });
    ctx.resume().then(() => { if (ctx.state === 'running') startIdle(); });
  }

  $('toggle').disabled = false;
  $('toggle').addEventListener('click', () => {
    if (state !== 'idle') {
      requestEnd('ended from the listener page');
      return;
    }
    manualPause = !manualPause;
    if (manualPause) {
      engine.pause();
      $('toggle').textContent = 'Resume';
      setStatus('paused', 'Paused. Not reacting to audio.', 'Paused');
    } else {
      engine.resume();
      $('toggle').textContent = 'Pause';
      showListening();
    }
  });
})();
