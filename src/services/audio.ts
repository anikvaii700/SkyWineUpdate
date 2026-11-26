// Synthesized Web Audio API Sound Effects + Aviator MP3 Background Music

const AVIATOR_MUSIC_SRC = '/audio/skywin-aviator-music.mp3';
const AVIATOR_MUSIC_VOLUME = 0.45;

type PlayableAudioElement = HTMLAudioElement & { playsInline?: boolean };

class SoundManager {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private engineOscillator: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;

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
    };

    const handleVisibilityChange = () => {
      this.isPageHidden = document.hidden;
      this.syncBgmPlayback();
    };

    const handlePageHide = () => {
      this.isPageHidden = true;
      this.pauseBgm();
    };

    const handlePageShow = () => {
      this.isPageHidden = document.hidden;
      this.syncBgmPlayback();
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

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (muted) {
      this.stopEngineSound();
      this.pauseBgm();
    } else {
      this.hasUserInteracted = true;
      this.syncBgmPlayback();
    }
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  public setAviatorMusicActive(active: boolean) {
    this.bgmDesiredActive = active;
    if (active) {
      this.syncBgmPlayback();
    } else {
      this.pauseBgm();
    }
  }

  public stopAllMusic() {
    this.bgmDesiredActive = false;
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

  // Kept for backward compatibility: ensures the Aviator MP3 background loop stays playing when Aviator is active
  public startEngineSound() {
    if (this.bgmDesiredActive) {
      this.syncBgmPlayback();
    }
  }

  public updateEnginePitch(_multiplier: number) {
    // No-op: replaced synthesized propeller pitch ramp with looping MP3 background music
  }

  public stopEngineSound() {
    try {
      if (this.engineOscillator) {
        this.engineOscillator.stop();
        this.engineOscillator.disconnect();
        this.engineOscillator = null;
      }
      if (this.engineGain) {
        this.engineGain.disconnect();
        this.engineGain = null;
      }
    } catch {
      // ignore
    }
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

  // Plane crash / flew away sound
  public playCrash() {
    this.stopEngineSound();
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
