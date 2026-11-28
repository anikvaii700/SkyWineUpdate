// Synthesized Web Audio API Sound Effects + Aviator MP3 Background Music

const AVIATOR_MUSIC_SRC = '/audio/skywin-aviator-music.mp3';
const AVIATOR_MUSIC_VOLUME = 0.45;

type PlayableAudioElement = HTMLAudioElement & { playsInline?: boolean };

class SoundManager {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;

  // Layered airplane flight audio nodes (active only while flying with an active bet)
  private engineMasterGain: GainNode | null = null;
  private engineHumOsc: OscillatorNode | null = null;
  private engineTurbineOsc: OscillatorNode | null = null;
  private engineLfoOsc: OscillatorNode | null = null;
  private engineLfoGain: GainNode | null = null;
  private engineHumFilter: BiquadFilterNode | null = null;
  private engineNoiseSource: AudioBufferSourceNode | null = null;
  private engineNoiseFilter: BiquadFilterNode | null = null;
  private engineNoiseGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private engineDesiredActive: boolean = false;
  private isEngineRunning: boolean = false;

  // Single-instance looping background music state
  private bgmAudio: PlayableAudioElement | null = null;
  private bgmDesiredActive: boolean = false;
  private bgmPlayPending: boolean = false;
  private hasUserInteracted: boolean = false;
  private isPageHidden: boolean = false;
  private lifecycleBound: boolean = false;

  constructor() {
    this.bindLifecycleListeners();
  }

  private bindLifecycleListeners() {
    if (this.lifecycleBound || typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }
    this.lifecycleBound = true;
    this.isPageHidden = document.hidden;

    const handleUserGesture = () => {
      this.hasUserInteracted = true;
      if (!this.isMuted && this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      this.syncBgmPlayback();
      this.syncEnginePlayback();
    };

    const handleVisibilityChange = () => {
      this.isPageHidden = document.hidden;
      this.syncBgmPlayback();
      this.syncEnginePlayback();
    };

    const handlePageHide = () => {
      this.isPageHidden = true;
      this.pauseBgm();
      this.stopEngineSound();
    };

    const handlePageShow = () => {
      this.isPageHidden = document.hidden;
      this.syncBgmPlayback();
      this.syncEnginePlayback();
    };

    // Bubble-phase listeners run after React's onClick so muting on the first tap never triggers a blip.
    window.addEventListener('click', handleUserGesture, { passive: true });
    window.addEventListener('touchend', handleUserGesture, { passive: true });
    window.addEventListener('keydown', handleUserGesture, { passive: true });
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
  }

  private ensureBgmAudio(): PlayableAudioElement | null {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') {
      return null;
    }
    if (!this.bgmAudio) {
      const audio = new Audio(AVIATOR_MUSIC_SRC) as PlayableAudioElement;
      audio.loop = true;
      audio.preload = 'auto';
      audio.volume = AVIATOR_MUSIC_VOLUME;
      audio.playsInline = true;
      audio.muted = this.isMuted;
      this.bgmAudio = audio;
    }
    return this.bgmAudio;
  }

  private pauseBgm() {
    if (!this.bgmAudio) return;
    try {
      this.bgmAudio.muted = this.isMuted;
      if (!this.bgmAudio.paused) {
        this.bgmAudio.pause();
      }
    } catch {
      // ignore
    }
  }

  private syncBgmPlayback() {
    this.bindLifecycleListeners();

    if (!this.bgmDesiredActive || this.isMuted || this.isPageHidden) {
      this.pauseBgm();
      return;
    }

    if (!this.hasUserInteracted) {
      return;
    }

    const audio = this.ensureBgmAudio();
    if (!audio) return;

    audio.loop = true;
    audio.volume = AVIATOR_MUSIC_VOLUME;
    audio.muted = false;

    if (!audio.paused || this.bgmPlayPending) {
      return;
    }

    this.bgmPlayPending = true;
    try {
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise
          .then(() => {
            this.bgmPlayPending = false;
            if (!this.bgmDesiredActive || this.isMuted || this.isPageHidden) {
              this.pauseBgm();
            }
          })
          .catch(() => {
            this.bgmPlayPending = false;
          });
      } else {
        this.bgmPlayPending = false;
      }
    } catch {
      this.bgmPlayPending = false;
    }
  }

  private initContext() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  private getNoiseBuffer(): AudioBuffer | null {
    if (!this.ctx) return null;
    if (!this.noiseBuffer || this.noiseBuffer.sampleRate !== this.ctx.sampleRate) {
      const durationSec = 2;
      const bufferSize = Math.floor(this.ctx.sampleRate * durationSec);
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = buffer.getChannelData(0);
      // Warm pink-tinted noise for realistic jet airflow & crash rumble
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + white * 0.099046;
        b1 = 0.96300 * b1 + white * 0.2965164;
        b2 = 0.57000 * b2 + white * 1.0526913;
        output[i] = Math.max(-1, Math.min(1, (b0 + b1 + b2 + white * 0.1848) * 0.18));
      }
      this.noiseBuffer = buffer;
    }
    return this.noiseBuffer;
  }

  private syncEnginePlayback() {
    if (!this.engineDesiredActive || !this.bgmDesiredActive || this.isMuted || this.isPageHidden) {
      this.stopEngineSound();
      return;
    }
    if (!this.hasUserInteracted || this.isEngineRunning) {
      return;
    }
    this.startEngineNodes();
  }

  private startEngineNodes() {
    if (this.isEngineRunning || this.isMuted || this.isPageHidden || !this.bgmDesiredActive) {
      return;
    }
    try {
      this.initContext();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;
      const masterGain = this.ctx.createGain();
      masterGain.gain.setValueAtTime(0.0001, now);
      masterGain.gain.exponentialRampToValueAtTime(0.32, now + 0.55);
      masterGain.connect(this.ctx.destination);

      // 1. Warm propeller / aircraft engine core hum
      const humOsc = this.ctx.createOscillator();
      humOsc.type = 'sawtooth';
      humOsc.frequency.setValueAtTime(68, now);
      humOsc.frequency.exponentialRampToValueAtTime(102, now + 0.75);

      const humFilter = this.ctx.createBiquadFilter();
      humFilter.type = 'lowpass';
      humFilter.frequency.setValueAtTime(240, now);
      humFilter.frequency.exponentialRampToValueAtTime(420, now + 0.75);
      humFilter.Q.setValueAtTime(2.2, now);

      const humGain = this.ctx.createGain();
      humGain.gain.setValueAtTime(0.34, now);

      // Subtle propeller thrum modulation via LFO
      const lfoOsc = this.ctx.createOscillator();
      lfoOsc.type = 'sine';
      lfoOsc.frequency.setValueAtTime(17, now);

      const lfoGain = this.ctx.createGain();
      lfoGain.gain.setValueAtTime(0.06, now);

      lfoOsc.connect(lfoGain);
      lfoGain.connect(humGain.gain);

      humOsc.connect(humFilter);
      humFilter.connect(humGain);
      humGain.connect(masterGain);

      // 2. Smooth jet turbine harmonic whine
      const turbineOsc = this.ctx.createOscillator();
      turbineOsc.type = 'triangle';
      turbineOsc.frequency.setValueAtTime(195, now);
      turbineOsc.frequency.exponentialRampToValueAtTime(290, now + 0.8);

      const turbineGain = this.ctx.createGain();
      turbineGain.gain.setValueAtTime(0.09, now);

      turbineOsc.connect(turbineGain);
      turbineGain.connect(masterGain);

      // 3. Jet airflow / wind whoosh (bandpass-filtered noise)
      const buffer = this.getNoiseBuffer();
      let noiseSource: AudioBufferSourceNode | null = null;
      let noiseFilter: BiquadFilterNode | null = null;
      let noiseGain: GainNode | null = null;

      if (buffer) {
        noiseSource = this.ctx.createBufferSource();
        noiseSource.buffer = buffer;
        noiseSource.loop = true;

        noiseFilter = this.ctx.createBiquadFilter();
        noiseFilter.type = 'bandpass';
        noiseFilter.frequency.setValueAtTime(340, now);
        noiseFilter.frequency.exponentialRampToValueAtTime(680, now + 0.8);
        noiseFilter.Q.setValueAtTime(1.1, now);

        noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(0.55, now);

        noiseSource.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(masterGain);
        noiseSource.start(now);
      }

      humOsc.start(now);
      lfoOsc.start(now);
      turbineOsc.start(now);

      this.engineMasterGain = masterGain;
      this.engineHumOsc = humOsc;
      this.engineHumFilter = humFilter;
      this.engineTurbineOsc = turbineOsc;
      this.engineLfoOsc = lfoOsc;
      this.engineLfoGain = lfoGain;
      this.engineNoiseSource = noiseSource;
      this.engineNoiseFilter = noiseFilter;
      this.engineNoiseGain = noiseGain;
      this.isEngineRunning = true;
    } catch {
      this.stopEngineSound();
    }
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (muted) {
      this.stopEngineSound();
      this.pauseBgm();
    } else {
      this.hasUserInteracted = true;
      this.syncBgmPlayback();
      this.syncEnginePlayback();
    }
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  public setAviatorMusicActive(active: boolean) {
    this.bgmDesiredActive = active;
    if (active) {
      this.syncBgmPlayback();
      this.syncEnginePlayback();
    } else {
      this.pauseBgm();
      this.stopEngineSound();
    }
  }

  public setPlaneFlightActive(active: boolean) {
    this.engineDesiredActive = active;
    if (active) {
      if (this.bgmDesiredActive) {
        this.syncBgmPlayback();
      }
      this.syncEnginePlayback();
    } else {
      this.stopEngineSound();
    }
  }

  public stopAllMusic() {
    this.bgmDesiredActive = false;
    this.engineDesiredActive = false;
    this.pauseBgm();
    if (this.bgmAudio) {
      try {
        this.bgmAudio.currentTime = 0;
      } catch {
        // ignore
      }
    }
    this.stopEngineSound();
  }

  public isAviatorMusicPlaying(): boolean {
    return Boolean(this.bgmAudio && !this.bgmAudio.paused && !this.isMuted);
  }

  // Button click / chip select
  public playClick() {
    this.hasUserInteracted = true;
    if (this.isMuted) return;
    try {
      this.initContext();
      if (!this.ctx) return;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(300, this.ctx.currentTime + 0.05);

      gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.05);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.05);
    } catch {
      // Audio autoplay policy
    }
  }

  // Countdown beep for waiting phase
  public playBeep(isHigh = false) {
    if (this.isMuted) return;
    try {
      this.initContext();
      if (!this.ctx) return;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(isHigh ? 880 : 440, this.ctx.currentTime);

      gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.1);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.1);
    } catch {
      // ignore
    }
  }

  // Starts the airplane flying engine sound layered over the default Aviator BGM
  public startEngineSound() {
    this.setPlaneFlightActive(true);
  }

  // Smoothly raises airplane pitch, propeller cadence, and airflow as multiplier climbs
  public updateEnginePitch(multiplier: number) {
    if (!this.isEngineRunning || !this.ctx || this.isMuted) return;
    try {
      const now = this.ctx.currentTime;
      const safeMult = Math.max(1, multiplier);
      const climb = Math.min(1, Math.log2(safeMult) / 5.5); // smooth 0 -> 1 curve up to ~45x

      if (this.engineHumOsc) {
        const targetHum = 102 + climb * 98; // 102 Hz -> 200 Hz
        this.engineHumOsc.frequency.setTargetAtTime(targetHum, now, 0.12);
      }
      if (this.engineHumFilter) {
        const targetCutoff = 420 + climb * 460; // 420 Hz -> 880 Hz
        this.engineHumFilter.frequency.setTargetAtTime(targetCutoff, now, 0.12);
      }
      if (this.engineTurbineOsc) {
        const targetTurbine = 290 + climb * 340; // 290 Hz -> 630 Hz
        this.engineTurbineOsc.frequency.setTargetAtTime(targetTurbine, now, 0.12);
      }
      if (this.engineLfoOsc) {
        const targetLfo = 17 + climb * 16; // 17 Hz -> 33 Hz
        this.engineLfoOsc.frequency.setTargetAtTime(targetLfo, now, 0.12);
      }
      if (this.engineNoiseFilter) {
        const targetAirflow = 680 + climb * 820; // 680 Hz -> 1500 Hz
        this.engineNoiseFilter.frequency.setTargetAtTime(targetAirflow, now, 0.12);
      }
    } catch {
      // ignore
    }
  }

  public stopEngineSound() {
    this.isEngineRunning = false;
    const ctx = this.ctx;
    const masterGain = this.engineMasterGain;
    const humOsc = this.engineHumOsc;
    const turbineOsc = this.engineTurbineOsc;
    const lfoOsc = this.engineLfoOsc;
    const lfoGain = this.engineLfoGain;
    const humFilter = this.engineHumFilter;
    const noiseSource = this.engineNoiseSource;
    const noiseFilter = this.engineNoiseFilter;
    const noiseGain = this.engineNoiseGain;

    this.engineMasterGain = null;
    this.engineHumOsc = null;
    this.engineTurbineOsc = null;
    this.engineLfoOsc = null;
    this.engineLfoGain = null;
    this.engineHumFilter = null;
    this.engineNoiseSource = null;
    this.engineNoiseFilter = null;
    this.engineNoiseGain = null;

    const cleanupNodes = () => {
      try { humOsc?.stop(); } catch {}
      try { turbineOsc?.stop(); } catch {}
      try { lfoOsc?.stop(); } catch {}
      try { noiseSource?.stop(); } catch {}
      try { humOsc?.disconnect(); } catch {}
      try { turbineOsc?.disconnect(); } catch {}
      try { lfoOsc?.disconnect(); } catch {}
      try { lfoGain?.disconnect(); } catch {}
      try { humFilter?.disconnect(); } catch {}
      try { noiseSource?.disconnect(); } catch {}
      try { noiseFilter?.disconnect(); } catch {}
      try { noiseGain?.disconnect(); } catch {}
      try { masterGain?.disconnect(); } catch {}
    };

    if (ctx && masterGain) {
      try {
        const now = ctx.currentTime;
        masterGain.gain.cancelScheduledValues(now);
        masterGain.gain.setValueAtTime(Math.max(0.0001, masterGain.gain.value), now);
        masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
        window.setTimeout(cleanupNodes, 85);
        return;
      } catch {
        // fall through to immediate cleanup
      }
    }
    cleanupNodes();
  }

  // Triumphant win chime when user cashes out
  public playWin() {
    if (this.isMuted) return;
    try {
      this.initContext();
      if (!this.ctx) return;

      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      const now = this.ctx.currentTime;

      notes.forEach((freq, idx) => {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.08);

        gain.gain.setValueAtTime(0.2, now + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.35);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now + idx * 0.08);
        osc.stop(now + idx * 0.08 + 0.35);
      });
    } catch {
      // ignore
    }
  }

  // Realistic Aviator airplane crash / flew-away impact sound
  public playPlaneCrash() {
    this.engineDesiredActive = false;
    this.stopEngineSound();
    if (this.isMuted || this.isPageHidden || !this.bgmDesiredActive || !this.hasUserInteracted) {
      return;
    }
    try {
      this.initContext();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;

      // 1. Deep sub-bass crash boom impact
      const boomOsc = this.ctx.createOscillator();
      const boomGain = this.ctx.createGain();
      boomOsc.type = 'sine';
      boomOsc.frequency.setValueAtTime(145, now);
      boomOsc.frequency.exponentialRampToValueAtTime(32, now + 0.55);

      boomGain.gain.setValueAtTime(0.45, now);
      boomGain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);

      boomOsc.connect(boomGain);
      boomGain.connect(this.ctx.destination);
      boomOsc.start(now);
      boomOsc.stop(now + 0.68);

      // 2. Turbine stall / downward dive pitch drop
      const diveOsc = this.ctx.createOscillator();
      const diveFilter = this.ctx.createBiquadFilter();
      const diveGain = this.ctx.createGain();

      diveOsc.type = 'sawtooth';
      diveOsc.frequency.setValueAtTime(360, now);
      diveOsc.frequency.exponentialRampToValueAtTime(48, now + 0.45);

      diveFilter.type = 'lowpass';
      diveFilter.frequency.setValueAtTime(950, now);
      diveFilter.frequency.exponentialRampToValueAtTime(160, now + 0.45);

      diveGain.gain.setValueAtTime(0.22, now);
      diveGain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);

      diveOsc.connect(diveFilter);
      diveFilter.connect(diveGain);
      diveGain.connect(this.ctx.destination);
      diveOsc.start(now);
      diveOsc.stop(now + 0.5);

      // 3. Explosion & jet fly-away whoosh burst (filtered noise)
      const buffer = this.getNoiseBuffer();
      if (buffer) {
        const crashNoise = this.ctx.createBufferSource();
        crashNoise.buffer = buffer;

        const crashFilter = this.ctx.createBiquadFilter();
        crashFilter.type = 'lowpass';
        crashFilter.frequency.setValueAtTime(1650, now);
        crashFilter.frequency.exponentialRampToValueAtTime(140, now + 0.78);
        crashFilter.Q.setValueAtTime(0.9, now);

        const crashGain = this.ctx.createGain();
        crashGain.gain.setValueAtTime(0.5, now);
        crashGain.gain.exponentialRampToValueAtTime(0.001, now + 0.85);

        crashNoise.connect(crashFilter);
        crashFilter.connect(crashGain);
        crashGain.connect(this.ctx.destination);
        crashNoise.start(now);
        crashNoise.stop(now + 0.88);
      }
    } catch {
      // ignore
    }
  }

  // Short UI alert / error buzz (used for invalid inputs & rejected actions)
  public playCrash() {
    if (this.isMuted) return;
    try {
      this.initContext();
      if (!this.ctx) return;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(40, this.ctx.currentTime + 0.3);

      gain.gain.setValueAtTime(0.25, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.35);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.35);
    } catch {
      // ignore
    }
  }

  // Clear melodic chime for Admin notifications (new Add Money / Cashout request)
  public playNotificationChime() {
    if (this.isMuted) return;
    try {
      this.initContext();
      if (!this.ctx) return;

      const notes = [587.33, 739.99, 880, 1174.66]; // D5, F#5, A5, D6
      const now = this.ctx.currentTime;

      notes.forEach((freq, idx) => {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.1);

        gain.gain.setValueAtTime(0.28, now + idx * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 0.35);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now + idx * 0.1);
        osc.stop(now + idx * 0.1 + 0.35);
      });
    } catch {
      // ignore
    }
  }

  // Realistic peg tick sound when lucky wheel passes a sector
  public playWheelTick() {
    if (this.isMuted) return;
    try {
      this.initContext();
      if (!this.ctx) return;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(850, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(400, this.ctx.currentTime + 0.025);

      gain.gain.setValueAtTime(0.18, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.025);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.025);
    } catch {
      // ignore
    }
  }

  // Grand celebratory fanfare for Lucky Spinner and 7-day streak bonus
  public playJackpot() {
    if (this.isMuted) return;
    try {
      this.initContext();
      if (!this.ctx) return;

      const notes = [523.25, 659.25, 783.99, 1046.50, 1318.51, 1567.98]; // C5, E5, G5, C6, E6, G6
      const now = this.ctx.currentTime;

      notes.forEach((freq, idx) => {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.07);

        gain.gain.setValueAtTime(0.22, now + idx * 0.07);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.4);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now + idx * 0.07);
        osc.stop(now + idx * 0.07 + 0.4);
      });
    } catch {
      // ignore
    }
  }
}

export const soundManager = new SoundManager();
