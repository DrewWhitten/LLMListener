// Stand-in for the real microphone, installed before mic-hook.js wraps getUserMedia.
navigator.mediaDevices.getUserMedia = async () =>
  new AudioContext().createMediaStreamDestination().stream;
