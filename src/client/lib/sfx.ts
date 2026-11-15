// Small synthesized sounds (WebAudio, no files). Every sound follows a tap, so browsers allow it. The mute choice is
// remembered per viewer in localStorage, which may be unavailable; then sound simply stays on for the session.

const KEY = 'foefall:muted';
let ctx: AudioContext | null = null;
let muted = (() => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
})();

function audio(): AudioContext | null {
  if (muted) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

type Tone = { freq: number; to?: number; type?: OscillatorType; dur: number; gain: number; delay?: number };

function tone(t: Tone) {
  const a = audio();
  if (!a) return;
  const start = a.currentTime + (t.delay ?? 0);
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = t.type ?? 'sine';
  osc.frequency.setValueAtTime(t.freq, start);
  if (t.to) osc.frequency.exponentialRampToValueAtTime(t.to, start + t.dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(t.gain, start + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, start + t.dur);
  osc.connect(g).connect(a.destination);
  osc.start(start);
  osc.stop(start + t.dur + 0.02);
}

function noise(dur: number, gain: number, delay = 0, lowpass = 1200) {
  const a = audio();
  if (!a) return;
  const start = a.currentTime + delay;
  const buf = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * dur)), a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = lowpass;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start(start);
}

export const sfx = {
  isMuted: () => muted,
  setMuted(m: boolean) {
    muted = m;
    try {
      localStorage.setItem(KEY, m ? '1' : '0');
    } catch {
      /* not remembered, still applied */
    }
  },
  select: () => tone({ freq: 660, dur: 0.07, gain: 0.05, type: 'triangle' }),
  step: () => tone({ freq: 220, to: 180, dur: 0.09, gain: 0.07, type: 'triangle' }),
  ability: () => {
    noise(0.12, 0.12, 0, 700);
    tone({ freq: 140, to: 90, dur: 0.16, gain: 0.12 });
  },
  strike: () => {
    noise(0.35, 0.22, 0, 900);
    tone({ freq: 90, to: 45, dur: 0.45, gain: 0.2 });
  },
  fall: (i: number) => tone({ freq: 520 - i * 40, to: 160, dur: 0.38, gain: 0.07, type: 'sine', delay: i * 0.07 }),
  win: () => {
    [392, 494, 587, 784].forEach((f, i) => tone({ freq: f, dur: 0.9 - i * 0.1, gain: 0.07, type: 'triangle', delay: i * 0.09 }));
  },
  lose: () => {
    tone({ freq: 220, to: 165, dur: 0.6, gain: 0.08, type: 'triangle' });
    tone({ freq: 262, to: 196, dur: 0.6, gain: 0.05, type: 'triangle', delay: 0.05 });
  },
};
