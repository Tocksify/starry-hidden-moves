// Lightweight synthesized SFX — no asset downloads.
let ctx: AudioContext | null = null;
function ac() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

function blip(freq: number, dur = 0.08, type: OscillatorType = "sine", gain = 0.15) {
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export const sfx = {
  move: () => blip(520, 0.06, "triangle", 0.12),
  moveOpp: () => blip(380, 0.06, "triangle", 0.12),
  capture: () => { blip(220, 0.09, "square", 0.14); setTimeout(() => blip(140, 0.08, "square", 0.12), 30); },
  check: () => { blip(880, 0.09, "sawtooth", 0.14); setTimeout(() => blip(1100, 0.09, "sawtooth", 0.14), 90); },
  gameEnd: () => { blip(660, 0.12, "sine", 0.14); setTimeout(() => blip(440, 0.16, "sine", 0.14), 120); setTimeout(() => blip(330, 0.22, "sine", 0.14), 260); },
  ready: () => blip(720, 0.1, "triangle", 0.14),
  tick: () => blip(1200, 0.03, "square", 0.08),
};
