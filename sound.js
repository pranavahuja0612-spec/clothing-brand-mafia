// Sound effects (Week 5), made in the browser with the Web Audio API: short
// notes and noise bursts, so there are no sound files to load or license.
// The on/off choice is kept with the other settings (not in the game save).
// Browsers only allow sound after the player has touched the page, so the
// audio starts on the first tap or key press.

const Sound = (() => {
  const SETTINGS_KEY = CONFIG.view3d.settingsKey;
  let ctx = null;
  let master = null;
  let lastPlayed = {};   // name -> time, so a burst of events is not a wall of noise

  function readSettings() {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function isOn() {
    return readSettings().sound !== false;
  }

  function setOn(on) {
    try {
      const settings = readSettings();
      settings.sound = on;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      // Private mode: the choice is not remembered.
    }
    if (on) unlock();
  }

  function unlock() {
    if (!isOn()) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    try {
      if (!ctx) {
        ctx = new AudioCtx();
        master = ctx.createGain();
        master.gain.value = CONFIG.sound.volume;
        master.connect(ctx.destination);
      }
      if (ctx.state === "suspended") ctx.resume();
    } catch (e) {
      ctx = null;
    }
  }

  // One note: frequency slides from `from` to `to` over `dur` seconds.
  function tone(from, to, dur, type = "sine", gain = 0.5, delay = 0) {
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(amp);
    amp.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // A short burst of filtered noise (whoosh, thud).
  function noise(dur, freq, gain = 0.3, delay = 0) {
    const t = ctx.currentTime + delay;
    const length = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = freq;
    const amp = ctx.createGain();
    amp.gain.value = gain;
    src.connect(filter);
    filter.connect(amp);
    amp.connect(master);
    src.start(t);
  }

  // Each effect, by name. `n` is an optional number, such as the stack height.
  const EFFECTS = {
    click: () => tone(900, 600, 0.05, "square", 0.12),
    pickup: (n = 0) => {
      const f = 420 * Math.pow(1.06, Math.min(n, 24));   // climbs as the stack grows
      tone(f, f * 1.5, 0.08, "triangle", 0.35);
    },
    drop: (n = 0) => {
      const f = 520 * Math.pow(1.04, Math.min(n, 24));
      tone(f, f * 0.6, 0.07, "triangle", 0.3);
    },
    pay: () => tone(700, 500, 0.08, "square", 0.12),
    drain: (n = 0) => tone(500 + n * 400, 520 + n * 420, 0.04, "square", 0.08),
    done: () => {
      tone(660, 990, 0.09, "triangle", 0.3);
      tone(990, 1320, 0.1, "triangle", 0.25, 0.07);
    },
    sale: () => {
      noise(0.08, 3000, 0.25);
      tone(1320, 1320, 0.12, "square", 0.18, 0.02);
      tone(1760, 1760, 0.3, "square", 0.18, 0.11);
      [0, 0.06, 0.12, 0.18].forEach((d, i) => tone(2000 + i * 300, 2600 + i * 300, 0.06, "sine", 0.15, 0.2 + d));
    },
    unlock: () => {
      noise(0.35, 900, 0.25);
      [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.18, "triangle", 0.3, i * 0.08));
    },
    level: () => [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, f * 1.01, 0.16, "square", 0.14, i * 0.07)),
    deny: () => tone(180, 140, 0.15, "sawtooth", 0.15),
    fail: () => {
      tone(330, 220, 0.25, "sawtooth", 0.15);
      tone(220, 150, 0.35, "sawtooth", 0.15, 0.2);
    },
  };

  const MIN_GAP = { click: 0.03, pickup: 0.04, drop: 0.04, drain: 0.05, pay: 0.1, deny: 0.4 };

  function play(name, n) {
    if (!ctx || !isOn() || !EFFECTS[name]) return;
    if (ctx.state !== "running") return;
    const now = ctx.currentTime;
    if (now - (lastPlayed[name] || -1) < (MIN_GAP[name] || 0.08)) return;
    lastPlayed[name] = now;
    try {
      EFFECTS[name](n);
    } catch (e) {
      // A sound must never break the game.
    }
  }

  ["pointerdown", "keydown", "touchend"].forEach((type) => {
    window.addEventListener(type, unlock, { passive: true });
  });

  return { play, isOn, setOn };
})();
