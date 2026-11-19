import { useCallback, useEffect, useRef, useState } from 'react';
import type { BandAlbum, BandTrack } from '../types/bandContent';

export interface BandAudioPlayerState {
  activeAlbum: BandAlbum | null;
  activeTrack: BandTrack | null;
  activeTrackIndex: number;
  isPlaying: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  error: string | null;
  selectAlbum: (album: BandAlbum, autoPlay?: boolean) => void;
  playTrack: (album: BandAlbum, trackIndex: number) => void;
  togglePlay: () => void;
  pause: () => void;
  nextTrack: () => void;
  prevTrack: () => void;
  seek: (seconds: number) => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  sampleFrequencyBins: (binCount: number, phase: number) => Float32Array;
}

export function useBandAudioPlayer(initialAlbum: BandAlbum | null): BandAudioPlayerState {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceConnectedRef = useRef(false);
  const freqBufferRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const corsFallbackAttemptedRef = useRef(false);

  const [activeAlbum, setActiveAlbum] = useState<BandAlbum | null>(initialAlbum);
  const [activeTrackIndex, setActiveTrackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.85);
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeAlbumRef = useRef<BandAlbum | null>(activeAlbum);
  const activeTrackIndexRef = useRef(activeTrackIndex);
  activeAlbumRef.current = activeAlbum;
  activeTrackIndexRef.current = activeTrackIndex;

  // Sync initial album once loaded from Supabase
  useEffect(() => {
    if (!activeAlbum && initialAlbum) {
      setActiveAlbum(initialAlbum);
      setActiveTrackIndex(0);
    }
  }, [initialAlbum, activeAlbum]);

  const activeTrack: BandTrack | null =
    activeAlbum && activeAlbum.tracks.length > 0
      ? activeAlbum.tracks[Math.min(activeTrackIndex, activeAlbum.tracks.length - 1)] || null
      : null;

  const ensureAudioElement = useCallback(() => {
    if (audioRef.current) return audioRef.current;
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.crossOrigin = 'anonymous';
    audio.volume = volume;
    audioRef.current = audio;
    return audio;
  }, [volume]);

  const connectAnalyserIfPossible = useCallback((audio: HTMLAudioElement) => {
    if (sourceConnectedRef.current || !audio.crossOrigin) return;
    try {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AC();
      }
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {});
      }
      const source = audioCtxRef.current.createMediaElementSource(audio);
      const analyser = audioCtxRef.current.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.82;
      source.connect(analyser);
      analyser.connect(audioCtxRef.current.destination);
      analyserRef.current = analyser;
      freqBufferRef.current = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      sourceConnectedRef.current = true;
    } catch {
      // If browser/CORS restricts MediaElementSource, HTMLAudio still plays natively
    }
  }, []);

  const loadAndPlay = useCallback(
    (track: BandTrack | null, autoPlay: boolean) => {
      const audio = ensureAudioElement();
      setError(null);
      corsFallbackAttemptedRef.current = false;

      if (!track || !track.audio_url) {
        audio.pause();
        audio.removeAttribute('src');
        setIsPlaying(false);
        setCurrentTime(0);
        setDuration(0);
        if (autoPlay) {
          setError('Esta pista aún no tiene un archivo de audio asignado.');
        }
        return;
      }

      if (audio.src !== track.audio_url) {
        if (!sourceConnectedRef.current) {
          audio.crossOrigin = 'anonymous';
        }
        audio.src = track.audio_url;
        audio.load();
        setCurrentTime(0);
        setDuration(0);
      }

      if (autoPlay) {
        setIsBuffering(true);
        connectAnalyserIfPossible(audio);
        if (audioCtxRef.current?.state === 'suspended') {
          audioCtxRef.current.resume().catch(() => {});
        }
        audio
          .play()
          .then(() => {
            setIsPlaying(true);
            setIsBuffering(false);
          })
          .catch(() => {
            setIsBuffering(false);
            setIsPlaying(false);
            setError('No se pudo reproducir el audio. Verifica el archivo o intenta de nuevo.');
          });
      }
    },
    [ensureAudioElement, connectAnalyserIfPossible]
  );

  // Wire audio element events
  useEffect(() => {
    const audio = ensureAudioElement();

    const onTimeUpdate = () => setCurrentTime(audio.currentTime || 0);
    const onLoadedMeta = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
      setIsBuffering(false);
    };
    const onWaiting = () => setIsBuffering(true);
    const onPlaying = () => {
      setIsBuffering(false);
      setIsPlaying(true);
      setError(null);
    };
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      const alb = activeAlbumRef.current;
      if (!alb || alb.tracks.length === 0) {
        setIsPlaying(false);
        return;
      }
      const nextIdx = activeTrackIndexRef.current + 1;
      if (nextIdx < alb.tracks.length) {
        setActiveTrackIndex(nextIdx);
        loadAndPlay(alb.tracks[nextIdx], true);
      } else {
        setIsPlaying(false);
        setCurrentTime(0);
      }
    };
    const onError = () => {
      // Retry once without crossOrigin if an external audio host lacks CORS headers
      if (!corsFallbackAttemptedRef.current && audio.crossOrigin && !sourceConnectedRef.current && audio.src) {
        corsFallbackAttemptedRef.current = true;
        const srcBackup = audio.src;
        audio.removeAttribute('crossorigin');
        audio.crossOrigin = null;
        audio.src = srcBackup;
        audio.load();
        audio.play().catch(() => {
          setIsPlaying(false);
          setIsBuffering(false);
          setError('Error cargando la pista de audio.');
        });
        return;
      }
      setIsBuffering(false);
      setIsPlaying(false);
      setError('No se pudo cargar este archivo de audio.');
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMeta);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMeta);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
  }, [ensureAudioElement, loadAndPlay]);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.removeAttribute('src');
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  const selectAlbum = useCallback(
    (album: BandAlbum, autoPlay = false) => {
      setActiveAlbum(album);
      setActiveTrackIndex(0);
      const firstTrack = album.tracks[0] || null;
      loadAndPlay(firstTrack, autoPlay);
    },
    [loadAndPlay]
  );

  const playTrack = useCallback(
    (album: BandAlbum, trackIndex: number) => {
      const clamped = Math.max(0, Math.min(trackIndex, Math.max(0, album.tracks.length - 1)));
      const targetTrack = album.tracks[clamped] || null;
      const isSame = activeAlbum?.id === album.id && activeTrackIndex === clamped && audioRef.current?.src === targetTrack?.audio_url;

      setActiveAlbum(album);
      setActiveTrackIndex(clamped);

      if (isSame && audioRef.current) {
        if (isPlaying) {
          audioRef.current.pause();
        } else {
          if (audioCtxRef.current?.state === 'suspended') {
            audioCtxRef.current.resume().catch(() => {});
          }
          audioRef.current.play().catch(() => {});
        }
        return;
      }

      loadAndPlay(targetTrack, true);
    },
    [activeAlbum, activeTrackIndex, isPlaying, loadAndPlay]
  );

  const togglePlay = useCallback(() => {
    const audio = ensureAudioElement();
    if (!activeTrack) return;
    if (isPlaying) {
      audio.pause();
      return;
    }
    if (!audio.src || audio.src !== activeTrack.audio_url) {
      loadAndPlay(activeTrack, true);
      return;
    }
    connectAnalyserIfPossible(audio);
    if (audioCtxRef.current?.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
    audio.play().catch(() => setError('Presiona nuevamente para iniciar reproducción.'));
  }, [activeTrack, isPlaying, ensureAudioElement, loadAndPlay, connectAnalyserIfPossible]);

  const pause = useCallback(() => {
    if (audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
    }
  }, []);

  const nextTrack = useCallback(() => {
    if (!activeAlbum || activeAlbum.tracks.length === 0) return;
    const nextIdx = (activeTrackIndex + 1) % activeAlbum.tracks.length;
    setActiveTrackIndex(nextIdx);
    loadAndPlay(activeAlbum.tracks[nextIdx], true);
  }, [activeAlbum, activeTrackIndex, loadAndPlay]);

  const prevTrack = useCallback(() => {
    if (!activeAlbum || activeAlbum.tracks.length === 0) return;
    if (audioRef.current && audioRef.current.currentTime > 3) {
      audioRef.current.currentTime = 0;
      return;
    }
    const prevIdx = (activeTrackIndex - 1 + activeAlbum.tracks.length) % activeAlbum.tracks.length;
    setActiveTrackIndex(prevIdx);
    loadAndPlay(activeAlbum.tracks[prevIdx], isPlaying);
  }, [activeAlbum, activeTrackIndex, isPlaying, loadAndPlay]);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(seconds)) return;
    audio.currentTime = Math.max(0, Math.min(seconds, audio.duration || seconds));
    setCurrentTime(audio.currentTime);
  }, []);

  const setVolume = useCallback((vol: number) => {
    const clamped = Math.max(0, Math.min(1, vol));
    setVolumeState(clamped);
    setIsMuted(clamped === 0);
    if (audioRef.current) {
      audioRef.current.volume = clamped;
      audioRef.current.muted = clamped === 0;
    }
  }, []);

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    const next = !isMuted;
    setIsMuted(next);
    if (audio) {
      audio.muted = next;
    }
  }, [isMuted]);

  const sampleFrequencyBins = useCallback(
    (binCount: number, phase: number): Float32Array => {
      const out = new Float32Array(binCount);
      const analyser = analyserRef.current;
      const buf = freqBufferRef.current;

      if (isPlaying && analyser && buf) {
        analyser.getByteFrequencyData(buf);
        let energySum = 0;
        for (let i = 0; i < buf.length; i++) energySum += buf[i];
        if (energySum > 0) {
          for (let i = 0; i < binCount; i++) {
            const mapped = Math.floor((i / binCount) * (buf.length * 0.72));
            out[i] = (buf[mapped] || 0) / 255;
          }
          return out;
        }
      }

      // Organic idle / CORS-fallback envelope (never static or robotic)
      for (let i = 0; i < binCount; i++) {
        const w1 = Math.sin(i * 0.28 + phase * 1.9);
        const w2 = Math.cos(i * 0.14 - phase * 1.2);
        const envelope = Math.abs(w1 * w2);
        out[i] = isPlaying ? 0.18 + envelope * 0.72 : 0.05 + envelope * 0.14;
      }
      return out;
    },
    [isPlaying]
  );

  return {
    activeAlbum,
    activeTrack,
    activeTrackIndex,
    isPlaying,
    isBuffering,
    currentTime,
    duration,
    volume,
    isMuted,
    error,
    selectAlbum,
    playTrack,
    togglePlay,
    pause,
    nextTrack,
    prevTrack,
    seek,
    setVolume,
    toggleMute,
    sampleFrequencyBins,
  };
}
