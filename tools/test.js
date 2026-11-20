// Feeds the synthesized WAVs in tools/wav through the wake engine and prints what it heard.
// Open http://localhost:8377/tools/test.html (python tools/serve.py).
// Query options: ?threshold=0.5&boost=3&decoys=skip,kitty   (decoys=none for no decoys)

(async () => {
  const out = document.getElementById('out');
  const params = new URLSearchParams(location.search);
  // These recordings test the tuned "skippy" profile. Anything not given uses the engine's defaults.
  const options = { logLevel: Number(params.get('log') || -1), wakeWord: 'skippy' };
  if (params.has('threshold')) options.threshold = Number(params.get('threshold'));
  if (params.has('boost')) options.boost = Number(params.get('boost'));
  if (params.has('decoys')) {
    options.decoys = params.get('decoys') === 'none' ? [] : params.get('decoys').split(',');
  }
  const voices = ['microsoftdaviddesktop', 'microsoftziradesktop'];
  const cases = [
    ['skippy', 'new'],
    ['continue_skippy', 'continue'],
    ['hey_skippy_sentence', 'new'],
    ['neg_weather', null],
    ['neg_similar', null],
    ['neg_continue', null],
    ['neg_trippy', null],
    ['neg_trippy_sentence', null],
    ['neg_rhymes', null],
  ];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const lines = [JSON.stringify(options)];
  const render = () => { out.textContent = lines.join('\n'); };
  window.addEventListener('error', (e) => { lines.push('ERROR ' + e.message); render(); });
  window.addEventListener('unhandledrejection', (e) => { lines.push('ERROR ' + e.reason); render(); });

  const t0 = performance.now();
  const engine = await VLWake.create(options);
  lines.push(`model ready in ${Math.round(performance.now() - t0)} ms`);
  render();

  let events = [];
  for (const type of ['wake', 'rejected', 'final']) {
    engine.addEventListener(type, (e) => events.push({ type, ...e.detail }));
  }

  const ctx = new OfflineAudioContext(1, 16000, 16000);
  const silence = new Float32Array(16000 * 1.5);
  let passed = 0;

  for (const voice of voices) {
    for (const [name, expected] of cases) {
      const buf = await (await fetch(`/tools/wav/${name}.${voice}.wav`)).arrayBuffer();
      const samples = (await ctx.decodeAudioData(buf)).getChannelData(0);
      events = [];
      for (let i = 0; i < samples.length; i += 4000) engine.feed(samples.slice(i, i + 4000));
      engine.feed(silence.slice());
      await sleep(2500);
      engine.flush();
      await sleep(500);
      const wakes = events.filter((e) => e.type === 'wake');
      const got = wakes.length ? wakes[0].action : null;
      const pass = got === expected && wakes.length <= 1;
      if (pass) passed++;
      const heard = events.filter((e) => e.type === 'final').map((e) => e.text).join(' / ');
      const confs = events.filter((e) => e.type !== 'final').map((e) => `${e.type}:${e.action}@${e.confidence.toFixed(2)}`).join(' ');
      lines.push(`${pass ? 'PASS' : 'FAIL'}  ${name}.${voice.replace('microsoft', '').replace('desktop', '')}  expected=${expected} got=${got}  heard="${heard}"  ${confs}`);
      render();
    }
  }
  lines.push(`DONE ${passed}/${voices.length * cases.length}`);
  render();
})();
