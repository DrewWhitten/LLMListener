// Runs inside claude.ai's own page context (not the isolated content-script world).
// Tells the extension's content script how many microphone tracks the page currently holds, so
// "voice mode ended" can be detected from the microphone being released rather than from
// how Claude's buttons happen to be named. It never touches the audio itself.

(() => {
  const devices = navigator.mediaDevices;
  if (!devices || !devices.getUserMedia) return;

  const tracks = new Set();
  let lastReported = -1;

  function report() {
    for (const t of tracks) if (t.readyState === 'ended') tracks.delete(t);
    if (tracks.size !== lastReported) {
      lastReported = tracks.size;
      window.postMessage({ source: 'vl-mic-hook', live: tracks.size }, location.origin);
    }
  }

  const getUserMedia = devices.getUserMedia.bind(devices);
  devices.getUserMedia = async function (constraints) {
    const stream = await getUserMedia(constraints);
    try {
      stream.getAudioTracks().forEach((t) => tracks.add(t));
      report();
    } catch (e) {
      // never let the hook break the page's own call
    }
    return stream;
  };

  const clone = MediaStreamTrack.prototype.clone;
  MediaStreamTrack.prototype.clone = function () {
    const copy = clone.call(this);
    if (copy.kind === 'audio' && tracks.has(this)) tracks.add(copy);
    return copy;
  };

  // track.stop() fires no event, so poll.
  setInterval(report, 500);
})();
