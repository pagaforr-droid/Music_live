import { useEffect, useRef, useState } from 'react';
import type { SamplePad } from '../types/sampler.types';

export interface MidiDeviceSummary {
  id: string;
  name: string;
}

interface UseMidiInputOptions {
  enabled: boolean;
  chromaticMode: boolean;
  pads: SamplePad[];
  onTriggerPad: (padIndex: number, velocity01: number) => void;
  onReleasePad: (padIndex: number) => void;
  onPlayChromatic: (midiNote: number, velocity01: number) => void;
  onReleaseChromatic: () => void;
  onMidiCc?: (cc: number, value01: number) => void;
}

export function useMidiInput(options: UseMidiInputOptions) {
  const [supported] = useState<boolean>(
    () => typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function'
  );
  const [inputs, setInputs] = useState<MidiDeviceSummary[]>([]);
  const [selectedInputId, setSelectedInputId] = useState<string>('all');
  const [lastMidiEvent, setLastMidiEvent] = useState<string | null>(null);
  const [midiError, setMidiError] = useState<string | null>(null);

  const optsRef = useRef(options);
  optsRef.current = options;

  useEffect(() => {
    if (!supported || !options.enabled) return;
    let access: WebMidi.MIDIAccess | null = null;
    let cancelled = false;

    const handleMsg = (ev: WebMidi.MIDIMessageEvent) => {
      const data = ev.data;
      if (!data || data.length < 2) return;
      const status = data[0];
      const d1 = data[1];
      const d2 = data.length > 2 ? data[2] : 0;
      const cmd = status & 0xf0;
      const o = optsRef.current;

      if (cmd === 0x90 && d2 > 0) {
        const vel01 = Math.max(0.05, Math.min(1, d2 / 127));
        if (o.chromaticMode) {
          o.onPlayChromatic(d1, vel01);
          setLastMidiEvent(`Nota MIDI ${d1} (Vel ${d2})`);
        } else {
          const idx = o.pads.findIndex((p) => p.midiNote === d1);
          const padIdx = idx >= 0 ? idx : d1 >= 36 && d1 < 52 ? d1 - 36 : -1;
          if (padIdx >= 0) {
            o.onTriggerPad(padIdx, vel01);
            setLastMidiEvent(`Pad ${padIdx + 1} · Nota ${d1} (Vel ${d2})`);
          }
        }
      } else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) {
        if (o.chromaticMode) {
          o.onReleaseChromatic();
        } else {
          const idx = o.pads.findIndex((p) => p.midiNote === d1);
          const padIdx = idx >= 0 ? idx : d1 >= 36 && d1 < 52 ? d1 - 36 : -1;
          if (padIdx >= 0) o.onReleasePad(padIdx);
        }
      } else if (cmd === 0xb0) {
        o.onMidiCc?.(d1, Math.max(0, Math.min(1, d2 / 127)));
        setLastMidiEvent(`CC #${d1}: ${d2}`);
      }
    };

    const bindPorts = (acc: WebMidi.MIDIAccess) => {
      const list: MidiDeviceSummary[] = [];
      acc.inputs.forEach((port) => {
        list.push({ id: port.id, name: port.name || `MIDI ${port.id}` });
        if (selectedInputId === 'all' || port.id === selectedInputId) {
          port.onmidimessage = handleMsg;
        } else {
          port.onmidimessage = null;
        }
      });
      setInputs(list);
    };

    navigator
      .requestMIDIAccess()
      .then((acc) => {
        if (cancelled) return;
        access = acc;
        setMidiError(null);
        bindPorts(acc);
        acc.onstatechange = () => bindPorts(acc);
      })
      .catch((err) => {
        if (!cancelled) {
          setMidiError(
            err instanceof Error ? err.message : 'Permiso MIDI denegado o no disponible.'
          );
        }
      });

    return () => {
      cancelled = true;
      if (access) {
        access.inputs.forEach((p) => {
          p.onmidimessage = null;
        });
      }
    };
  }, [supported, options.enabled, selectedInputId]);

  return {
    supported,
    inputs,
    selectedInputId,
    setSelectedInputId,
    lastMidiEvent,
    midiError,
  };
}
