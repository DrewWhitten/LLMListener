// Wake-word engine: Vosk (WebAssembly, fully offline) restricted to a tiny grammar.
// Load vendor/vosk.js first, then this file. Exposes window.VLWake.
//
//   const engine = await VLWake.create({ wakeWord: 'computer', continueWord: 'continue' });
//   engine.addEventListener('wake', (e) => e.detail.action);   // 'new' | 'continue'
//   engine.feed(float32Samples);                               // mono, at engine.sampleRate

(() => {
  const BASE = new URL('.', document.currentScript.src).href;
  const WORKER_URL = BASE + 'vendor/vosk-worker.js';
  const MODEL_URL = BASE + 'models/vosk-model-small-en-us-0.15.tar.gz';

  // vosk.js starts its worker from a blob: URL, which extension pages may not do.
  // Point that one request at the extracted copy (see tools/extract_worker.py).
  const NativeWorker = window.Worker;
  window.Worker = function (url, options) {
    return new NativeWorker(String(url).startsWith('blob:') ? WORKER_URL : url, options);
  };

  // Per-wake-word tuning. Any word the speech model knows can be a wake word; the ones listed
  // here have been tuned by ear. To tune another, add an entry.
  //
  //   decoys         Words that sound a bit like the wake word. With a restricted grammar the
  //                  recognizer must pick something from its list, so decoys give near-misses
  //                  somewhere to land other than the wake word. Do not add very close
  //                  neighbours: they capture the wake word itself.
  //   afterContinue  Words the wake word is misheard as when it directly follows the continue
  //                  word. In that position only, they count as the wake word.
  const PROFILES = {
    computer: {
      // Tuned with synthesized speech only: "commuter" and "compute" triggered without these.
      decoys: ['commuter', 'compute', 'commute', 'computing', 'compare', 'composer'],
      afterContinue: [],
    },
    skippy: {
      // "skipping" and "skipper" are left out on purpose: they captured a plain "skippy".
      // "trippy" is here because it caused real false triggers in room testing.
      decoys: [
        'skip', 'kitty', 'happy', 'hippie', 'zippy', 'sloppy', 'speedy', 'sticky', 'skinny',
        'copy', 'keep', 'key', 'ski',
        'trippy', 'tippy', 'drippy', 'chippy', 'snippy',
      ],
      // Said quickly, "continue skippy" loses its "s" and is heard as "continue zippy".
      afterContinue: ['zippy', 'hippie', 'kitty'],
    },
  };
  const UNTUNED = { decoys: [], afterContinue: [] };
  const DEFAULT_WAKE_WORD = 'computer';

  const MAX_GAP_SECONDS = 1.0; // "continue" must end at most this long before the wake word starts
  // If the speaker pauses long enough that "continue" and the wake word arrive as two separate
  // utterances, still treat it as "continue" when the wake word follows within this time.
  const CONTINUE_CARRY_MS = 3000;

  class WakeEngine extends EventTarget {
    constructor(options) {
      super();
      this.wakeWord = (options.wakeWord || DEFAULT_WAKE_WORD).toLowerCase().trim();
      this.continueWord = (options.continueWord || 'continue').toLowerCase().trim();
      const profile = PROFILES[this.wakeWord] || UNTUNED;
      this.tuned = this.wakeWord in PROFILES;
      this.decoys = (options.decoys || profile.decoys).filter(
        (w) => w !== this.wakeWord && w !== this.continueWord
      );
      this.afterContinue = options.afterContinue || profile.afterContinue;
      this._continueAt = -Infinity; // when an utterance last ended on the continue word
      this.threshold = options.threshold == null ? 0.5 : options.threshold;
      this.boost = Math.max(1, options.boost || 3);
      this.sampleRate = options.sampleRate || 16000;
      this.logLevel = options.logLevel == null ? -1 : options.logLevel;
      this.paused = false;
      this._forcing = false;
    }

    async _init() {
      this.model = await Vosk.createModel(MODEL_URL, this.logLevel);
      // Vosk builds a small language model from these phrases, so listing the wake phrases
      // more than once makes them more likely relative to the decoys.
      const wakePhrases = [this.wakeWord, `${this.continueWord} ${this.wakeWord}`];
      const grammar = [
        ...Array.from({ length: this.boost }, () => wakePhrases).flat(),
        this.continueWord,
        ...this.decoys,
        '[unk]',
      ];
      this.recognizer = new this.model.KaldiRecognizer(this.sampleRate, JSON.stringify(grammar));
      this.recognizer.setWords(true);
      this.recognizer.on('partialresult', (m) => this._onPartial(m.result.partial || ''));
      this.recognizer.on('result', (m) => this._onResult(m.result));
      return this;
    }

    /** Feed mono Float32 samples in [-1, 1] at this.sampleRate. Ignored while paused. */
    feed(samples) {
      if (this.paused || !this.recognizer) return;
      this.recognizer.acceptWaveformFloat(samples, this.sampleRate);
    }

    /** Stop reacting to audio (used while Claude's own voice mode has the microphone). */
    pause() {
      this.paused = true;
    }

    resume() {
      this._forcing = false;
      this.paused = false;
    }

    /** Ask the recognizer to finish the current utterance now. */
    flush() {
      if (this.recognizer) this.recognizer.retrieveFinalResult();
    }

    _emit(type, detail) {
      this.dispatchEvent(new CustomEvent(type, { detail }));
    }

    _onPartial(text) {
      if (this.paused) return;
      this._emit('partial', { text });
      // As soon as the wake word shows up, force a final result so we get word confidences
      // without waiting for the speaker to go quiet.
      if (!this._forcing && text.split(' ').includes(this.wakeWord)) {
        this._forcing = true;
        this.flush();
      }
    }

    _onResult(result) {
      this._forcing = false;
      if (this.paused) return;
      const words = result.result || [];
      const text = result.text || '';
      if (text) this._emit('final', { text, words });

      const carried = performance.now() - this._continueAt <= CONTINUE_CARRY_MS;
      const last = words[words.length - 1];
      this._continueAt = last && last.word === this.continueWord ? performance.now() : -Infinity;

      const followsContinue = (k) =>
        k > 0 &&
        words[k - 1].word === this.continueWord &&
        words[k].start - words[k - 1].end <= MAX_GAP_SECONDS;

      let i = -1;
      for (let k = words.length - 1; k >= 0; k--) {
        const w = words[k].word;
        if (w === this.wakeWord || (this.afterContinue.includes(w) && followsContinue(k))) { i = k; break; }
      }
      if (i < 0) return;

      const wake = words[i];
      const isContinue = followsContinue(i) || (i === 0 && carried);
      const detail = {
        action: isContinue ? 'continue' : 'new',
        confidence: wake.conf,
        threshold: this.threshold,
        text,
      };
      this._emit(wake.conf >= this.threshold ? 'wake' : 'rejected', detail);
    }

    terminate() {
      if (this.model) this.model.terminate();
    }
  }

  window.VLWake = {
    create: (options = {}) => new WakeEngine(options)._init(),
    PROFILES,
    DEFAULT_WAKE_WORD,
  };
})();
