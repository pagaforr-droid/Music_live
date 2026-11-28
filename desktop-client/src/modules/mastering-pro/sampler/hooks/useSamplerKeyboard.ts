import { useEffect, useRef } from 'react';
import { DEFAULT_QWERTY_KEYS } from '../engine/SampleBufferOps';

// Two-octave piano layout on QWERTY keys starting from C(baseOctave)
const PIANO_KEY_OFFSET: Record<string, number> = {
  z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11,
  q: 12, '2': 13, w: 14, '3': 15, e: 16, r: 17, '5': 18, t: 19, '6': 20, y: 21, '7': 22, u: 23, i: 24,
};

interface UseSamplerKeyboardOptions {
  enabled: boolean;
  chromaticMode: boolean;
  chromaticBaseMidi: number;
  onTriggerPad: (padIndex: number) => void;
  onReleasePad: (padIndex: number) => void;
  onPlayChromatic: (midiNote: number) => void;
  onReleaseChromatic: () => void;
  onToggleAudition: () => void;
  onToggleLoop: () => void;
  onCreateSliceAtCursor: () => void;
  onNudgeRegion: (deltaSamples: number) => void;
}

export function useSamplerKeyboard(options: UseSamplerKeyboardOptions) {
  const optsRef = useRef(options);
  optsRef.current = options;

  useEffect(() => {
    if (!options.enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isTextInput =
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        Boolean(target?.isContentEditable) ||
        (tag === 'INPUT' &&
          (target as HTMLInputElement).type !== 'range' &&
          (target as HTMLInputElement).type !== 'checkbox');
      if (isTextInput) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const o = optsRef.current;

      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) o.onToggleAudition();
        return;
      }

      if (e.code === 'ArrowLeft') {
        e.preventDefault();
        o.onNudgeRegion(e.shiftKey ? -480 : -1);
        return;
      }
      if (e.code === 'ArrowRight') {
        e.preventDefault();
        o.onNudgeRegion(e.shiftKey ? 480 : 1);
        return;
      }

      if (e.repeat) return;
      const keyLower = e.key.toLowerCase();

      if (keyLower === 'l') {
        o.onToggleLoop();
        return;
      }

      if (o.chromaticMode) {
        const semi = PIANO_KEY_OFFSET[keyLower];
        if (semi !== undefined) {
          e.preventDefault();
          o.onPlayChromatic(o.chromaticBaseMidi + semi);
          return;
        }
      } else {
        const padIdx = DEFAULT_QWERTY_KEYS.findIndex(
          (k) => k.toLowerCase() === keyLower
        );
        if (padIdx >= 0) {
          e.preventDefault();
          o.onTriggerPad(padIdx);
          return;
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const o = optsRef.current;
      const keyLower = e.key.toLowerCase();

      if (o.chromaticMode) {
        if (PIANO_KEY_OFFSET[keyLower] !== undefined) {
          o.onReleaseChromatic();
        }
      } else {
        const padIdx = DEFAULT_QWERTY_KEYS.findIndex(
          (k) => k.toLowerCase() === keyLower
        );
        if (padIdx >= 0) {
          o.onReleasePad(padIdx);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [options.enabled]);
}
