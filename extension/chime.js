// The "I heard you" chime, synthesized so no sound file is needed.
// Two rising notes for a new chat, three for "continue".

(() => {
  function play(ctx, action, volume) {
    const notes = action === 'continue' ? [660, 880, 1320] : [880, 1320];
    const step = 0.11;
    const start = ctx.currentTime + 0.01;
    const master = ctx.createGain();
    master.gain.value = Math.max(0, Math.min(1, volume)) * 0.5;
    master.connect(ctx.destination);

    notes.forEach((freq, i) => {
      const t = start + i * step;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(1, t + 0.012);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      osc.connect(env).connect(master);
      osc.start(t);
      osc.stop(t + 0.3);
    });
    return notes.length * step + 0.3; // seconds until it has finished
  }

  window.VLChime = { play };
})();
