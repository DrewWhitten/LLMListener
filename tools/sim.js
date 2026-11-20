// End-to-end simulation of the listener page without a microphone or the extension:
//   - a fake microphone plays the WAVs in tools/wav
//   - a fake chrome.* stands in for the background (it "starts voice mode" 1 s after a wake and
//     "ends the session" when asked)
// Open http://localhost:8377/tools/sim.html (python tools/serve.py) and click the page.

(async () => {
  const sim = document.getElementById('sim');
  const lines = [];
  const t0 = performance.now();
  const say = (text) => {
    lines.push(((performance.now() - t0) / 1000).toFixed(1).padStart(5) + 's  ' + text);
    sim.textContent = lines.join('\n');
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const SILENCE_SEC = 3;

  // ---- fake extension APIs ----
  const sent = [];
  const receivers = [];
  const deliver = (msg) => { say('background -> listener  ' + msg.type + (msg.reason ? ' (' + msg.reason + ')' : '')); receivers.forEach((f) => f(msg)); };
  const stored = { silenceTimeoutSec: SILENCE_SEC, wakeWord: 'skippy' }; // the recordings say "skippy"
  const fakeChrome = {
    runtime: {
      id: 'simulation',
      onMessage: { addListener: (f) => receivers.push(f) },
      sendMessage: async (msg) => {
        sent.push({ ...msg, at: performance.now() });
        say('listener -> background  ' + JSON.stringify(msg));
        if (msg.type === 'vl-wake') {
          setTimeout(() => deliver({ type: 'vl-started', report: { clickedName: 'Voice mode', micPermission: 'granted', buttonsAdded: ['End voice mode'], buttonsRemoved: [] } }), 1000);
          return { ok: true, action: msg.action };
        }
        if (msg.type === 'vl-end') {
          setTimeout(() => deliver({ type: 'vl-ended', reason: msg.reason }), 200);
          return { ended: true };
        }
        if (msg.type === 'vl-status') return { active: false };
      },
    },
    storage: {
      local: { get: async () => ({ ...stored }), set: async (o) => { Object.assign(stored, o); } },
      onChanged: { addListener: () => {} },
    },
  };
  Object.defineProperty(window, 'chrome', { value: fakeChrome, configurable: true, writable: true });

  // ---- fake microphone ----
  const mic = new AudioContext();
  const micOut = mic.createMediaStreamDestination();
  navigator.mediaDevices.getUserMedia = async () => micOut.stream;
  async function play(file) {
    const data = await (await fetch(`/tools/wav/${file}.wav`)).arrayBuffer();
    const buffer = await mic.decodeAudioData(data);
    const source = mic.createBufferSource();
    source.buffer = buffer;
    source.connect(micOut);
    source.start();
    say(`mic: "${file}"`);
    await sleep(buffer.duration * 1000);
  }

  // ---- load the real listener page into this document ----
  const html = await (await fetch('/extension/listener.html')).text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  document.getElementById('mount').append(...Array.from(doc.body.children).filter((el) => el.tagName !== 'SCRIPT'));
  document.getElementById('details').hidden = false;
  const scripts = Array.from(doc.querySelectorAll('script[src]'), (s) => s.getAttribute('src'));
  for (const src of scripts) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.body.appendChild(s);
    });
  }

  await new Promise((r) => document.addEventListener('click', r, { once: true }));
  await mic.resume();

  const status = () => document.getElementById('status').textContent;
  async function until(test, ms, what) {
    const end = performance.now() + ms;
    while (performance.now() < end) {
      if (test()) return true;
      await sleep(100);
    }
    say('TIMEOUT waiting for ' + what);
    return false;
  }
  const results = [];
  const check = (name, ok) => { results.push(ok); say((ok ? 'PASS  ' : 'FAIL  ') + name); };
  const wakes = () => sent.filter((m) => m.type === 'vl-wake');
  const ends = () => sent.filter((m) => m.type === 'vl-end');

  await until(() => status().startsWith('Listening'), 20000, 'listening');
  await sleep(1000);

  // 1. "Skippy" launches a new chat; silence ends it; listening resumes.
  await play('skippy.microsoftziradesktop');
  await until(() => wakes().length === 1, 5000, 'wake');
  check('"skippy" asks the background for a new chat', wakes().length === 1 && wakes()[0].action === 'new');
  await until(() => status().startsWith('In conversation'), 4000, 'conversation');
  check('listener enters conversation state', status().startsWith('In conversation'));
  const convStart = performance.now();
  await until(() => ends().length === 1, (SILENCE_SEC + 4) * 1000, 'silence end');
  const quietFor = (performance.now() - convStart) / 1000;
  check(`silence ends the conversation after about ${SILENCE_SEC} s (took ${quietFor.toFixed(1)} s)`,
    ends().length === 1 && ends()[0].reason === 'silence' && quietFor > SILENCE_SEC - 0.5);
  await until(() => status().startsWith('Listening'), 5000, 'resume');
  check('listening resumes afterwards', status().startsWith('Listening'));

  // 2. "Continue Skippy" asks for the last chat. Talk during the conversation keeps it open,
  //    and the wake word spoken mid-conversation does not start a second one.
  await sleep(500);
  await play('continue_skippy.microsoftdaviddesktop');
  await until(() => wakes().length === 2, 5000, 'second wake');
  check('"continue skippy" asks the background to continue', wakes().length === 2 && wakes()[1].action === 'continue');
  await until(() => status().startsWith('In conversation'), 4000, 'conversation');
  const talkStart = performance.now();
  await play('neg_weather.microsoftdaviddesktop');
  await sleep(1500);
  await play('skippy.microsoftdaviddesktop');
  await sleep(1500);
  await play('neg_trippy_sentence.microsoftziradesktop');
  const talkedFor = (performance.now() - talkStart) / 1000;
  check(`talking for ${talkedFor.toFixed(1)} s (longer than the timeout) did not end the conversation`,
    ends().length === 1 && talkedFor > SILENCE_SEC);
  check('wake word during a conversation is ignored', wakes().length === 2);
  await until(() => ends().length === 2, (SILENCE_SEC + 4) * 1000, 'second silence end');
  check('conversation ends once the room goes quiet', ends().length === 2);
  await until(() => status().startsWith('Listening'), 5000, 'resume');

  // 3. The engine still works after two pause/resume cycles.
  await sleep(500);
  await play('skippy.microsoftdaviddesktop');
  await until(() => wakes().length === 3, 5000, 'third wake');
  check('wake word works again after resuming', wakes().length === 3 && wakes()[2].action === 'new');

  // 4. Out of step: the background has no record of the conversation. The listener must not
  //    stay stuck; the End conversation button (or the silence timer) brings it back.
  await until(() => status().startsWith('In conversation'), 4000, 'conversation');
  fakeChrome.runtime.sendMessage = async (msg) => {
    say('listener -> background  ' + JSON.stringify(msg) + '  [background has no session]');
    return msg.type === 'vl-end' ? { ended: false } : { ok: true, action: msg.action };
  };
  document.getElementById('toggle').click();
  await until(() => status().startsWith('Listening'), 5000, 'recover');
  check('listener recovers when the background has lost the session', status().startsWith('Listening'));
  check('button reads Pause again', document.getElementById('toggle').textContent === 'Pause');

  // 5. One session at a time: the background says a conversation is already open. The listener
  //    must join it (not listen), ignore further wake words, and resume once it ends.
  let asked = 0;
  fakeChrome.runtime.sendMessage = async (msg) => {
    say('listener -> background  ' + JSON.stringify(msg) + '  [a session is already open]');
    if (msg.type === 'vl-wake') { asked++; return { ok: false, active: true, reason: 'a conversation is already open' }; }
    if (msg.type === 'vl-end') { setTimeout(() => deliver({ type: 'vl-ended', reason: msg.reason }), 200); return { ended: true }; }
  };
  await sleep(500);
  await play('skippy.microsoftziradesktop');
  await until(() => status().startsWith('In conversation'), 5000, 'join');
  check('refused wake word makes the listener join the open conversation', asked === 1 && status().startsWith('In conversation'));
  await play('skippy.microsoftdaviddesktop');
  await sleep(1500);
  await play('continue_skippy.microsoftziradesktop');
  await sleep(1500);
  check('wake words during that conversation are not even sent', asked === 1);
  await until(() => status().startsWith('Listening'), (SILENCE_SEC + 6) * 1000, 'resume after joined conversation');
  check('listening resumes when that conversation ends', status().startsWith('Listening'));

  // 6. Home screen: clock is showing, the pill mirrors the state, the wake cue appeared.
  check('clock shows the time', /\d{1,2}[:.]\d{2}/.test(document.getElementById('time').textContent));
  check('home-screen pill says what to say', document.getElementById('pillText').textContent.includes('Skippy'));

  say(`DONE ${results.filter(Boolean).length}/${results.length}`);
})();
