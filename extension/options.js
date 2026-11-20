// Settings page. Every control saves on change; the home screen picks changes up live.

(async () => {
  const $ = (id) => document.getElementById(id);
  const { DEFAULTS } = VLSettings;
  let settings = await VLSettings.load();
  let savedTimer = null;

  function flashSaved() {
    $('saved').textContent = 'Saved';
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => { $('saved').textContent = ''; }, 1500);
  }

  async function save(key, value) {
    settings[key] = value;
    await VLSettings.save({ [key]: value });
    render();
    flashSaved();
  }

  // One lowercase word; anything else falls back to the default.
  const cleanWord = (text, fallback) => {
    const word = String(text).toLowerCase().replace(/[^a-z']/g, ' ').trim().split(/\s+/)[0];
    return word || fallback;
  };

  function render() {
    $('wakeWord').value = settings.wakeWord;
    $('continueWord').value = settings.continueWord;
    $('threshold').value = settings.threshold;
    $('thresholdValue').textContent = Number(settings.threshold).toFixed(2);
    $('silenceTimeoutSec').value = String(settings.silenceTimeoutSec);
    $('voiceButtonLabel').value = settings.voiceButtonLabel;
    $('chimeEnabled').checked = !!settings.chimeEnabled;
    $('chimeVolume').value = settings.chimeVolume;
    $('chimeVolume').disabled = !settings.chimeEnabled;
    $('testChime').disabled = !settings.chimeEnabled;
    $('chimeVolumeValue').textContent = Math.round(settings.chimeVolume * 100) + '%';
    $('dimEnabled').checked = !!settings.dimEnabled;
    $('dimStart').value = settings.dimStart;
    $('dimEnd').value = settings.dimEnd;
    $('dimStart').disabled = $('dimEnd').disabled = !settings.dimEnabled;
    $('phrases').textContent = `Your phrases: “${settings.wakeWord}” and “${settings.continueWord} ${settings.wakeWord}”.`;
  }
  render();

  $('wakeWord').addEventListener('change', (e) => save('wakeWord', cleanWord(e.target.value, DEFAULTS.wakeWord)));
  $('continueWord').addEventListener('change', (e) => save('continueWord', cleanWord(e.target.value, DEFAULTS.continueWord)));
  $('threshold').addEventListener('input', (e) => { $('thresholdValue').textContent = Number(e.target.value).toFixed(2); });
  $('threshold').addEventListener('change', (e) => save('threshold', Number(e.target.value)));
  $('silenceTimeoutSec').addEventListener('change', (e) => save('silenceTimeoutSec', Number(e.target.value)));
  $('voiceButtonLabel').addEventListener('change', (e) => save('voiceButtonLabel', e.target.value.trim() || DEFAULTS.voiceButtonLabel));
  $('chimeEnabled').addEventListener('change', (e) => save('chimeEnabled', e.target.checked));
  $('chimeVolume').addEventListener('input', (e) => { $('chimeVolumeValue').textContent = Math.round(e.target.value * 100) + '%'; });
  $('chimeVolume').addEventListener('change', (e) => save('chimeVolume', Number(e.target.value)));
  $('dimEnabled').addEventListener('change', (e) => save('dimEnabled', e.target.checked));
  $('dimStart').addEventListener('change', (e) => save('dimStart', e.target.value || DEFAULTS.dimStart));
  $('dimEnd').addEventListener('change', (e) => save('dimEnd', e.target.value || DEFAULTS.dimEnd));

  let audio;
  $('testChime').addEventListener('click', () => {
    audio = audio || new AudioContext();
    audio.resume();
    VLChime.play(audio, 'new', Number($('chimeVolume').value));
  });

  $('reset').addEventListener('click', async () => {
    settings = { ...DEFAULTS };
    await VLSettings.save(settings);
    render();
    flashSaved();
  });

  // Keep in step if the threshold is changed from the home screen's details panel.
  VLSettings.onChange((changes) => { Object.assign(settings, changes); render(); });
})();
