import { useRef, useCallback, useEffect } from 'react';

/**
 * Synthetic sound effects for poker game events using Web Audio API.
 * Premium-quality procedural sounds - no external audio files needed.
 */
export default function useSoundEffects() {
  const ctxRef = useRef(null);
  const masterGainRef = useRef(null);
  const ambientRef = useRef(null);
  const ambientStartedRef = useRef(false);

  const getVolume = useCallback(() => {
    try {
      const v = parseFloat(localStorage.getItem('sfxVolume'));
      return isNaN(v) ? 1 : Math.max(0, Math.min(1, v));
    } catch {
      return 1;
    }
  }, []);

  const getCtx = useCallback(() => {
    if (!ctxRef.current || ctxRef.current.state === 'closed') {
      ctxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (ctxRef.current.state === 'suspended') {
      ctxRef.current.resume();
    }
    if (!masterGainRef.current) {
      masterGainRef.current = ctxRef.current.createGain();
      masterGainRef.current.connect(ctxRef.current.destination);
    }
    masterGainRef.current.gain.value = getVolume();
    return ctxRef.current;
  }, [getVolume]);

  /** Create a white noise buffer */
  const createNoiseBuffer = useCallback((ctx, duration) => {
    const sampleRate = ctx.sampleRate;
    const length = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }, []);

  /** Card deal: "whiff" swoosh with filtered noise and quick envelope */
  const playDeal = useCallback(() => {
    const ctx = getCtx();
    const t = ctx.currentTime;

    // Main swoosh noise
    const noise = ctx.createBufferSource();
    noise.buffer = createNoiseBuffer(ctx, 0.12);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(4000, t);
    filter.frequency.exponentialRampToValueAtTime(1200, t + 0.1);
    filter.Q.value = 1.2;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.25, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(masterGainRef.current);
    noise.start(t);
    noise.stop(t + 0.12);

    // Subtle thud on landing
    const thud = ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(200, t + 0.06);
    thud.frequency.exponentialRampToValueAtTime(80, t + 0.12);

    const thudGain = ctx.createGain();
    thudGain.gain.setValueAtTime(0, t + 0.06);
    thudGain.gain.linearRampToValueAtTime(0.08, t + 0.07);
    thudGain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

    thud.connect(thudGain);
    thudGain.connect(masterGainRef.current);
    thud.start(t + 0.06);
    thud.stop(t + 0.12);
  }, [getCtx, createNoiseBuffer]);

  /** Chip bet: stacking sound with multiple quick clicks, ascending pitch */
  const playBet = useCallback(() => {
    const ctx = getCtx();
    const t = ctx.currentTime;

    const clickCount = 4;
    for (let i = 0; i < clickCount; i++) {
      const delay = i * 0.04;
      const freq = 600 + i * 150; // ascending pitch

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t + delay);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.7, t + delay + 0.03);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.18, t + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.04);

      osc.connect(gain);
      gain.connect(masterGainRef.current);
      osc.start(t + delay);
      osc.stop(t + delay + 0.04);

      // Noise click component
      const noise = ctx.createBufferSource();
      noise.buffer = createNoiseBuffer(ctx, 0.02);

      const nFilter = ctx.createBiquadFilter();
      nFilter.type = 'highpass';
      nFilter.frequency.value = 3000;

      const nGain = ctx.createGain();
      nGain.gain.setValueAtTime(0.06, t + delay);
      nGain.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.02);

      noise.connect(nFilter);
      nFilter.connect(nGain);
      nGain.connect(masterGainRef.current);
      noise.start(t + delay);
      noise.stop(t + delay + 0.02);
    }
  }, [getCtx, createNoiseBuffer]);

  /** Check: soft tap (sine wave 400hz, 20ms) */
  const playCheck = useCallback(() => {
    const ctx = getCtx();
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 400;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.025);

    osc.connect(gain);
    gain.connect(masterGainRef.current);
    osc.start(t);
    osc.stop(t + 0.025);
  }, [getCtx]);

  /** Fold: swoosh (filtered noise, 200ms fade) */
  const playFold = useCallback(() => {
    const ctx = getCtx();
    const t = ctx.currentTime;

    const noise = ctx.createBufferSource();
    noise.buffer = createNoiseBuffer(ctx, 0.25);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1200, t);
    filter.frequency.exponentialRampToValueAtTime(200, t + 0.25);
    filter.Q.value = 1.5;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(masterGainRef.current);
    noise.start(t);
    noise.stop(t + 0.25);
  }, [getCtx, createNoiseBuffer]);

  /** Win: triumphant chord with octave harmonics and longer sustain */
  const playWin = useCallback(() => {
    const ctx = getCtx();
    const t = ctx.currentTime;

    // C4, E4, G4, C5 (octave) chord with harmonics
    const notes = [
      { freq: 261.63, delay: 0, type: 'sine' },
      { freq: 329.63, delay: 0.08, type: 'sine' },
      { freq: 392.00, delay: 0.16, type: 'sine' },
      { freq: 523.25, delay: 0.24, type: 'sine' },    // octave C5
      { freq: 523.25, delay: 0.24, type: 'triangle' }, // harmonic
      { freq: 659.25, delay: 0.32, type: 'sine' },     // E5
    ];

    notes.forEach(({ freq, delay, type }) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t + delay);
      gain.gain.linearRampToValueAtTime(type === 'triangle' ? 0.08 : 0.15, t + delay + 0.04);
      gain.gain.setValueAtTime(type === 'triangle' ? 0.06 : 0.12, t + delay + 0.2);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 1.2);

      osc.connect(gain);
      gain.connect(masterGainRef.current);
      osc.start(t + delay);
      osc.stop(t + 1.2);
    });

    // Shimmer noise
    const shimmer = ctx.createBufferSource();
    shimmer.buffer = createNoiseBuffer(ctx, 0.8);

    const shimmerFilter = ctx.createBiquadFilter();
    shimmerFilter.type = 'bandpass';
    shimmerFilter.frequency.value = 6000;
    shimmerFilter.Q.value = 3;

    const shimmerGain = ctx.createGain();
    shimmerGain.gain.setValueAtTime(0, t + 0.1);
    shimmerGain.gain.linearRampToValueAtTime(0.03, t + 0.2);
    shimmerGain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);

    shimmer.connect(shimmerFilter);
    shimmerFilter.connect(shimmerGain);
    shimmerGain.connect(masterGainRef.current);
    shimmer.start(t + 0.1);
    shimmer.stop(t + 0.8);
  }, [getCtx, createNoiseBuffer]);

  /** Timer warning: beep (sine 1000hz, 100ms) */
  const playTimer = useCallback(() => {
    const ctx = getCtx();
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 1000;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

    osc.connect(gain);
    gain.connect(masterGainRef.current);
    osc.start(t);
    osc.stop(t + 0.1);
  }, [getCtx]);

  /** All-in: dramatic bass rumble with low frequency oscillation */
  const playAllIn = useCallback(() => {
    const ctx = getCtx();
    const t = ctx.currentTime;

    // Main dramatic tone
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.6);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);

    osc.connect(gain);
    gain.connect(masterGainRef.current);
    osc.start(t);
    osc.stop(t + 0.6);

    // Bass rumble (LFO-modulated sub bass)
    const subOsc = ctx.createOscillator();
    subOsc.type = 'sine';
    subOsc.frequency.value = 40;

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 8;

    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 10;

    lfo.connect(lfoGain);
    lfoGain.connect(subOsc.frequency);

    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.2, t);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);

    subOsc.connect(subGain);
    subGain.connect(masterGainRef.current);
    subOsc.start(t);
    lfo.start(t);
    subOsc.stop(t + 0.8);
    lfo.stop(t + 0.8);

    // Impact noise
    const noise = ctx.createBufferSource();
    noise.buffer = createNoiseBuffer(ctx, 0.15);

    const nFilter = ctx.createBiquadFilter();
    nFilter.type = 'lowpass';
    nFilter.frequency.value = 800;

    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.15, t);
    nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

    noise.connect(nFilter);
    nFilter.connect(nGain);
    nGain.connect(masterGainRef.current);
    noise.start(t);
    noise.stop(t + 0.15);
  }, [getCtx, createNoiseBuffer]);

  /** Turn notification: two-tone alert */
  const playTurn = useCallback(() => {
    const ctx = getCtx();
    const t = ctx.currentTime;

    [523.25, 659.25].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;

      const gain = ctx.createGain();
      const start = t + i * 0.08;
      gain.gain.setValueAtTime(0.2, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.1);

      osc.connect(gain);
      gain.connect(masterGainRef.current);
      osc.start(start);
      osc.stop(start + 0.1);
    });
  }, [getCtx]);

  /** Shuffle: rapid clicking like cards being riffled */
  const playShuffle = useCallback(() => {
    const ctx = getCtx();
    const t = ctx.currentTime;

    const clickCount = 16;
    for (let i = 0; i < clickCount; i++) {
      const delay = i * 0.025 + Math.random() * 0.008;
      const freq = 2000 + Math.random() * 2000;

      const noise = ctx.createBufferSource();
      noise.buffer = createNoiseBuffer(ctx, 0.015);

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = freq;
      filter.Q.value = 2;

      const gain = ctx.createGain();
      const vol = 0.05 + Math.sin(i / clickCount * Math.PI) * 0.08;
      gain.gain.setValueAtTime(vol, t + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.015);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(masterGainRef.current);
      noise.start(t + delay);
      noise.stop(t + delay + 0.015);
    }
  }, [getCtx, createNoiseBuffer]);

  /** Community card reveal: short dramatic sting */
  const playCommunity = useCallback(() => {
    const ctx = getCtx();
    const t = ctx.currentTime;

    // Dramatic rising tone
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.exponentialRampToValueAtTime(600, t + 0.15);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.15, t + 0.02);
    gain.gain.setValueAtTime(0.12, t + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);

    osc.connect(gain);
    gain.connect(masterGainRef.current);
    osc.start(t);
    osc.stop(t + 0.3);

    // Impact
    const impact = ctx.createOscillator();
    impact.type = 'sine';
    impact.frequency.setValueAtTime(150, t + 0.12);
    impact.frequency.exponentialRampToValueAtTime(80, t + 0.25);

    const impactGain = ctx.createGain();
    impactGain.gain.setValueAtTime(0.1, t + 0.12);
    impactGain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

    impact.connect(impactGain);
    impactGain.connect(masterGainRef.current);
    impact.start(t + 0.12);
    impact.stop(t + 0.25);
  }, [getCtx]);

  /** Start ambient casino background (very quiet looping hum) */
  const startAmbient = useCallback(() => {
    if (ambientStartedRef.current) return;
    ambientStartedRef.current = true;

    try {
      const ctx = getCtx();

      // Low ambient hum
      const hum = ctx.createOscillator();
      hum.type = 'sine';
      hum.frequency.value = 60;

      const humGain = ctx.createGain();
      humGain.gain.value = 0.012;

      // Subtle modulation
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.1;

      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.003;

      lfo.connect(lfoGain);
      lfoGain.connect(humGain.gain);

      hum.connect(humGain);
      humGain.connect(masterGainRef.current);

      hum.start();
      lfo.start();

      ambientRef.current = { hum, lfo, humGain };
    } catch (e) {
      // Silently ignore
    }
  }, [getCtx]);

  const playSound = useCallback((type) => {
    try {
      // Start ambient on first sound
      if (!ambientStartedRef.current) {
        startAmbient();
      }

      switch (type) {
        case 'deal':      playDeal();      break;
        case 'bet':       playBet();       break;
        case 'check':     playCheck();     break;
        case 'fold':      playFold();      break;
        case 'win':       playWin();       break;
        case 'timer':     playTimer();     break;
        case 'allin':     playAllIn();     break;
        case 'turn':      playTurn();      break;
        case 'shuffle':   playShuffle();   break;
        case 'community': playCommunity(); break;
        default: break;
      }
    } catch (e) {
      console.warn('Sound playback failed:', e);
    }
  }, [playDeal, playBet, playCheck, playFold, playWin, playTimer, playAllIn, playTurn, playShuffle, playCommunity, startAmbient]);

  // Cleanup ambient on unmount
  useEffect(() => {
    return () => {
      if (ambientRef.current) {
        try {
          ambientRef.current.hum.stop();
          ambientRef.current.lfo.stop();
        } catch (e) { /* ignore */ }
      }
    };
  }, []);

  return { playSound };
}
