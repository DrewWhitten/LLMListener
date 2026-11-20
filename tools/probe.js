// Shows exactly what the engine hears for a set of recordings in tools/wav:
// the sequence of partial results, the final text with word confidences, and any wake event.
//   http://localhost:8377/tools/probe.html?prefix=var_            every WAV starting with var_
//   http://localhost:8377/tools/probe.html?files=skippy.david,... named files
// Engine options can be given as ?threshold=&boost=&decoys=a,b (decoys=none for none).

(async () => {
  const out = document.getElementById('out');
  const params = new URLSearchParams(location.search);
  // The recordings in tools/wav were made for the wake word "skippy"; ?wake= probes another.
  const options = { logLevel: -1, wakeWord: params.get('wake') || 'skippy' };
  if (params.has('threshold')) options.threshold = Number(params.get('threshold'));
  if (params.has('boost')) options.boost = Number(params.get('boost'));
  if (params.has('decoys')) options.decoys = params.get('decoys') === 'none' ? [] : params.get('decoys').split(',');

  let files;
  if (params.has('files')) {
    files = params.get('files').split(',');
  } else {
    const prefix = params.get('prefix') || 'var_';
    const listing = await (await fetch('/tools/wav/')).text();
    files = Array.from(listing.matchAll(/href="([^"]+)\.wav"/g), (m) => decodeURIComponent(m[1])).filter((f) => f.startsWith(prefix));
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const lines = [JSON.stringify(options)];
  const render = () => { out.textContent = lines.join('\n'); };

  const engine = await VLWake.create(options);
  let partials = [];
  let events = [];
  engine.addEventListener('partial', (e) => {
    if (e.detail.text && partials[partials.length - 1] !== e.detail.text) partials.push(e.detail.text);
  });
  engine.addEventListener('final', (e) => events.push('final[' + e.detail.words.map((w) => `${w.word}@${w.conf.toFixed(2)}`).join(' ') + ']'));
  engine.addEventListener('wake', (e) => events.push(`WAKE:${e.detail.action}@${e.detail.confidence.toFixed(2)}`));
  engine.addEventListener('rejected', (e) => events.push(`rejected:${e.detail.action}@${e.detail.confidence.toFixed(2)}`));

  const ctx = new OfflineAudioContext(1, 16000, 16000);
  const silence = new Float32Array(16000 * 1.5);
  const tally = {};

  for (const file of files) {
    const buf = await (await fetch(`/tools/wav/${file}.wav`)).arrayBuffer();
    const samples = (await ctx.decodeAudioData(buf)).getChannelData(0);
    partials = [];
    events = [];
    for (let i = 0; i < samples.length; i += 1600) engine.feed(samples.slice(i, i + 1600));
    engine.feed(silence.slice());
    await sleep(2000);
    engine.flush();
    await sleep(400);
    const wake = events.find((e) => e.startsWith('WAKE')) || 'none';
    const key = wake.split('@')[0];
    tally[key] = (tally[key] || 0) + 1;
    lines.push(`${file}\n    partials: ${partials.join(' | ')}\n    ${events.join('  ')}`);
    render();
  }
  lines.push('DONE ' + JSON.stringify(tally));
  render();
})();
