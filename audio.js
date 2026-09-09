/**
 * audio.js
 * Synthesizes harmonic notification chimes using the Web Audio API.
 * Zero external audio files or dependencies.
 */

export class ChimePlayer {
  constructor() {
    this.ctx = null;
    this.enabled = localStorage.getItem('whatsnext_sound_enabled') !== 'false';
  }

  initContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  setEnabled(val) {
    this.enabled = Boolean(val);
    localStorage.setItem('whatsnext_sound_enabled', String(this.enabled));
  }

  /**
   * Synthesize a bell tone with pleasant harmonic overtones and natural exponential decay.
   */
  createBellTone(freq, startTime, duration = 0.8, volume = 0.25) {
    if (!this.ctx) return;

    // Main fundamental tone oscillator
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, startTime);

    // Subtle metallic overtone (bell harmonic partial ratio ~2.76)
    const overtoneOsc = this.ctx.createOscillator();
    const overtoneGain = this.ctx.createGain();
    overtoneOsc.type = 'sine';
    overtoneOsc.frequency.setValueAtTime(freq * 2.756, startTime);

    // Warm second harmonic for acoustic body
    const harmonicOsc = this.ctx.createOscillator();
    const harmonicGain = this.ctx.createGain();
    harmonicOsc.type = 'triangle';
    harmonicOsc.frequency.setValueAtTime(freq * 2.0, startTime);

    // Envelopes
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(volume, startTime + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    overtoneGain.gain.setValueAtTime(0.0001, startTime);
    overtoneGain.gain.linearRampToValueAtTime(volume * 0.28, startTime + 0.008);
    overtoneGain.gain.exponentialRampToValueAtTime(0.0001, startTime + (duration * 0.45));

    harmonicGain.gain.setValueAtTime(0.0001, startTime);
    harmonicGain.gain.linearRampToValueAtTime(volume * 0.15, startTime + 0.015);
    harmonicGain.gain.exponentialRampToValueAtTime(0.0001, startTime + (duration * 0.6));

    // Connect audio nodes
    osc.connect(gain);
    gain.connect(this.ctx.destination);

    overtoneOsc.connect(overtoneGain);
    overtoneGain.connect(this.ctx.destination);

    harmonicOsc.connect(harmonicGain);
    harmonicGain.connect(this.ctx.destination);

    // Schedule stop
    const stopTime = startTime + duration + 0.05;
    osc.start(startTime);
    osc.stop(stopTime);

    overtoneOsc.start(startTime);
    overtoneOsc.stop(stopTime);

    harmonicOsc.start(startTime);
    harmonicOsc.stop(stopTime);
  }

  /**
   * 5-Minute Warning Chime:
   * Gentle, cheerful ascending 3-note chime (E5 -> G#5 -> B5)
   * Signals: "Heads up! Meeting starts in 5 minutes"
   */
  playWarning5m() {
    if (!this.enabled) return;
    this.initContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime + 0.04;
    // Ascending E-Major triad
    this.createBellTone(659.25, t, 0.75, 0.22);         // E5
    this.createBellTone(830.61, t + 0.13, 0.85, 0.24);  // G#5
    this.createBellTone(987.77, t + 0.26, 1.25, 0.28);  // B5
  }

  /**
   * Meeting Starting Chime:
   * Deep, resonant dual-bell "Ding-Dong" chime (G5 -> C5)
   * Signals: "Your meeting is starting NOW"
   */
  playEventStart() {
    if (!this.enabled) return;
    this.initContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime + 0.04;
    // High crisp "Ding" (G5)
    this.createBellTone(783.99, t, 0.90, 0.28);
    // Deep warm "Dong" (C5) with long 1.8s acoustic resonance
    this.createBellTone(523.25, t + 0.24, 1.80, 0.35);
    // High octave shimmer (C6)
    this.createBellTone(1046.50, t + 0.24, 0.70, 0.12);
  }
}
