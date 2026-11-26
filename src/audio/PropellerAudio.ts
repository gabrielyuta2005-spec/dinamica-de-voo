/**
 * Procedural Web Audio API Octocopter Propeller & Airflow Synthesizer (Zero 404s).
 * Starts muted by default; user toggles sound on/off from the HUD.
 */
export class PropellerAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private oscBase: OscillatorNode | null = null;
  private oscHarmonic: OscillatorNode | null = null;
  private oscGain: GainNode | null = null;
  private noiseFilter: BiquadFilterNode | null = null;
  private noiseGain: GainNode | null = null;
  public enabled = false;

  public toggle(): boolean {
    if (!this.ctx) {
      this.initAudio();
    }
    this.enabled = !this.enabled;
    if (this.ctx && this.ctx.state === 'suspended' && this.enabled) {
      void this.ctx.resume();
    }
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.enabled ? 0.22 : 0.0, this.ctx.currentTime, 0.06);
    }
    return this.enabled;
  }

  private initAudio(): void {
    const AudioCtx = window.AudioContext || (window as unknown as {webkitAudioContext: typeof AudioContext}).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    this.ctx = ctx;

    const masterGain = ctx.createGain();
    masterGain.gain.value = 0;
    masterGain.connect(ctx.destination);
    this.masterGain = masterGain;

    // Blade-pass fundamental (2-blade * 8 rotors = beat hum)
    const oscBase = ctx.createOscillator();
    oscBase.type = 'triangle';
    oscBase.frequency.value = 125;

    const oscHarmonic = ctx.createOscillator();
    oscHarmonic.type = 'sawtooth';
    oscHarmonic.frequency.value = 250;

    const oscFilter = ctx.createBiquadFilter();
    oscFilter.type = 'lowpass';
    oscFilter.frequency.value = 480;

    const oscGain = ctx.createGain();
    oscGain.gain.value = 0.25;

    oscBase.connect(oscFilter);
    oscHarmonic.connect(oscFilter);
    oscFilter.connect(oscGain);
    oscGain.connect(masterGain);

    oscBase.start();
    oscHarmonic.start();

    this.oscBase = oscBase;
    this.oscHarmonic = oscHarmonic;
    this.oscGain = oscGain;

    // Procedural white noise buffer for rotor downwash air rush
    const bufferSize = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = buffer;
    noiseSource.loop = true;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 650;
    noiseFilter.Q.value = 0.9;

    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.25;

    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(masterGain);
    noiseSource.start();

    this.noiseFilter = noiseFilter;
    this.noiseGain = noiseGain;
  }

  public update(meanOmega: number, powerW: number): void {
    if (!this.enabled || !this.ctx || !this.oscBase || !this.oscHarmonic || !this.oscGain || !this.noiseFilter || !this.noiseGain) {
      return;
    }
    const now = this.ctx.currentTime;
    // 2-blade BPF = 2 * omega / (2*pi) = omega / pi
    const bpf = Math.max(25, meanOmega / Math.PI);
    const loadNorm = Math.min(1.8, Math.max(0.1, powerW / 717));

    this.oscBase.frequency.setTargetAtTime(bpf, now, 0.04);
    this.oscHarmonic.frequency.setTargetAtTime(bpf * 2.02, now, 0.04);
    this.oscGain.gain.setTargetAtTime(0.14 + loadNorm * 0.14, now, 0.05);
    this.noiseFilter.frequency.setTargetAtTime(320 + meanOmega * 1.4, now, 0.05);
    this.noiseGain.gain.setTargetAtTime(0.1 + loadNorm * 0.18, now, 0.05);
  }

  public dispose(): void {
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
