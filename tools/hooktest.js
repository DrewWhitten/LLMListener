// Checks that mic-hook.js reports the microphone being opened, cloned and released.
(async () => {
  const out = document.getElementById('out');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const seen = [];
  window.addEventListener('message', (e) => {
    if (e.data && e.data.source === 'vl-mic-hook') seen.push(e.data.live);
  });
  const lines = [];
  let passed = 0;
  let total = 0;
  const check = (name, ok) => { total++; if (ok) passed++; lines.push((ok ? 'PASS  ' : 'FAIL  ') + name + '   [reports so far: ' + seen.join(',') + ']'); out.textContent = lines.join('\n'); };
  const last = () => seen[seen.length - 1];

  await sleep(700);
  check('reports 0 before anything opens the microphone', last() === 0);

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  await sleep(100);
  check('reports 1 when the microphone is opened', last() === 1);

  const copy = stream.getAudioTracks()[0].clone();
  stream.getAudioTracks()[0].stop();
  await sleep(700);
  check('still live while a cloned track is open', last() === 1);

  copy.stop();
  await sleep(700);
  check('reports 0 once every track is stopped', last() === 0);

  const again = await navigator.mediaDevices.getUserMedia({ audio: true });
  await sleep(100);
  check('reports 1 when opened a second time', last() === 1);
  again.getTracks().forEach((t) => t.stop());
  await sleep(700);
  check('and 0 again after release', last() === 0);

  lines.push(`DONE ${passed}/${total}`);
  out.textContent = lines.join('\n');
})();
