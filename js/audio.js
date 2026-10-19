// Sounds and music, all synthesized at load (no audio files), like the game's CombatSounds / MoveSounds / ScoreLibrary.
// One-shots play through HRTF panners so fire sounds sit where the fire is.

const RATE = 24000;

class Lp { constructor() { this.y = 0; } do(x, k) { this.y += (x - this.y) * k; return this.y; } }

class Band {
  constructor() { this.low = 0; this.band = 0; }
  do(x, hz, q) {
    const f = 2 * Math.sin(Math.PI * Math.min(hz, RATE * 0.2) / RATE);
    this.low += f * this.band;
    const high = x - this.low - q * this.band;
    this.band += f * high;
    return this.band;
  }
}

class Osc {
  constructor() { this.phase = 0; }
  sine(hz) { this.phase += hz / RATE; return Math.sin(2 * Math.PI * (this.phase - Math.floor(this.phase))); }
  saw(hz) { this.phase += hz / RATE; return 2 * (this.phase - Math.floor(this.phase)) - 1; }
}

class Crackle {
  constructor() { this.env = 0; this.hz = 2000; this.band = new Band(); }
  do(rate, lowHz, highHz, decay = 0.993) {
    if (Math.random() < rate / RATE) {
      this.env = 0.4 + 0.6 * Math.random();
      this.hz = lowHz + (highHz - lowHz) * Math.random();
    }
    this.env *= decay;
    return this.band.do(noise(), this.hz, 0.5) * this.env;
  }
}

const noise = () => Math.random() * 2 - 1;
const decay = (u, rate, attack = 0.004) => (u < 0 ? 0 : Math.min(1, u / attack) * Math.exp(-u * rate));
const glide = (t, from, to, tau) => to + (from - to) * Math.exp(-t / tau);
const lerp = (a, b, t) => a + (b - a) * t;

function render(seconds, voice) {
  const n = Math.ceil(seconds * RATE);
  const data = new Float32Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const v = voice(i / RATE);
    data[i] = Number.isFinite(v) ? v : 0;
    peak = Math.max(peak, Math.abs(data[i]));
  }
  const scale = peak > 1e-5 ? 0.8 / peak : 0;
  const fadeIn = RATE * 0.003, fadeOut = RATE * 0.015;
  for (let i = 0; i < n; i++) data[i] *= scale * Math.min(1, i / fadeIn) * Math.min(1, (n - 1 - i) / fadeOut);
  return data;
}

// The game's ShootFireball: a deep roaring whoomp.
function shootFireball() {
  const roar = new Lp(), body = new Lp(), thump = new Osc(), air = new Band();
  return render(0.88, t => {
    const env = Math.min(1, t / 0.03) * (t < 0.32 ? 1 : Math.exp(-(t - 0.32) * 7));
    const n = noise();
    const low = body.do(roar.do(n, lerp(0.05, 0.02, t)), 0.08) * 9;
    const whoosh = air.do(n, glide(t, 700, 200, 0.12), 0.6) * 0.15;
    return (low + whoosh) * env + thump.sine(glide(t, 110, 48, 0.08)) * 0.7 * decay(t, 6, 0.006);
  });
}

// The game's ExplosionFire / ExplosionFire2: a bang, a roaring body, a low boom and crackling fire.
function explosionFire(second) {
  const length = second ? 0.77 : 1.03;
  const boom = new Osc(), roar = new Lp(), roar2 = new Lp(), crackle = new Crackle();
  return render(length, t => {
    const n = noise();
    const bang = n * decay(t, 40, 0.0005) * 0.6;
    const body = roar2.do(roar.do(n, second ? 0.12 : 0.07), second ? 0.2 : 0.12) * (second ? 4 : 5.5) * decay(t, second ? 5.5 : 4, 0.004);
    const low = boom.sine(glide(t, second ? 95 : 80, 36, 0.12)) * 0.9 * decay(t, second ? 6 : 4.5, 0.004);
    const fire = crackle.do(t < 0.05 ? 0 : lerp(70, 15, t / length), 700, 3500) * 0.7 * Math.exp(-t * 2);
    return bang + body + low + fire;
  });
}

// New: a target struck. A bright bell (inharmonic partials) over a wooden knock; `pitch` rises with the ring and the streak.
function targetHit(pitch) {
  const a = new Osc(), b = new Osc(), c = new Osc(), d = new Osc(), knock = new Band();
  const f = 880 * pitch;
  return render(0.9, t => {
    const bell = a.sine(f) * decay(t, 4.5, 0.002) + b.sine(f * 2.76) * 0.45 * decay(t, 9, 0.002)
      + c.sine(f * 5.4) * 0.22 * decay(t, 16, 0.001) + d.sine(f * 1.5) * 0.35 * decay(t - 0.06, 6, 0.002);
    return bell * 0.7 + knock.do(noise(), 1100, 0.3) * 0.8 * decay(t, 45, 0.0005);
  });
}

// New: the bullseye's extra sparkle, a quick rising run of three bell notes.
function bullseye() {
  const notes = [1318.5, 1661.2, 1975.5];
  const oscs = notes.map(() => new Osc()), over = notes.map(() => new Osc());
  return render(0.85, t => {
    let s = 0;
    notes.forEach((hz, i) => {
      const u = t - i * 0.07;
      s += (oscs[i].sine(hz) + over[i].sine(hz * 2.01) * 0.3) * decay(u, 6, 0.002);
    });
    return s;
  });
}

// New menu sounds: a soft tick when the gaze lands on a button, a rising two-note pluck when the dwell selects it.
function gazeTick() {
  const o = new Osc();
  return render(0.08, t => o.sine(glide(t, 2400, 1800, 0.02)) * decay(t, 60, 0.001));
}

function menuSelect() {
  const a = new Osc(), b = new Osc(), a2 = new Osc(), b2 = new Osc();
  return render(0.5, t => {
    const one = (a.sine(659.3) + a2.sine(1318.5) * 0.3) * decay(t, 12, 0.002);
    const two = (b.sine(987.8) + b2.sine(1975.5) * 0.3) * decay(t - 0.08, 7, 0.002);
    return one + two;
  });
}

function countBeep(go) {
  const o = new Osc(), o2 = new Osc();
  const hz = go ? 1046.5 : 523.25;
  return render(go ? 0.6 : 0.25, t => (o.sine(hz) + o2.saw(hz) * 0.15) * decay(t, go ? 5 : 14, 0.003));
}

// New: the round's end, a brass-like arpeggio up a major chord.
function fanfare() {
  const notes = [523.25, 659.3, 784, 1046.5];
  const oscs = notes.map(() => new Osc()), lps = notes.map(() => new Lp());
  return render(1.8, t => {
    let s = 0;
    notes.forEach((hz, i) => {
      const u = t - i * 0.12;
      const len = i === 3 ? 2.2 : 6;
      s += lps[i].do(oscs[i].saw(hz), 0.18) * decay(u, len, 0.02);
    });
    return s;
  });
}

export class Sound {
  constructor(context, listener) {
    this.ctx = context;
    this.sfx = context.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(listener ?? context.destination);
    this.buffers = {};
    const make = (name, data) => {
      const buffer = context.createBuffer(1, data.length, RATE);
      buffer.copyToChannel(data, 0);
      this.buffers[name] = buffer;
    };
    make('shoot', shootFireball());
    make('boom', explosionFire(false));
    make('boom2', explosionFire(true));
    for (let i = 0; i < 6; i++) make('hit' + i, targetHit(Math.pow(2, i / 12 * 2)));
    make('bull', bullseye());
    make('tick', gazeTick());
    make('select', menuSelect());
    make('count', countBeep(false));
    make('go', countBeep(true));
    make('fanfare', fanfare());
    this.voices = 0;
  }

  /** Plays a one-shot; with a position it is spatialized, otherwise it plays flat (UI). */
  play(name, { position = null, volume = 1, pitch = 1 } = {}) {
    if (this.voices > 14) return;
    const ctx = this.ctx;
    const source = ctx.createBufferSource();
    source.buffer = this.buffers[name];
    source.playbackRate.value = pitch;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain);
    if (position) {
      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 2;
      panner.rolloffFactor = 0.6;
      panner.positionX.value = position.x;
      panner.positionY.value = position.y;
      panner.positionZ.value = position.z;
      gain.connect(panner);
      panner.connect(this.sfx);
    } else {
      gain.connect(this.sfx);
    }
    this.voices++;
    source.onended = () => this.voices--;
    source.start();
  }
}

// ------------------------------------------------------------------ music

const midi = n => 440 * Math.pow(2, (n - 69) / 12);

// A Challenge-theme piece (120 BPM, so a 60 s round is 30 bars): i - VI - III - VII in A minor, segment A (arpeggio lead)
// and segment B (melody), 8 bars each. Like the game's ScoreConductor, the bed (pad, bass, comping) always plays; the melody
// and drums play only in the beats a Reach unlocks (the next two beats from the punch).
const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
const LEAD_B = [76, 74, 72, 74, 76, 79, 76, 74, 72, 72, 74, 76, 74, 72, 71, 72];
const ARP = [0, 1, 2, 1, 0, 2, 1, 2];
export const BPM = 120;
export const FAST_BPM = 132;

export class Music {
  constructor(context, destination) {
    this.ctx = context;
    this.out = context.createGain();
    this.out.gain.value = 0;
    this.out.connect(destination ?? context.destination);
    const comp = context.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.connect(this.out);
    this.bus = comp;
    this.noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.inRound = false;
    this.bpm = BPM;
    this.step = 0;
    this.unlockedUntil = 0;
    this.locked = [];   // melody and drum events already past the scheduler, waiting for a Reach
    this.timer = setInterval(() => this.schedule(), 25);
    this.next = context.currentTime + 0.1;
  }

  /** Fades the music in (call after the audio context resumes). */
  start() { this.fade(0.34, 1.5); }

  /** A round starts on a bar line now: the piece restarts from its first bar. */
  beginRound() {
    this.inRound = true;
    this.bpm = BPM;
    this.step = 0;
    this.next = this.ctx.currentTime + 0.05;
    this.locked.length = 0;
  }

  endRound() { this.inRound = false; this.bpm = BPM; }

  /** The last 10 s: a little faster. */
  hurry(on) { this.bpm = on ? FAST_BPM : BPM; }

  /** A Reach: unlocks the melody and drums for the next two beats, and plays the ones the scheduler already passed. */
  reach() {
    if (!this.inRound) return;
    const now = this.ctx.currentTime;
    this.unlockedUntil = Math.max(this.unlockedUntil, now + 2 * 60 / this.bpm);
    for (const e of this.locked) if (e.t >= now - 0.01 && e.t <= this.unlockedUntil) e.play(Math.max(e.t, now));
    this.locked = this.locked.filter(e => e.t > this.unlockedUntil);
  }

  fade(to, seconds) {
    const g = this.out.gain, now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(to, now + seconds);
  }

  schedule() {
    const now = this.ctx.currentTime;
    if (this.next < now - 0.2) this.next = now + 0.05;   // a hitch or a suspended context: drop what's late
    this.locked = this.locked.filter(e => e.t > now);
    while (this.next < now + 0.12) {
      this.play16(this.step, this.next);
      this.next += 15 / this.bpm;
      this.step++;
    }
  }

  /** A melody or drum event: plays now when unlocked, otherwise waits in case a Reach comes before its time. */
  gated(t, play) {
    if (t <= this.unlockedUntil) play(t);
    else this.locked.push({ t, play });
  }

  play16(step, t) {
    const s = step % 16, bar = Math.floor(step / 16);
    const chord = CHORDS[bar % 4];
    const beat = 60 / this.bpm;
    if (!this.inRound) {
      // Menus: the pad alone with a soft pulse.
      if (s === 0) this.pad(chord, t, beat * 4, 0.04);
      if (s % 8 === 0) this.pluck(midi(chord[0] + 12), t, 0.04, 0.6);
      return;
    }
    // The bed: pad, driving eighth bass, offbeat chord comping.
    if (s === 0) this.pad(chord, t, beat * 4, 0.05);
    if (s % 2 === 0) this.bass(midi(chord[0] - 24 + (s === 14 ? 12 : 0)), t);
    if (s % 4 === 2) for (const n of chord) this.pluck(midi(n), t, 0.025, 0.12);
    // Unlocked by a Reach: drums (four on the floor, backbeat, hats) and the lead.
    if (s % 4 === 0) this.gated(t, u => this.kick(u));
    if (s === 4 || s === 12) this.gated(t, u => this.snare(u));
    this.gated(t, u => this.hat(u, s % 4 === 2 ? 0.12 : 0.04, s % 4 === 2 ? 0.09 : 0.03));
    if (Math.floor(bar / 8) % 2 === 1) {
      if (s % 2 === 0) {
        const n = LEAD_B[(bar % 2) * 8 + s / 2];
        this.gated(t, u => this.lead(midi(n), u, beat * 0.45));
      }
    } else {
      const note = chord[ARP[s % 8]] + 12 + (s >= 8 ? 12 : 0);
      this.gated(t, u => this.pluck(midi(note), u, 0.07, 0.25));
    }
  }

  env(t, attack, hold, release, peak) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    g.connect(this.bus);
    return g;
  }

  osc(type, hz, t, length, into) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = hz;
    o.connect(into);
    o.start(t);
    o.stop(t + length + 0.05);
    return o;
  }

  filter(type, hz, into) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = hz;
    f.connect(into);
    return f;
  }

  pad(chord, t, length, peak) {
    const lp = this.filter('lowpass', 1400, this.env(t, 0.4, Math.max(0, length - 0.8), 0.8, peak));
    for (const n of chord) {
      this.osc('triangle', midi(n), t, length, lp);
      this.osc('sawtooth', midi(n), t, length, lp).detune.value = 7;
    }
  }

  pluck(hz, t, peak, length) {
    const lp = this.filter('lowpass', 4000, this.env(t, 0.004, 0, length, peak));
    lp.frequency.setValueAtTime(4000, t);
    lp.frequency.exponentialRampToValueAtTime(600, t + length);
    this.osc('square', hz, t, length, lp);
  }

  lead(hz, t, length) {
    const lp = this.filter('lowpass', 2600, this.env(t, 0.01, length * 0.6, length * 0.6, 0.07));
    this.osc('sawtooth', hz, t, length * 1.3, lp);
    this.osc('square', hz * 0.5, t, length * 1.3, lp);
  }

  bass(hz, t) {
    const lp = this.filter('lowpass', 900, this.env(t, 0.005, 0.08, 0.12, 0.2));
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(200, t + 0.2);
    this.osc('sawtooth', hz, t, 0.25, lp);
  }

  kick(t) {
    const o = this.osc('sine', 150, t, 0.3, this.env(t, 0.002, 0.02, 0.25, 0.7));
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  }

  noiseHit(t, type, hz, peak, length) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.connect(this.filter(type, hz, this.env(t, 0.001, 0, length, peak)));
    src.start(t, Math.random() * 0.5);
    src.stop(t + length + 0.05);
  }

  snare(t) {
    this.noiseHit(t, 'bandpass', 1800, 0.35, 0.16);
    this.osc('triangle', 190, t, 0.12, this.env(t, 0.002, 0, 0.1, 0.25));
  }

  hat(t, peak, length) { this.noiseHit(t, 'highpass', 7500, peak, length); }
}
