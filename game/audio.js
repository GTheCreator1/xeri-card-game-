const effects = {
  play: [[180, 0, .07, .055, 'triangle'], [95, .022, .08, .03, 'triangle']],
  sweep: [[280, 0, .11, .055], [440, .055, .12, .05]],
  xeri: [[523.25, 0, .18, .06], [659.25, .08, .2, .055], [783.99, .16, .3, .055]],
  double: [[392, 0, .2, .065], [523.25, .07, .22, .055], [659.25, .14, .22, .055], [1046.5, .23, .45, .075]],
  win: [[392, 0, .23, .045], [493.88, .12, .23, .044], [587.33, .22, .25, .047], [783.99, .37, .42, .056]],
};

export class GameAudio {
  constructor() {
    this.enabled = true;
    try {
      this.enabled = localStorage.getItem('xeri-sound') !== 'off';
    } catch {
      // The sound switch still works for this page.
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    try {
      localStorage.setItem('xeri-sound', this.enabled ? 'on' : 'off');
    } catch {}
    if (this.enabled) this.unlock();
    if (this.output) this.output.gain.value = Number(this.enabled);
  }

  unlock() {
    if (!this.enabled) return;
    try {
      if (!this.context) {
        const Audio = globalThis.AudioContext ?? globalThis.webkitAudioContext;
        if (!Audio) return;
        this.context = new Audio();
        this.output = this.context.createGain();
        this.output.connect(this.context.destination);
      }
      if (this.context.state === 'suspended') this.context.resume().catch(() => {});
    } catch {}
  }

  play(effect) {
    if (!this.enabled || !this.context || this.context.state !== 'running') return;
    for (const [frequency, delay, duration, volume, type = 'sine'] of effects[effect] ?? []) {
      const start = this.context.currentTime + delay;
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(.001, start);
      gain.gain.exponentialRampToValueAtTime(volume, start + .009);
      gain.gain.exponentialRampToValueAtTime(.001, start + duration);
      oscillator.connect(gain);
      gain.connect(this.output);
      oscillator.start(start);
      oscillator.stop(start + duration);
    }
  }
}
