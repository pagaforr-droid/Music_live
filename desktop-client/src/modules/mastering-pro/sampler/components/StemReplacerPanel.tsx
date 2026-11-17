import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CloudUpload,
  Disc3,
  Download,
  FolderArchive,
  FolderOpen,
  Guitar,
  Layers,
  Loader2,
  Mic,
  Music2,
  Pause,
  Play,
  RefreshCw,
  Sliders,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Volume2,
  Wand2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { midiNoteToName } from '../engine/PitchDetector';
import {
  BASS_PRESET_CATALOG,
  DRUM_PRESET_CATALOG,
  isBassPresetId,
  MELODIC_PRESET_CATALOG,
} from '../engine/StudioSampleBank';
import type { useStemReplacer } from '../hooks/useStemReplacer';
import type {
  CustomSampleCategory,
  DefaultInstrumentId,
  DrumPieceRole,
  ImportedAudioMemoryAnalysis,
  SamplePad,
  StemAnalysisMode,
} from '../types/sampler.types';

interface StemReplacerPanelProps {
  replacer: ReturnType<typeof useStemReplacer>;
  padsFromCreator: SamplePad[];
  onAuditionCreatorPad?: (padIndex: number) => void;
  getBufferForPad?: (padIndex: number) => AudioBuffer | null;
  onSendTo16Pads?: (
    buffer: AudioBuffer,
    title: string,
    preAnalysis?: ImportedAudioMemoryAnalysis | null
  ) => void;
}

const DRUM_ROLES: Array<{ role: DrumPieceRole; label: string; color: string }> = [
  { role: 'kick', label: 'Kick (Bombo)', color: '#FF6B00' },
  { role: 'snare', label: 'Snare (Caja)', color: '#00E5FF' },
  { role: 'hat', label: 'Hi-Hat / Platos', color: '#F59E0B' },
  { role: 'tom', label: 'Tom / Perc', color: '#10B981' },
];

const MODE_LABELS: Array<{ id: StemAnalysisMode; label: string; hint: string }> = [
  { id: 'drums', label: 'Batería (Golpes)', hint: 'Kick · Snare · Hat · Tom' },
  { id: 'monophonic', label: 'Melódico Mono', hint: 'Bajo · Lead · 1 nota a la vez' },
  { id: 'polyphonic', label: 'Polifónico (Acordes)', hint: 'Guitarra · Piano · Keys+' },
];

const CATEGORY_BADGES: Record<CustomSampleCategory, { label: string; color: string }> = {
  kick: { label: 'KICK', color: '#FF6B00' },
  snare: { label: 'SNARE', color: '#00E5FF' },
  hat: { label: 'HI-HAT', color: '#F59E0B' },
  tom: { label: 'TOM', color: '#10B981' },
  melodic: { label: 'TONAL', color: '#A855F7' },
};

const formatTime = (sec: number) => {
  const s = Math.max(0, sec);
  const mins = Math.floor(s / 60);
  const rem = s - mins * 60;
  return `${String(mins).padStart(2, '0')}:${rem.toFixed(1).padStart(4, '0')}`;
};

export const StemReplacerPanel: React.FC<StemReplacerPanelProps> = ({
  replacer,
  padsFromCreator,
  getBufferForPad,
  onSendTo16Pads,
}) => {
  const r = replacer;
  const stemFileInputRef = useRef<HTMLInputElement | null>(null);
  const slotFileInputRef = useRef<HTMLInputElement | null>(null);
  const bankBatchFileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadTargetRef = useRef<DrumPieceRole | 'melodic'>('melodic');

  const [songSearch, setSongSearch] = useState('');
  const [zoom, setZoom] = useState(1);
  const [scrollNorm, setScrollNorm] = useState(0);
  const [saveStemName, setSaveStemName] = useState('');
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [showCustomBank, setShowCustomBank] = useState(false);
  const [showCloudSamplePicker, setShowCloudSamplePicker] = useState(false);
  const [cloudTargetRole, setCloudTargetRole] = useState<CustomSampleCategory>('kick');
  const [melodicCategoryFilter, setMelodicCategoryFilter] = useState<'all' | 'bass' | 'keys-guitar'>('all');
  const [dragOverTarget, setDragOverTarget] = useState<DrumPieceRole | 'melodic' | 'bank' | 'stem-local' | null>(null);
  const [showBeatGrid, setShowBeatGrid] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (r.customSamples.length > 0) {
      setShowCustomBank(true);
    }
  }, [r.customSamples.length]);

  useEffect(() => {
    if (r.stemTitle) {
      setSaveStemName(`${r.stemTitle} (Sampled Pro)`);
    }
  }, [r.stemTitle]);

  useEffect(() => {
    setZoom(1);
    setScrollNorm(0);
  }, [r.originalBuffer]);

  const filteredSongs = useMemo(
    () =>
      r.songs.filter((s) =>
        s.title.toLowerCase().includes(songSearch.toLowerCase())
      ),
    [r.songs, songSearch]
  );

  const loadedCreatorPads = useMemo(
    () => padsFromCreator.filter((p) => Boolean(p.regionId)),
    [padsFromCreator]
  );

  // High-DPI Waveform + Detected Hits / Polyphonic Piano Roll Renderer
  const duration = r.originalBuffer?.duration ?? 0;
  const viewSpanSec = duration > 0 ? duration / zoom : 1;
  const maxViewStart = Math.max(0, duration - viewSpanSec);
  const viewStartSec = Math.max(0, Math.min(maxViewStart, scrollNorm * duration));
  const viewEndSec = viewStartSec + viewSpanSec;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(320, rect.width);
    const h = Math.max(170, rect.height);
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#040711';
    ctx.fillRect(0, 0, w, h);

    const midY = h / 2;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();

    if (!r.originalBuffer || duration <= 0) {
      ctx.fillStyle = 'rgba(148, 163, 184, 0.65)';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(
        '1. Elige una Canción arriba → 2. Selecciona 1 Stem (ej. Batería, Piano, Guitarra, Bajo)',
        w / 2,
        midY + 4
      );
      ctx.textAlign = 'left';
      return;
    }

    const secToX = (sec: number) => ((sec - viewStartSec) / viewSpanSec) * w;

    // 1. Draw waveform from pyramid
    const sr = r.originalBuffer.sampleRate;
    const s0 = Math.max(0, Math.floor(viewStartSec * sr));
    const s1 = Math.min(r.originalBuffer.length, Math.ceil(viewEndSec * sr));
    const visibleSamples = Math.max(1, s1 - s0);
    const samplesPerPx = visibleSamples / w;

    ctx.fillStyle =
      r.abMode === 'replaced' ? 'rgba(0, 229, 255, 0.35)' : 'rgba(148, 163, 184, 0.45)';
    const level =
      r.waveformPyramid?.levels
        .slice()
        .reverse()
        .find((lvl) => lvl.bucketSize <= Math.max(1, samplesPerPx)) ??
      r.waveformPyramid?.levels[0];

    if (level) {
      for (let x = 0; x < w; x++) {
        const ps0 = s0 + x * samplesPerPx;
        const ps1 = s0 + (x + 1) * samplesPerPx;
        const b0 = Math.max(0, Math.floor(ps0 / level.bucketSize));
        const b1 = Math.min(level.mins.length - 1, Math.ceil(ps1 / level.bucketSize));
        let mn = 1;
        let mx = -1;
        for (let b = b0; b <= b1; b++) {
          if (level.mins[b] < mn) mn = level.mins[b];
          if (level.maxs[b] > mx) mx = level.maxs[b];
        }
        const yTop = midY - mx * (h * 0.43);
        const yBot = midY - mn * (h * 0.43);
        ctx.fillRect(x, yTop, 1.2, Math.max(1.5, yBot - yTop));
      }
    }

    // 1B. Overlay Stem Studio Beat Grid (`beatTimes` + `downbeats`) & Chord Progression Guide
    if (showBeatGrid && (r.importedMemory?.beatTimes?.length || (r.importedMemory?.bpm ?? 0) > 0)) {
      const mem = r.importedMemory!;
      const gridBeats =
        mem.beatTimes && mem.beatTimes.length >= 2
          ? mem.beatTimes
          : (() => {
              const step = 60 / Math.max(40, mem.bpm || 120);
              const off = mem.beatOffsetSec ?? 0;
              const arr: number[] = [];
              let t = off;
              while (t <= duration + step) {
                arr.push(t);
                t += step;
              }
              return arr;
            })();
      const dbs = mem.downbeats;
      const downSet = new Set((dbs ?? []).map((d) => Math.round(d * 20)));
      let lastBarLabelX = -999;

      for (let idx = 0; idx < gridBeats.length; idx++) {
        const bt = gridBeats[idx];
        if (bt < viewStartSec - 0.01 || bt > viewEndSec + 0.01) continue;
        const x = secToX(bt);
        const isDownbeat = dbs ? downSet.has(Math.round(bt * 20)) : idx % 4 === 0;
        ctx.strokeStyle = isDownbeat
          ? 'rgba(0, 229, 255, 0.44)'
          : 'rgba(0, 229, 255, 0.14)';
        ctx.lineWidth = isDownbeat ? 1.4 : 1;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();

        if (isDownbeat && x - lastBarLabelX >= 28 && x >= 2 && x < w - 22) {
          const barNum = dbs
            ? Math.max(1, dbs.findIndex((d) => Math.abs(d - bt) < 0.06) + 1)
            : Math.floor(idx / 4) + 1;
          ctx.fillStyle = 'rgba(0, 229, 255, 0.88)';
          ctx.font = 'bold 9px monospace';
          ctx.fillText(`C${barNum}`, x + 3, 11);
          lastBarLabelX = x;
        }
      }
      ctx.lineWidth = 1;

      if (mem.chords?.length) {
        let lastChordX = -999;
        for (const ch of mem.chords) {
          const cx0 = secToX(ch.startSec);
          const cx1 = secToX(ch.endSec);
          if (cx1 < 0 || cx0 > w) continue;
          if (cx0 >= 0 && cx0 <= w) {
            ctx.strokeStyle = 'rgba(167, 139, 250, 0.5)';
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(cx0, 0);
            ctx.lineTo(cx0, h);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          if (cx0 - lastChordX >= 30 && cx1 - cx0 >= 18 && cx0 >= -4 && cx0 < w - 24) {
            const boxW = Math.min(48, Math.max(20, ch.chord.length * 7 + 8));
            ctx.fillStyle = 'rgba(109, 40, 217, 0.85)';
            ctx.fillRect(Math.max(2, cx0 + 2), 14, boxW, 13);
            ctx.fillStyle = '#EDE9FE';
            ctx.font = 'bold 9px monospace';
            ctx.fillText(ch.chord, Math.max(5, cx0 + 5), 24);
            lastChordX = cx0;
          }
        }
      }
    }

    // 2. Overlay Detected Drum Hits OR Detected Melodic/Polyphonic Notes!
    if (r.analysis) {
      if (r.analysis.mode === 'drums') {
        const colorMap: Record<DrumPieceRole, string> = {
          kick: '#FF6B00',
          snare: '#00E5FF',
          hat: '#F59E0B',
          tom: '#10B981',
        };
        for (const hit of r.analysis.drumHits) {
          if (hit.peakTimeSec < viewStartSec || hit.peakTimeSec > viewEndSec) continue;
          const x = secToX(hit.peakTimeSec);
          const barH = Math.max(12, hit.velocity * (h * 0.42));
          ctx.fillStyle = colorMap[hit.role];
          if (hit.role === 'kick') {
            ctx.fillRect(x - 1, h - barH - 4, 2.2, barH);
          } else if (hit.role === 'snare') {
            ctx.fillRect(x - 1, midY - barH * 0.6, 2.2, barH);
          } else if (hit.role === 'hat') {
            ctx.fillRect(x - 0.8, 4, 1.6, barH * 0.65);
          } else {
            ctx.fillRect(x - 1, midY, 2.2, barH * 0.7);
          }
        }
      } else {
        const minM = r.analysis.midiRange?.minMidi ?? 36;
        const maxM = Math.max(minM + 12, r.analysis.midiRange?.maxMidi ?? 72);
        const spanM = maxM - minM;
        for (const ev of r.analysis.noteEvents) {
          const evEnd = ev.startSec + ev.durationSec;
          if (evEnd < viewStartSec || ev.startSec > viewEndSec) continue;
          const x0 = Math.max(0, secToX(ev.startSec));
          const x1 = Math.min(w, secToX(evEnd));
          const bw = Math.max(3, x1 - x0);
          const normPitch = (ev.midiNote - minM) / spanM;
          const y = h - 18 - normPitch * (h - 32);

          ctx.fillStyle =
            ev.midiNote < 50
              ? 'rgba(255, 107, 0, 0.82)'
              : ev.midiNote < 64
              ? 'rgba(0, 229, 255, 0.82)'
              : 'rgba(16, 185, 129, 0.85)';
          ctx.fillRect(x0, y - 3, bw, 6);
        }
      }
    }

    // 3. Playhead
    if (r.currentTimeSec >= viewStartSec && r.currentTimeSec <= viewEndSec) {
      const px = secToX(r.currentTimeSec);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(px - 1, 0, 2, h);
    }
  }, [
    r.originalBuffer,
    r.waveformPyramid,
    r.importedMemory,
    r.analysis,
    r.currentTimeSec,
    r.abMode,
    showBeatGrid,
    duration,
    viewStartSec,
    viewEndSec,
    viewSpanSec,
  ]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || duration <= 0) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const norm = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    r.seekToSec(viewStartSec + norm * viewSpanSec);
  };

  const handleCanvasWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!r.originalBuffer || duration <= 0) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.3 : 0.77;
    const nextZoom = Math.max(1, Math.min(48, zoom * factor));
    const rect = e.currentTarget.getBoundingClientRect();
    const cursorNorm = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const cursorSec = viewStartSec + cursorNorm * viewSpanSec;
    const nextSpan = duration / nextZoom;
    const nextStart = Math.max(0, Math.min(duration - nextSpan, cursorSec - cursorNorm * nextSpan));
    setZoom(nextZoom);
    setScrollNorm(duration > 0 ? nextStart / duration : 0);
  };

  const renderCustomSourceControls = (
    target: DrumPieceRole | 'melodic',
    slot: typeof r.melodicSlot
  ) => {
    const isRec = r.recordingTarget === target;
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            uploadTargetRef.current = target;
            slotFileInputRef.current?.click();
          }}
          className="px-2.5 py-1 rounded-lg bg-[#00E5FF]/15 hover:bg-[#00E5FF]/25 border border-[#00E5FF]/55 text-[10px] font-mono font-bold text-[#00E5FF] flex items-center gap-1 cursor-pointer transition-all"
          title="Subir tu propio audio de reemplazo (WAV, MP3, FLAC, OGG, M4A)"
        >
          <Upload size={11} />
          <span>Subir Audio</span>
        </button>

        <button
          type="button"
          onClick={() => void r.toggleMicRecordingForSlot(target)}
          className={`px-2 py-1 rounded-lg border text-[10px] font-mono font-bold flex items-center gap-1 cursor-pointer transition-all ${
            isRec
              ? 'bg-rose-500 border-rose-400 text-white animate-pulse'
              : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-rose-300'
          }`}
          title="Grabar muestra directamente desde tu micrófono o interfaz"
        >
          {isRec ? <Square size={10} className="fill-current" /> : <Mic size={11} />}
          <span>{isRec ? 'Detener Mic' : 'Grabar Mic'}</span>
        </button>

        {loadedCreatorPads.length > 0 && getBufferForPad && (
          <select
            defaultValue=""
            onChange={(e) => {
              const pIdx = Number(e.target.value);
              const pad = padsFromCreator[pIdx];
              const buf = getBufferForPad(pIdx);
              if (pad && buf) {
                r.applyCustomBufferToSlot(target, buf, `Pad: ${pad.label}`, 'pad');
              }
              e.target.value = '';
            }}
            className="bg-slate-900 border border-slate-700 rounded-lg px-1.5 py-1 text-[10px] font-mono text-amber-300 cursor-pointer"
          >
            <option value="" disabled>
              Usar Pad...
            </option>
            {loadedCreatorPads.map((p) => (
              <option key={p.index} value={p.index}>
                Pad {p.index + 1}: {p.label}
              </option>
            ))}
          </select>
        )}

        {slot.sourceType !== 'preset' && (
          <>
            <label
              className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-[9.5px] font-mono text-emerald-300 cursor-pointer"
              title="Normalizar automáticamente tu muestra propia a -1.0 dBFS"
            >
              <input
                type="checkbox"
                checked={slot.normalizeCustom !== false}
                onChange={(e) => {
                  const nextNorm = e.target.checked;
                  if (target === 'melodic') {
                    r.updateMelodicSlot({ normalizeCustom: nextNorm });
                  } else {
                    r.updateDrumSlot(target, { normalizeCustom: nextNorm });
                  }
                }}
                className="accent-emerald-400"
              />
              <span>Norm</span>
            </label>
            <button
              type="button"
              onClick={() => {
                if (target === 'melodic') {
                  r.updateMelodicSlot({
                    sourceType: 'preset',
                    customSampleId: undefined,
                    customBuffer: undefined,
                    customName: undefined,
                  });
                } else {
                  r.updateDrumSlot(target, {
                    sourceType: 'preset',
                    customSampleId: undefined,
                    customBuffer: undefined,
                    customName: undefined,
                  });
                }
              }}
              className="px-1.5 py-1 rounded bg-slate-800 text-[10px] font-mono text-slate-400 hover:text-white cursor-pointer"
              title="Volver a muestra predeterminada de estudio"
            >
              Volver a Predet.
            </button>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3.5">
      <input
        ref={stemFileInputRef}
        type="file"
        accept=".wav,.mp3,.flac,.ogg,.m4a,.aac,.webm,.aiff,.aif,audio/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void r.loadLocalStemFile(f);
          e.target.value = '';
        }}
      />
      <input
        ref={slotFileInputRef}
        type="file"
        accept=".wav,.mp3,.flac,.ogg,.m4a,.aac,.webm,audio/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void r.loadCustomFileForSlot(uploadTargetRef.current, f);
          e.target.value = '';
        }}
      />
      <input
        ref={bankBatchFileInputRef}
        type="file"
        multiple
        accept=".wav,.mp3,.flac,.ogg,.m4a,.aac,.webm,audio/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            void r.uploadCustomReplacementFiles(
              e.target.files,
              r.stemMode === 'drums' ? 'auto' : 'melodic'
            );
            setShowCustomBank(true);
          }
          e.target.value = '';
        }}
      />

      {/* STEP 1: SONG FOLDER -> 1 STEM SELECTION */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        {/* Song Folder Selector */}
        <div className="lg:col-span-5 rounded-2xl bg-slate-900/95 border border-slate-800/90 p-3.5 flex flex-col gap-2.5 shadow-lg">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FolderOpen size={15} className="text-[#FF6B00]" />
              <span className="text-xs font-mono font-bold uppercase text-white">
                1. Elige Canción (Carpeta)
              </span>
            </div>
            <button
              type="button"
              onClick={() => void r.refreshSongs()}
              className="p-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-white cursor-pointer"
              title="Actualizar lista de canciones"
            >
              <RefreshCw size={12} className={r.loadingSongs ? 'animate-spin' : ''} />
            </button>
          </div>

          <input
            type="text"
            value={songSearch}
            onChange={(e) => setSongSearch(e.target.value)}
            placeholder="Buscar canción..."
            className="w-full px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-white focus:outline-none focus:border-[#00E5FF]"
          />

          <div className="max-h-40 overflow-y-auto studio-scrollbar-thin space-y-1 pr-1">
            {filteredSongs.length === 0 ? (
              <div className="text-[11px] font-mono text-slate-500 py-4 text-center">
                {r.loadingSongs
                  ? 'Cargando carpetas desde Supabase...'
                  : 'Sin canciones encontradas. Puedes cargar un stem local o usar una Demo.'}
              </div>
            ) : (
              filteredSongs.map((song) => {
                const active = song.id === r.selectedSongId;
                return (
                  <button
                    key={song.id}
                    type="button"
                    onClick={() => r.setSelectedSongId(song.id)}
                    className={`w-full px-2.5 py-1.5 rounded-xl border text-left font-mono text-xs flex items-center justify-between cursor-pointer transition-all ${
                      active
                        ? 'bg-[#FF6B00]/15 border-[#FF6B00] text-white font-bold'
                        : 'bg-slate-950/80 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <span className="truncate">{song.title}</span>
                    <span className="text-[10px] text-slate-400 shrink-0 ml-2">
                      {song.bpm ? `${song.bpm}bpm · ` : ''}
                      {song.stems.length} stems
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Single Stem Selector OR Direct PC Audio Upload (with Drag & Drop) */}
        <div
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) {
              e.preventDefault();
              setDragOverTarget('stem-local');
            }
          }}
          onDragLeave={() => setDragOverTarget((prev) => (prev === 'stem-local' ? null : prev))}
          onDrop={(e) => {
            const f = e.dataTransfer.files?.[0];
            setDragOverTarget(null);
            if (f) {
              e.preventDefault();
              void r.loadLocalStemFile(f);
            }
          }}
          className={`lg:col-span-7 rounded-2xl border p-3.5 flex flex-col justify-between gap-2.5 shadow-lg transition-all ${
            dragOverTarget === 'stem-local'
              ? 'bg-[#00E5FF]/10 border-[#00E5FF] shadow-[0_0_24px_rgba(0,229,255,0.22)]'
              : 'bg-slate-900/95 border-slate-800/90'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Layers size={15} className="text-[#00E5FF]" />
              <span className="text-xs font-mono font-bold uppercase text-white">
                2. Selecciona 1 Stem a Samplear{' '}
                {r.selectedSong ? `(${r.selectedSong.title})` : ''}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => stemFileInputRef.current?.click()}
                className="px-2.5 py-1 rounded-lg bg-[#00E5FF] hover:bg-cyan-300 text-slate-950 text-[11px] font-mono font-bold flex items-center gap-1 cursor-pointer"
                title="Sube un archivo WAV, MP3, FLAC, OGG o M4A directo desde tu PC para samplear y exportar"
              >
                <Upload size={12} />
                <span>Subir Archivo del PC</span>
              </button>
              <button
                type="button"
                onClick={() => void r.loadDemoStem('drums')}
                className="px-2 py-1 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[10px] font-mono text-[#FF6B00] cursor-pointer"
              >
                Demo Batería
              </button>
              <button
                type="button"
                onClick={() => void r.loadDemoStem('monophonic')}
                className="px-2 py-1 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[10px] font-mono text-emerald-400 cursor-pointer"
              >
                Demo Bajo
              </button>
              <button
                type="button"
                onClick={() => void r.loadDemoStem('polyphonic')}
                className="px-2 py-1 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[10px] font-mono text-[#00E5FF] cursor-pointer"
              >
                Demo Piano/Guitarra
              </button>
            </div>
          </div>

          {r.originalBuffer && !r.selectedStemId && (
            <div className="rounded-xl bg-[#00E5FF]/10 border border-[#00E5FF]/45 p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
              <div className="min-w-0">
                <div className="font-bold text-white truncate">
                  Archivo Local PC: {r.stemTitle || 'Audio cargado'}
                </div>
                <div className="text-[10px] text-[#00E5FF]">
                  {formatTime(r.originalBuffer.duration)} · {Math.round(r.originalBuffer.sampleRate / 1000)} kHz ·{' '}
                  {r.analysis ? `${r.analysis.bpm} BPM` : 'Analizando...'}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {onSendTo16Pads && (
                  <button
                    type="button"
                    onClick={() =>
                      onSendTo16Pads(
                        r.replacedBuffer ?? r.originalBuffer!,
                        r.stemTitle || 'Sample_PC',
                        r.importedMemory
                      )
                    }
                    className="px-2.5 py-1 rounded-lg bg-[#FF6B00] hover:brightness-110 text-slate-950 text-[10.5px] font-black cursor-pointer"
                    title="Abrir este audio en el Creador 16 Pads para cortar slices, aplicar efectos y exportar"
                  >
                    Cortar en 16 Pads →
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => stemFileInputRef.current?.click()}
                  className="px-2 py-1 rounded-lg bg-slate-950 border border-slate-700 text-[10.5px] text-slate-200 hover:text-white cursor-pointer"
                >
                  Cambiar Archivo
                </button>
              </div>
            </div>
          )}

          {r.selectedSong && r.selectedSong.stems.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-44 overflow-y-auto studio-scrollbar-thin pr-1">
              {r.selectedSong.stems.map((st) => {
                const isSelected = st.id === r.selectedStemId;
                return (
                  <button
                    key={st.id}
                    type="button"
                    disabled={r.isLoadingStem}
                    onClick={() => void r.loadSongStem(st, r.selectedSong ?? undefined)}
                    className={`p-2.5 rounded-xl border text-left font-mono transition-all cursor-pointer flex flex-col justify-between gap-1 disabled:opacity-50 ${
                      isSelected
                        ? 'bg-[#00E5FF]/15 border-[#00E5FF] text-white shadow-[0_0_16px_rgba(0,229,255,0.2)]'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-bold truncate">{st.name}</span>
                      {st.isMaster && (
                        <span className="text-[9px] px-1 rounded bg-amber-500/20 text-amber-300">
                          MASTER
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-slate-400">
                      <span>
                        {st.inferredMode === 'drums'
                          ? 'Golpes Batería'
                          : st.inferredMode === 'monophonic'
                          ? 'Notas Mono'
                          : 'Acordes Poli'}
                      </span>
                      {st.durationSec ? <span>{formatTime(st.durationSec)}</span> : null}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : !r.originalBuffer ? (
            <div className="rounded-xl bg-slate-950/70 border border-dashed border-slate-800 p-4 text-center text-xs font-mono text-slate-400">
              {r.isLoadingStem ? (
                <span className="inline-flex items-center gap-2 text-[#00E5FF]">
                  <Loader2 size={14} className="animate-spin" /> Decodificando audio del PC / stem...
                </span>
              ) : (
                'Arrastra un archivo de tu PC aquí, pulsa Subir Archivo del PC, o elige una canción a la izquierda.'
              )}
            </div>
          ) : null}
        </div>
      </div>

      {/* STATUS & PROGRESS BANNER */}
      {(r.statusMessage || r.isAnalyzing || r.isLoadingStem) && (
        <div className="rounded-xl bg-slate-900/90 border border-[#00E5FF]/35 px-3 py-2 text-xs font-mono text-[#00E5FF] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {(r.isAnalyzing || r.isLoadingStem || r.isRendering) && (
              <Loader2 size={14} className="animate-spin shrink-0" />
            )}
            <span>
              {r.isLoadingStem
                ? 'Cargando stem...'
                : r.isAnalyzing
                ? 'Analizando tempo y cada golpe/nota de toda la pista...'
                : r.statusMessage}
            </span>
          </div>
          {r.statusMessage && !r.isAnalyzing && (
            <button
              type="button"
              onClick={() => r.setStatusMessage(null)}
              className="text-slate-500 hover:text-white cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>
      )}

      {/* STORED PRE-IMPORT TEMPO & CHORDS MEMORY STRIP */}
      {r.importedMemory && (
        <div className="rounded-xl bg-slate-950/95 border border-violet-500/40 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono shadow-sm">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-violet-300 font-bold mr-1">
              Memoria Pre-Importación:{' '}
            </span>
            <span className="px-2 py-0.5 rounded bg-slate-900 border border-[#00E5FF]/45 text-[#00E5FF] font-bold">
              {r.importedMemory.bpm} BPM
            </span>{' '}
            <button
              type="button"
              onClick={() => void r.updateImportedTempo(r.importedMemory!.bpm * 0.5)}
              className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] text-slate-300 cursor-pointer"
              title="Mitad del tempo (÷2)"
            >
              ÷2
            </button>
            <button
              type="button"
              onClick={() => void r.updateImportedTempo(r.importedMemory!.bpm * 2)}
              className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] text-slate-300 cursor-pointer"
              title="Doble tempo (×2)"
            >
              ×2
            </button>{' '}
            <span className="px-2 py-0.5 rounded bg-slate-900 border border-emerald-500/45 text-emerald-300 font-bold">
              Tono:{' '}
              {!r.importedMemory.isTonal ||
              r.importedMemory.musicalKey.endsWith('m') ||
              r.importedMemory.musicalKey.toLowerCase().includes('major')
                ? r.importedMemory.musicalKey
                : `${r.importedMemory.musicalKey} major`}
            </span>{' '}
            {r.importedMemory.camelotKey && (
              <span className="px-2 py-0.5 rounded bg-slate-900 border border-amber-500/45 text-amber-300 font-bold">
                Camelot: {r.importedMemory.camelotKey}
              </span>
            )}{' '}
            {(r.importedMemory.downbeats?.length ?? 0) > 0 && (
              <span className="px-2 py-0.5 rounded bg-slate-900 border border-cyan-500/35 text-cyan-200 font-bold">
                Grilla: {r.importedMemory.downbeats!.length} comp.
              </span>
            )}{' '}
            {r.importedMemory.chords.length > 0 ? (
              <>
                <span className="text-slate-400 ml-1">Acordes: </span>
                {r.importedMemory.chords.slice(0, 16).map((ch) => (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => r.seekToSec(ch.startSec)}
                    className="px-2 py-0.5 rounded bg-violet-500/15 hover:bg-violet-500/35 border border-violet-500/50 text-violet-200 font-bold cursor-pointer transition-colors"
                    title={`Ir a ${ch.chord} (${ch.startSec.toFixed(2)}s–${ch.endSec.toFixed(2)}s · Sub ${ch.rootName})`}
                  >
                    {ch.chord}
                  </button>
                ))}
              </>
            ) : (
              <span className="text-slate-400">· {r.importedMemory.chordProgressionSummary}</span>
            )}
          </div>

          <div className="flex items-center gap-1.5 text-[10.5px]">
            <span className="text-slate-400">Cuantizar al Tempo:</span>
            <select
              value={r.quantizeMode}
              onChange={(e) =>
                void r.changeQuantizeModeAndReanalyze(
                  e.target.value as 'off' | 'soft' | 'grid-16' | 'grid-8'
                )
              }
              className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-0.5 text-[#00E5FF] font-bold cursor-pointer"
              title="Alinea el sampleo de golpes/notas al tempo y fase detectados en memoria"
            >
              <option value="soft">Suave (Auto-Sync)</option>
              <option value="grid-16">Rejilla 1/16</option>
              <option value="grid-8">Rejilla 1/8</option>
              <option value="off">Libre (Sin Snap)</option>
            </select>
          </div>
        </div>
      )}

      {/* STEP 2: FULL-STEM ANALYSIS CONTROLS + WAVEFORM & MARKERS + A/B TRANSPORT */}
      <div className="rounded-2xl bg-slate-900/95 border border-slate-800/90 p-3.5 shadow-[0_14px_40px_rgba(0,0,0,0.65)] flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
          <div className="flex flex-wrap items-center gap-1.5">
            {MODE_LABELS.map((m) => {
              const active = r.stemMode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => void r.changeStemModeAndReanalyze(m.id)}
                  className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-mono font-bold cursor-pointer transition-all ${
                    active
                      ? 'bg-[#FF6B00] border-[#FF6B00] text-slate-950'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:text-white'
                  }`}
                  title={m.hint}
                >
                  {m.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
            <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1">
              <span className="text-slate-400">Sensibilidad:</span>
              <input
                type="range"
                min={0.2}
                max={0.95}
                step={0.05}
                value={r.sensitivity}
                onChange={(e) => r.setSensitivity(Number(e.target.value))}
                className="w-16 accent-[#FF6B00] h-1 cursor-pointer"
              />
              <span className="text-[#FF6B00]">{Math.round(r.sensitivity * 100)}%</span>
            </div>

            {r.stemMode === 'polyphonic' && (
              <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-xl px-2 py-1">
                <span className="text-slate-400">Polifonía máx:</span>
                <select
                  value={r.maxPolyphony}
                  onChange={(e) => r.setMaxPolyphony(Number(e.target.value))}
                  className="bg-transparent text-white font-bold focus:outline-none"
                >
                  {[2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n} className="bg-slate-950">
                      {n} notas
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowBeatGrid((v) => !v)}
              className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-bold cursor-pointer transition-all ${
                showBeatGrid
                  ? 'bg-[#00E5FF]/15 border-[#00E5FF]/60 text-[#00E5FF]'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
              }`}
              title="Mostrar/ocultar grilla musical de compases, pulsos y acordes sobre la forma de onda"
            >
              Grilla {showBeatGrid ? 'ON' : 'OFF'}
            </button>

            <button
              type="button"
              disabled={!r.originalBuffer || r.isAnalyzing}
              onClick={() => void r.reanalyzeCurrentStem()}
              className="px-2.5 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-[#00E5FF]/50 text-[#00E5FF] font-bold flex items-center gap-1 cursor-pointer disabled:opacity-40"
            >
              <Activity size={12} />
              <span>Re-Analizar</span>
            </button>
          </div>
        </div>

        {/* Interactive Waveform & Detected Hits/Notes Overlay */}
        <div className="relative w-full h-44 rounded-xl overflow-hidden border border-slate-800 bg-[#040711]">
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            onWheel={handleCanvasWheel}
            className="w-full h-full block cursor-pointer"
            title="Haz clic para saltar al segundo exacto · Rueda del ratón para Zoom"
          />
          {r.analysis && (
            <div className="absolute top-2 right-2 flex flex-wrap gap-1.5 pointer-events-none text-[10px] font-mono">
              <span className="px-2 py-0.5 rounded bg-slate-950/90 border border-slate-700 text-white font-bold">
                {r.analysis.bpm} BPM · {r.analysis.durationSec.toFixed(2)}s
              </span>
              {r.analysis.mode === 'drums' ? (
                <>
                  <span className="px-1.5 py-0.5 rounded bg-slate-950/90 border border-[#FF6B00]/50 text-[#FF6B00]">
                    K: {r.analysis.counts.kick}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-950/90 border border-[#00E5FF]/50 text-[#00E5FF]">
                    S: {r.analysis.counts.snare}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-950/90 border border-amber-500/50 text-amber-400">
                    H: {r.analysis.counts.hat}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-950/90 border border-emerald-500/50 text-emerald-400">
                    T: {r.analysis.counts.tom}
                  </span>
                </>
              ) : (
                <span className="px-2 py-0.5 rounded bg-slate-950/90 border border-emerald-500/50 text-emerald-300">
                  {r.analysis.counts.notes} notas{' '}
                  {r.analysis.midiRange
                    ? `(${r.analysis.midiRange.minName}–${r.analysis.midiRange.maxName})`
                    : ''}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Horizontal Timeline Scrollbar + Pan Navigator */}
        {duration > 0 && (
          <div className="flex items-center gap-2 bg-slate-950/90 border border-slate-800 rounded-xl px-2.5 py-1.5 text-[10px] font-mono">
            <button
              type="button"
              disabled={zoom <= 1.01}
              onClick={() => setScrollNorm((s) => Math.max(0, s - 0.12 / zoom))}
              className="p-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300 hover:text-white cursor-pointer disabled:opacity-35"
              title="Desplazar vista a la izquierda"
            >
              <ChevronLeft size={12} />
            </button>
            <input
              type="range"
              min={0}
              max={Math.max(0.001, 1 - 1 / zoom)}
              step={0.001}
              disabled={zoom <= 1.01}
              value={Math.min(scrollNorm, Math.max(0, 1 - 1 / zoom))}
              onChange={(e) => setScrollNorm(Number(e.target.value))}
              className="flex-1 accent-[#00E5FF] h-2 bg-slate-800 rounded-full cursor-pointer disabled:opacity-40"
              title="Barra de desplazamiento horizontal de la onda"
            />
            <button
              type="button"
              disabled={zoom <= 1.01}
              onClick={() =>
                setScrollNorm((s) => Math.min(Math.max(0, 1 - 1 / zoom), s + 0.12 / zoom))
              }
              className="p-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300 hover:text-white cursor-pointer disabled:opacity-35"
              title="Desplazar vista a la derecha"
            >
              <ChevronRight size={12} />
            </button>
            <span className="text-slate-400 shrink-0 tabular-nums">
              {formatTime(viewStartSec)}–{formatTime(Math.min(duration, viewEndSec))}
            </span>
          </div>
        )}

        {/* Playback Transport + Phase-Locked A/B Comparison + Zoom */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!r.originalBuffer}
              onClick={r.togglePlayback}
              className={`px-3.5 py-1.5 rounded-xl font-mono text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-40 ${
                r.isPlaying
                  ? 'bg-[#FF6B00] text-slate-950'
                  : 'bg-slate-950 hover:bg-slate-800 border border-[#FF6B00]/60 text-[#FF6B00]'
              }`}
            >
              {r.isPlaying ? (
                <Pause size={13} className="fill-current" />
              ) : (
                <Play size={13} className="fill-current" />
              )}
              <span>{r.isPlaying ? 'Detener' : 'Escuchar Pista'}</span>
            </button>

            <span className="text-xs font-mono text-slate-300 px-2 py-1 rounded bg-slate-950 border border-slate-800">
              {formatTime(r.currentTimeSec)} / {formatTime(duration)}
            </span>

            {/* Real-time A/B Toggle */}
            <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl p-0.5 text-xs font-mono">
              <button
                type="button"
                onClick={() => r.setAbMode('original')}
                className={`px-3 py-1 rounded-lg font-bold cursor-pointer transition-colors ${
                  r.abMode === 'original'
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                A: Stem Original
              </button>
              <button
                type="button"
                onClick={() => r.setAbMode('replaced')}
                className={`px-3 py-1 rounded-lg font-bold cursor-pointer transition-colors flex items-center gap-1 ${
                  r.abMode === 'replaced'
                    ? 'bg-gradient-to-r from-[#FF6B00] to-[#00E5FF] text-slate-950'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Sparkles size={11} />
                <span>B: Sampleado Mejorado</span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-lg p-1 text-xs font-mono">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(1, z / 1.5))}
              className="p-1 text-slate-400 hover:text-white cursor-pointer"
              title="Alejar zoom"
            >
              <ZoomOut size={13} />
            </button>
            <span className="px-1.5 text-[#00E5FF]">{zoom.toFixed(1)}x</span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(48, z * 1.5))}
              className="p-1 text-slate-400 hover:text-white cursor-pointer"
              title="Acercar zoom"
            >
              <ZoomIn size={13} />
            </button>
            {zoom > 1.05 && (
              <button
                type="button"
                onClick={() => {
                  setZoom(1);
                  setScrollNorm(0);
                }}
                className="px-1.5 py-0.5 rounded bg-slate-900 text-[10px] text-slate-300 hover:text-white cursor-pointer"
                title="Restablecer zoom 1x"
              >
                1x
              </button>
            )}
          </div>
        </div>
      </div>

      {/* STEP 3 & 4: REPLACEMENT SAMPLE SLOTS + MIX & SUPABASE SAVE */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3.5">
        {/* Replacement Sample Selector (Drums 4 Slots OR Guitar/Piano/Bass Slot) */}
        <div className="xl:col-span-8 rounded-2xl bg-slate-900/95 border border-slate-800/90 p-4 shadow-lg flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
            <div className="flex items-center gap-2">
              {r.stemMode === 'drums' ? (
                <Disc3 size={16} className="text-[#FF6B00]" />
              ) : (
                <Guitar size={16} className="text-[#00E5FF]" />
              )}
              <h3 className="text-xs font-mono font-bold uppercase text-white">
                {r.stemMode === 'drums'
                  ? '3. Elige o Sube Tus Muestras de Reemplazo por Pieza'
                  : '3. Elige o Sube Tu Propio Instrumento / Muestra para Reemplazar Conservando Notas'}
              </h3>
            </div>

            {/* Professional Custom Sample Upload & Library Action Bar */}
            <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] font-mono">
              <button
                type="button"
                onClick={() => bankBatchFileInputRef.current?.click()}
                className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-[#00E5FF] to-emerald-400 hover:brightness-110 text-slate-950 font-black flex items-center gap-1.5 cursor-pointer shadow-sm"
                title="Sube 1 o varios audios propios (WAV, MP3, FLAC, OGG, M4A) a tu Banco y asígnalos automáticamente"
              >
                <Upload size={12} />
                <span>Subir Audios Propios</span>
              </button>

              <button
                type="button"
                onClick={() => setShowCustomBank((v) => !v)}
                className={`px-2.5 py-1.5 rounded-xl border font-bold flex items-center gap-1.5 cursor-pointer transition-all ${
                  showCustomBank
                    ? 'bg-[#FF6B00]/15 border-[#FF6B00] text-[#FF6B00]'
                    : 'bg-slate-950 border-slate-700 text-slate-200 hover:border-[#00E5FF]/50'
                }`}
              >
                <FolderArchive size={12} />
                <span>Mi Banco ({r.customSamples.length})</span>
              </button>

              {r.songs.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowCloudSamplePicker((v) => !v)}
                  className={`px-2.5 py-1.5 rounded-xl border font-bold flex items-center gap-1 cursor-pointer transition-all ${
                    showCloudSamplePicker
                      ? 'bg-[#00E5FF]/15 border-[#00E5FF] text-[#00E5FF]'
                      : 'bg-slate-950 border-slate-700 text-slate-300 hover:text-white'
                  }`}
                  title="Importar una muestra o stem desde tus carpetas de Supabase como audio de reemplazo"
                >
                  <FolderOpen size={12} />
                  <span>Desde Nube</span>
                </button>
              )}

              {(r.melodicSlot.sourceType !== 'preset' ||
                Object.values(r.drumSlots).some((s) => s.sourceType !== 'preset')) && (
                <button
                  type="button"
                  onClick={r.resetAllSlotsToPresets}
                  className="px-2 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-400 hover:text-white cursor-pointer"
                  title="Volver todas las piezas a muestras predeterminadas de estudio"
                >
                  Restablecer Predet.
                </button>
              )}
            </div>
          </div>

          {/* Cloud Song Stem -> Custom Sample Quick Importer */}
          {showCloudSamplePicker && (
            <div className="rounded-xl bg-slate-950 border border-[#00E5FF]/40 p-3 flex flex-col gap-2 text-xs font-mono">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[#00E5FF] font-bold">
                  Importar Audio de Reemplazo desde Tus Canciones (Supabase)
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400">Asignar a:</span>
                  <select
                    value={cloudTargetRole}
                    onChange={(e) => setCloudTargetRole(e.target.value as CustomSampleCategory)}
                    className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-white"
                  >
                    <option value="kick">Kick (Bombo)</option>
                    <option value="snare">Snare (Caja)</option>
                    <option value="hat">Hi-Hat / Platos</option>
                    <option value="tom">Tom / Perc</option>
                    <option value="melodic">Instrumento Melódico / Acordes</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowCloudSamplePicker(false)}
                    className="text-slate-400 hover:text-white cursor-pointer"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              <div className="max-h-36 overflow-y-auto studio-scrollbar-thin grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 pr-1">
                {r.songs.flatMap((song) =>
                  song.stems.map((st) => (
                    <button
                      key={`${song.id}-${st.id}`}
                      type="button"
                      onClick={() => {
                        void r.importCustomSampleFromUrl(
                          st.fileUrl,
                          `${song.title} · ${st.name}`,
                          cloudTargetRole
                        );
                        setShowCloudSamplePicker(false);
                        setShowCustomBank(true);
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-[#00E5FF] text-left flex items-center justify-between gap-1 cursor-pointer"
                    >
                      <span className="truncate text-[10.5px] text-slate-200">
                        {song.title} · {st.name}
                      </span>
                      <Upload size={11} className="text-[#00E5FF] shrink-0" />
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Persistent User Custom Replacement Sample Bank */}
          {showCustomBank && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverTarget('bank');
              }}
              onDragLeave={() => setDragOverTarget(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverTarget(null);
                if (e.dataTransfer.files?.length) {
                  void r.uploadCustomReplacementFiles(
                    e.dataTransfer.files,
                    r.stemMode === 'drums' ? 'auto' : 'melodic'
                  );
                }
              }}
              className={`rounded-xl border p-3 flex flex-col gap-2.5 text-xs font-mono transition-all ${
                dragOverTarget === 'bank'
                  ? 'bg-[#00E5FF]/10 border-[#00E5FF]'
                  : 'bg-slate-950/90 border-slate-800'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FolderArchive size={14} className="text-[#FF6B00]" />
                  <span className="font-bold text-white text-[11px]">
                    BANCO DE TUS AUDIOS DE REEMPLAZO ({r.customSamples.length})
                  </span>
                  <span className="text-[10px] text-slate-400 hidden sm:inline">
                    · Arrastra archivos WAV/MP3/FLAC aquí o asígnalos directo a cualquier pieza
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => bankBatchFileInputRef.current?.click()}
                  className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-[#00E5FF]/50 text-[#00E5FF] text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Upload size={11} />
                  <span>+ Añadir Más Audios</span>
                </button>
              </div>

              {r.customSamples.length === 0 ? (
                <div className="py-3 text-center text-[11px] text-slate-400 border border-dashed border-slate-800 rounded-lg">
                  Aún no has subido muestras propias. Pulsa{' '}
                  <span className="text-[#00E5FF] font-bold">Subir Audios Propios</span> o arrastra tus WAVs aquí.
                </div>
              ) : (
                <div className="max-h-48 overflow-y-auto studio-scrollbar-thin space-y-1.5 pr-1">
                  {r.customSamples.map((sample) => {
                    const badge = CATEGORY_BADGES[sample.category];
                    return (
                      <div
                        key={sample.id}
                        className="rounded-lg bg-slate-900/90 border border-slate-800 px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-2"
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => r.auditionCustomSample(sample.id)}
                            className="p-1.5 rounded-lg bg-slate-950 hover:bg-[#00E5FF] text-[#00E5FF] hover:text-slate-950 border border-slate-700 cursor-pointer shrink-0 transition-colors"
                            title="Escuchar muestra"
                          >
                            <Play size={10} className="fill-current" />
                          </button>

                          {/* Mini Peak Waveform Preview */}
                          <div className="hidden sm:flex items-center gap-[1.5px] h-5 w-16 shrink-0 bg-slate-950 rounded px-1 border border-slate-800/80">
                            {(sample.waveformPreview || []).slice(0, 18).map((pk, idx) => (
                              <span
                                key={idx}
                                className="w-[2px] rounded-full bg-[#00E5FF]/80"
                                style={{ height: `${Math.max(15, Math.round(pk * 100))}%` }}
                              />
                            ))}
                          </div>

                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span
                                className="text-[9px] px-1.5 py-0.2 rounded font-bold text-slate-950 shrink-0"
                                style={{ backgroundColor: badge.color }}
                              >
                                {badge.label}
                              </span>
                              <span className="text-[11px] font-bold text-white truncate">
                                {sample.name}
                              </span>
                            </div>
                            <div className="text-[9.5px] text-slate-400">
                              {sample.durationSec.toFixed(2)}s · Pico{' '}
                              {(sample.peakOffsetSec * 1000).toFixed(1)}ms · Root{' '}
                              {sample.detectedNoteName}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1 shrink-0">
                          {r.stemMode === 'drums' ? (
                            DRUM_ROLES.map(({ role, label, color }) => {
                              const isAssigned =
                                r.drumSlots[role].sourceType !== 'preset' &&
                                r.drumSlots[role].customSampleId === sample.id;
                              return (
                                <button
                                  key={role}
                                  type="button"
                                  onClick={() => r.assignCustomSampleToSlot(sample.id, role)}
                                  style={
                                    isAssigned
                                      ? { backgroundColor: color, borderColor: color, color: '#020617' }
                                      : undefined
                                  }
                                  className={`px-1.5 py-0.5 rounded border text-[9.5px] font-bold cursor-pointer transition-all ${
                                    isAssigned
                                      ? ''
                                      : 'bg-slate-950 border-slate-700 text-slate-300 hover:border-[#00E5FF] hover:text-white'
                                  }`}
                                  title={`Usar en ${label}`}
                                >
                                  {role.toUpperCase()}
                                </button>
                              );
                            })
                          ) : (
                            <button
                              type="button"
                              onClick={() => r.assignCustomSampleToSlot(sample.id, 'melodic')}
                              className={`px-2 py-1 rounded border text-[10px] font-bold cursor-pointer ${
                                r.melodicSlot.sourceType !== 'preset' &&
                                r.melodicSlot.customSampleId === sample.id
                                  ? 'bg-[#00E5FF] border-[#00E5FF] text-slate-950'
                                  : 'bg-slate-950 border-slate-700 text-[#00E5FF] hover:bg-[#00E5FF]/15'
                              }`}
                            >
                              {r.melodicSlot.sourceType !== 'preset' &&
                              r.melodicSlot.customSampleId === sample.id
                                ? '✓ Activo en Pista'
                                : 'Usar en Pista'}
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => r.deleteCustomSample(sample.id)}
                            className="p-1 rounded bg-slate-950 border border-slate-800 text-slate-500 hover:text-rose-400 hover:border-rose-500/40 cursor-pointer"
                            title="Eliminar del banco"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {r.stemMode === 'drums' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {DRUM_ROLES.map(({ role, label, color }) => {
                const slot = r.drumSlots[role];
                const presets = DRUM_PRESET_CATALOG.filter((p) => p.category === role);
                const hitCount = r.analysis?.counts[role] ?? 0;
                const isDragOver = dragOverTarget === role;
                const selectVal =
                  slot.sourceType !== 'preset' && slot.customSampleId
                    ? `custom:${slot.customSampleId}`
                    : slot.presetId;

                return (
                  <div
                    key={role}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverTarget(role);
                    }}
                    onDragLeave={() => setDragOverTarget(null)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOverTarget(null);
                      const f = e.dataTransfer.files?.[0];
                      if (f) void r.loadCustomFileForSlot(role, f);
                    }}
                    className={`rounded-xl bg-slate-950/90 border p-3 flex flex-col gap-2.5 text-xs font-mono transition-all ${
                      isDragOver
                        ? 'border-[#00E5FF] bg-[#00E5FF]/10 shadow-[0_0_20px_rgba(0,229,255,0.22)]'
                        : slot.enabled
                        ? 'border-slate-700'
                        : 'border-slate-800/60 opacity-55'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <label className="flex items-center gap-2 cursor-pointer font-bold text-white">
                        <input
                          type="checkbox"
                          checked={slot.enabled}
                          onChange={(e) => r.updateDrumSlot(role, { enabled: e.target.checked })}
                          className="accent-[#FF6B00]"
                        />
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: color }}
                        />
                        <span>{label}</span>
                      </label>

                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-slate-400">{hitCount} hits</span>
                        <button
                          type="button"
                          onClick={() => r.auditionSlotSample(slot)}
                          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[#00E5FF] text-[10px] flex items-center gap-1 cursor-pointer"
                        >
                          <Volume2 size={10} />
                          Probar
                        </button>
                      </div>
                    </div>

                    {/* Unified selector: User's Uploaded Custom Samples + Studio Presets */}
                    <select
                      value={selectVal}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val.startsWith('custom:')) {
                          r.assignCustomSampleToSlot(val.slice(7), role);
                        } else {
                          r.updateDrumSlot(role, {
                            sourceType: 'preset',
                            presetId: val as DefaultInstrumentId,
                            customSampleId: undefined,
                            customBuffer: undefined,
                            customName: undefined,
                          });
                        }
                      }}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white cursor-pointer"
                    >
                      {r.customSamples.length > 0 && (
                        <optgroup label="★ Mis Audios Propios Subidos">
                          {r.customSamples.map((cs) => (
                            <option key={cs.id} value={`custom:${cs.id}`}>
                              ★ {cs.name} ({cs.durationSec.toFixed(2)}s)
                            </option>
                          ))}
                        </optgroup>
                      )}
                      <optgroup label="Estudio Predeterminados">
                        {presets.map((pr) => (
                          <option key={pr.id} value={pr.id}>
                            {pr.label}
                          </option>
                        ))}
                      </optgroup>
                    </select>

                    {slot.sourceType !== 'preset' && (
                      <div className="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[10px] flex items-center justify-between gap-2">
                        <span className="truncate">
                          Audio Propio: {slot.customName}
                        </span>
                        <span className="text-[9.5px] text-emerald-200/80 shrink-0">
                          Pico {((slot.customPeakOffsetSec ?? 0) * 1000).toFixed(1)}ms
                        </span>
                      </div>
                    )}

                    {renderCustomSourceControls(role, slot)}

                    <div className="grid grid-cols-2 gap-2 pt-1 text-[10px] text-slate-400">
                      <div>
                        <div className="flex justify-between">
                          <span>Nivel</span>
                          <span className="text-white">
                            {slot.gainDb > 0 ? '+' : ''}
                            {slot.gainDb}dB
                          </span>
                        </div>
                        <input
                          type="range"
                          min={-18}
                          max={12}
                          step={0.5}
                          value={slot.gainDb}
                          onChange={(e) =>
                            r.updateDrumSlot(role, { gainDb: Number(e.target.value) })
                          }
                          className="w-full accent-[#FF6B00] h-1 cursor-pointer"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between">
                          <span>Afinación</span>
                          <span className="text-white">
                            {slot.pitchSemis > 0 ? '+' : ''}
                            {slot.pitchSemis} st
                          </span>
                        </div>
                        <input
                          type="range"
                          min={-12}
                          max={12}
                          step={1}
                          value={slot.pitchSemis}
                          onChange={(e) =>
                            r.updateDrumSlot(role, { pitchSemis: Number(e.target.value) })
                          }
                          className="w-full accent-[#00E5FF] h-1 cursor-pointer"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverTarget('melodic');
              }}
              onDragLeave={() => setDragOverTarget(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverTarget(null);
                const f = e.dataTransfer.files?.[0];
                if (f) void r.loadCustomFileForSlot('melodic', f);
              }}
              className={`rounded-xl bg-slate-950/90 border p-3.5 flex flex-col gap-3 text-xs font-mono transition-all ${
                dragOverTarget === 'melodic'
                  ? 'border-[#00E5FF] bg-[#00E5FF]/10'
                  : 'border-slate-800'
              }`}
            >
              {/* Top Custom Upload / Selection Card for Melodic & Polyphonic */}
              <div className="rounded-xl bg-slate-900/90 border border-slate-700/80 p-3 flex flex-col gap-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Music2 size={14} className="text-[#00E5FF]" />
                    <span className="font-bold text-white">
                      Tu Audio Propio o Timbre de Estudio (Se transpone a cada nota)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => r.auditionSlotSample(r.melodicSlot)}
                    className="px-2.5 py-1 rounded-lg bg-[#00E5FF]/15 border border-[#00E5FF]/50 text-[#00E5FF] text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <Volume2 size={12} />
                    <span>
                      {r.melodicSlot.sourceType === 'preset' &&
                      isBassPresetId(r.melodicSlot.presetId)
                        ? 'Probar Muestra (C2 Bass)'
                        : 'Probar Muestra (C4)'}
                    </span>
                  </button>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  {renderCustomSourceControls('melodic', r.melodicSlot)}

                  {r.customSamples.length > 0 && (
                    <select
                      value={
                        r.melodicSlot.sourceType !== 'preset' && r.melodicSlot.customSampleId
                          ? r.melodicSlot.customSampleId
                          : ''
                      }
                      onChange={(e) => {
                        if (e.target.value) {
                          r.assignCustomSampleToSlot(e.target.value, 'melodic');
                        }
                      }}
                      className="bg-slate-950 border border-[#00E5FF]/40 rounded-lg px-2 py-1 text-[11px] text-white cursor-pointer max-w-[240px]"
                    >
                      <option value="" disabled>
                        Elegir de Mis Audios ({r.customSamples.length})...
                      </option>
                      {r.customSamples.map((cs) => (
                        <option key={cs.id} value={cs.id}>
                          ★ {cs.name} (Root {cs.detectedNoteName})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {r.melodicSlot.sourceType === 'preset' ? (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-1.5 text-[10px]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {(
                        [
                          { id: 'all', label: `Todos (${MELODIC_PRESET_CATALOG.length})` },
                          { id: 'bass', label: `Bajos Synth & Sub (${BASS_PRESET_CATALOG.length})` },
                          {
                            id: 'keys-guitar',
                            label: `Piano / Guitarra / Synth (${
                              MELODIC_PRESET_CATALOG.length - BASS_PRESET_CATALOG.length
                            })`,
                          },
                        ] as const
                      ).map((cat) => (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => setMelodicCategoryFilter(cat.id)}
                          className={`px-2.5 py-1 rounded-lg border font-bold cursor-pointer transition-all ${
                            melodicCategoryFilter === cat.id
                              ? 'bg-[#00E5FF] border-[#00E5FF] text-slate-950'
                              : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-600'
                          }`}
                        >
                          {cat.label}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={r.toggleBassFocusMode}
                      className={`px-2.5 py-1 rounded-lg border font-bold cursor-pointer transition-all ${
                        r.bassFocusMode
                          ? 'bg-[#FF6B00] border-[#FF6B00] text-slate-950 shadow-[0_0_12px_rgba(255,107,0,0.3)]'
                          : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-[#FF6B00]/50'
                      }`}
                      title="Extrae únicamente los graves (30–210 Hz) y la nota raíz de la progresión de acordes para dar peso sin tocar notas agudas"
                    >
                      {r.bassFocusMode ? '● Solo Graves / Progresión: ON' : 'Solo Graves / Progresión: OFF'}
                    </button>
                  </div>

                  {r.bassFocusMode && (
                    <div className="px-2.5 py-1.5 rounded-lg bg-[#FF6B00]/10 border border-[#FF6B00]/40 text-[10px] text-amber-200 flex flex-wrap items-center justify-between gap-2">
                      <span>
                        <strong className="text-[#FF6B00]">Modo Solo Graves Activo:</strong>{' '}
                        Analizando los bajos y la raíz armónica de los acordes de tu audio para sumar peso subgrave sin invadir medios/agudos.
                      </span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-64 overflow-y-auto studio-scrollbar-thin pr-1">
                    {MELODIC_PRESET_CATALOG.filter((pr) =>
                      melodicCategoryFilter === 'all' ? true : pr.group === melodicCategoryFilter
                    ).map((pr) => {
                      const active = r.melodicSlot.presetId === pr.id;
                      const isBass = pr.group === 'bass';
                      return (
                        <button
                          key={pr.id}
                          type="button"
                          onClick={() =>
                            r.updateMelodicSlot({ presetId: pr.id, sourceType: 'preset' })
                          }
                          className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                            active
                              ? 'bg-[#00E5FF]/15 border-[#00E5FF] text-white shadow-[0_0_14px_rgba(0,229,255,0.18)]'
                              : 'bg-slate-900/80 border-slate-800 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <div className="font-bold text-xs truncate">{pr.label}</div>
                            {pr.badge && (
                              <span
                                className={`px-1.5 py-0.5 rounded text-[9px] font-black shrink-0 ${
                                  isBass
                                    ? 'bg-[#FF6B00]/20 text-[#FF6B00] border border-[#FF6B00]/40'
                                    : 'bg-slate-800 text-[#00E5FF] border border-slate-700'
                                }`}
                              >
                                {pr.badge}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-1 leading-snug">
                            {pr.description}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl bg-emerald-500/15 border border-emerald-500/40 p-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-bold text-emerald-300">
                      Muestra Propia Activa: {r.melodicSlot.customName}
                    </div>
                    <div className="text-[10px] text-slate-300">
                      Nota raíz detectada (YIN):{' '}
                      {midiNoteToName(r.melodicSlot.customRootMidi ?? 60)} — Loop sustain cruzado sin clics:
                    </div>
                  </div>
                  <select
                    value={r.melodicSlot.customRootMidi ?? 60}
                    onChange={(e) =>
                      r.updateMelodicSlot({ customRootMidi: Number(e.target.value) })
                    }
                    className="bg-slate-900 border border-emerald-500/50 rounded-lg px-2 py-1 text-xs text-white"
                  >
                    {Array.from({ length: 49 }, (_, idx) => 36 + idx).map((m) => (
                      <option key={m} value={m}>
                        Root {midiNoteToName(m)} (MIDI {m})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1 text-[10.5px] text-slate-400">
                <div>
                  <div className="flex justify-between">
                    <span>Nivel Muestra</span>
                    <span className="text-white">{r.melodicSlot.gainDb} dB</span>
                  </div>
                  <input
                    type="range"
                    min={-18}
                    max={12}
                    step={0.5}
                    value={r.melodicSlot.gainDb}
                    onChange={(e) =>
                      r.updateMelodicSlot({ gainDb: Number(e.target.value) })
                    }
                    className="w-full accent-[#00E5FF] h-1 cursor-pointer"
                  />
                </div>
                <div>
                  <div className="flex justify-between">
                    <span>Octava / Tono</span>
                    <span className="text-[#FF6B00]">
                      {r.melodicSlot.pitchSemis > 0 ? '+' : ''}
                      {r.melodicSlot.pitchSemis} st
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-12}
                    max={12}
                    step={1}
                    value={r.melodicSlot.pitchSemis}
                    onChange={(e) =>
                      r.updateMelodicSlot({ pitchSemis: Number(e.target.value) })
                    }
                    className="w-full accent-[#FF6B00] h-1 cursor-pointer"
                  />
                </div>
                <div>
                  <div className="flex justify-between">
                    <span>Sustain Notas</span>
                    <span className="text-emerald-400">{r.mixOptions.sustainScale.toFixed(1)}x</span>
                  </div>
                  <input
                    type="range"
                    min={0.6}
                    max={1.8}
                    step={0.1}
                    value={r.mixOptions.sustainScale}
                    onChange={(e) =>
                      r.setMixOptions((p) => ({ ...p, sustainScale: Number(e.target.value) }))
                    }
                    className="w-full accent-emerald-400 h-1 cursor-pointer"
                  />
                </div>
                <div>
                  <div className="flex justify-between">
                    <span>Brillo Timbre</span>
                    <span className="text-white">{r.mixOptions.brightnessPct}%</span>
                  </div>
                  <input
                    type="range"
                    min={-50}
                    max={50}
                    step={5}
                    value={r.mixOptions.brightnessPct}
                    onChange={(e) =>
                      r.setMixOptions((p) => ({ ...p, brightnessPct: Number(e.target.value) }))
                    }
                    className="w-full accent-[#00E5FF] h-1 cursor-pointer"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Live Preview of Detected Notes/Chords */}
          {r.analysis && r.analysis.noteEvents.length > 0 && (
            <div className="rounded-xl bg-slate-950 border border-slate-800 p-2.5 max-h-24 overflow-y-auto studio-scrollbar-thin flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
              <span className="text-slate-500 mr-1">
                Primeras notas detectadas
                {r.analysis.bassFocusApplied ? ' (Solo Graves / Progresión)' : ''}:
              </span>
              {r.analysis.noteEvents.slice(0, 64).map((ev) => (
                <span
                  key={ev.id}
                  onClick={() => r.seekToSec(ev.startSec)}
                  className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-[#00E5FF] cursor-pointer hover:border-[#FF6B00]"
                  title={`${ev.startSec.toFixed(2)}s · duración ${ev.durationSec.toFixed(2)}s`}
                >
                  {ev.noteName} ({ev.startSec.toFixed(1)}s)
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Blend, Export & Save Directly Back to Song Folder */}
        <div className="xl:col-span-4 rounded-2xl bg-slate-900/95 border border-slate-800/90 p-4 shadow-lg flex flex-col justify-between gap-3 text-xs font-mono">
          <div className="space-y-3">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
              <Sliders size={15} className="text-emerald-400" />
              <h3 className="font-bold uppercase text-white">
                4. Mezcla & Guardar en Canción
              </h3>
            </div>

            <div>
              <div className="flex justify-between text-[11px] text-slate-300">
                <span>Muestra Reemplazada</span>
                <span className="text-[#00E5FF] font-bold">{r.mixOptions.replacementPct}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={130}
                step={5}
                value={r.mixOptions.replacementPct}
                onChange={(e) =>
                  r.setMixOptions((p) => ({ ...p, replacementPct: Number(e.target.value) }))
                }
                className="w-full accent-[#00E5FF] h-1.5 bg-slate-800 rounded cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-[11px] text-slate-300">
                <span>Stem Original (Blend)</span>
                <span className="text-[#FF6B00] font-bold">{r.mixOptions.originalPct}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={r.mixOptions.originalPct}
                onChange={(e) =>
                  r.setMixOptions((p) => ({ ...p, originalPct: Number(e.target.value) }))
                }
                className="w-full accent-[#FF6B00] h-1.5 bg-slate-800 rounded cursor-pointer"
              />
            </div>

            {(r.stemMode === 'monophonic' || r.bassFocusMode) && (
              <div className="space-y-1.5 pt-1 border-t border-slate-800/80">
                <div className="text-[10px] text-slate-400">
                  {r.stemMode === 'polyphonic'
                    ? 'Peso Sub-Bass sobre la Canción:'
                    : 'Modos rápidos de Bajo / Empalme:'}
                </div>
                <div className="grid grid-cols-3 gap-1.5 text-[10px]">
                  <button
                    type="button"
                    onClick={() => r.applyMixPreset('replace')}
                    className={`px-2 py-1.5 rounded-lg border font-bold cursor-pointer transition-all ${
                      r.mixOptions.originalPct === 0 && r.mixOptions.replacementPct === 100
                        ? 'bg-[#00E5FF]/15 border-[#00E5FF] text-[#00E5FF]'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    100% Synth
                  </button>
                  <button
                    type="button"
                    onClick={() => r.applyMixPreset('layer-sub')}
                    className={`px-2 py-1.5 rounded-lg border font-bold cursor-pointer transition-all ${
                      r.mixOptions.originalPct >= 80 && r.mixOptions.replacementPct >= 50
                        ? 'bg-[#FF6B00]/20 border-[#FF6B00] text-[#FF6B00]'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-[#FF6B00]/50'
                    }`}
                    title="Empalma Monark/Sub-Bass debajo de un bajo acústico o eléctrico"
                  >
                    Empalmar Sub
                  </button>
                  <button
                    type="button"
                    onClick={() => r.applyMixPreset('hybrid')}
                    className={`px-2 py-1.5 rounded-lg border font-bold cursor-pointer transition-all ${
                      r.mixOptions.originalPct > 0 && r.mixOptions.originalPct < 80
                        ? 'bg-emerald-500/15 border-emerald-500 text-emerald-300'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    Híbrido 70/55
                  </button>
                </div>
              </div>
            )}

            {r.stemMode === 'drums' && (
              <div className="space-y-1.5 pt-1 text-[11px] text-slate-300">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={r.mixOptions.roundRobinHumanize}
                    onChange={(e) =>
                      r.setMixOptions((p) => ({ ...p, roundRobinHumanize: e.target.checked }))
                    }
                    className="accent-[#00E5FF]"
                  />
                  <span>Variación orgánica Round-Robin</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={r.mixOptions.duckOriginalTransients}
                    onChange={(e) =>
                      r.setMixOptions((p) => ({ ...p, duckOriginalTransients: e.target.checked }))
                    }
                    className="accent-[#FF6B00]"
                  />
                  <span>Limpiar transiente original al mezclar</span>
                </label>
              </div>
            )}
          </div>

          <div className="space-y-2.5 pt-2 border-t border-slate-800">
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">
                Nombre del Stem mejorado (misma duración exacta):
              </label>
              <input
                type="text"
                value={saveStemName}
                onChange={(e) => setSaveStemName(e.target.value)}
                placeholder="Batería (Sampled Pro)"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:border-[#00E5FF] focus:outline-none"
              />
            </div>

            {saveFeedback && (
              <div className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-[10.5px] text-emerald-300 flex items-center gap-1.5">
                <CheckCircle2 size={13} className="shrink-0" />
                <span>{saveFeedback}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={(!r.replacedBuffer && !r.originalBuffer) || r.isRendering || r.isExportingPc}
                onClick={() => void r.downloadReplacedAudio('wav', saveStemName)}
                className="py-2 px-2.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-[#00E5FF]/50 text-[#00E5FF] font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40"
                title="Exportar al PC en WAV 24-Bit sin compresión (48 kHz)"
              >
                {r.isExportingPc ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                <span>PC: WAV 24-Bit</span>
              </button>

              <button
                type="button"
                disabled={(!r.replacedBuffer && !r.originalBuffer) || r.isRendering || r.isExportingPc}
                onClick={() => void r.downloadReplacedAudio('mp3', saveStemName)}
                className="py-2 px-2.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-[#FF6B00]/50 text-[#FF6B00] font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40"
                title="Exportar al PC en MP3 320 kbps"
              >
                {r.isExportingPc ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                <span>PC: MP3 320k</span>
              </button>
            </div>

            {onSendTo16Pads && (r.replacedBuffer || r.originalBuffer) && (
              <button
                type="button"
                onClick={() =>
                  onSendTo16Pads(
                    r.replacedBuffer ?? r.originalBuffer!,
                    saveStemName || r.stemTitle || 'Sample_PC'
                  )
                }
                className="w-full py-1.5 px-3 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-700 text-amber-300 font-bold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer"
                title="Enviar este audio a Creador 16 Pads para cortar por transientes/rejilla y exportar ZIP o slices"
              >
                <Wand2 size={12} />
                <span>Cortar / Samplear en 16 Pads →</span>
              </button>
            )}

            <button
              type="button"
              disabled={!r.replacedBuffer || !r.selectedSong || r.isSavingCloud}
              onClick={() => {
                setSaveFeedback(null);
                void r
                  .saveReplacedStemToSong(saveStemName)
                  .then(() =>
                    setSaveFeedback(`¡Guardado en "${r.selectedSong?.title}" listo para usar!`)
                  )
                  .catch((err) =>
                    r.setStatusMessage(
                      err instanceof Error ? err.message : 'Error guardando en Supabase.'
                    )
                  );
              }}
              className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-emerald-500 to-[#00E5FF] hover:brightness-110 text-slate-950 font-black flex items-center justify-center gap-1.5 cursor-pointer shadow-md disabled:opacity-40"
            >
              {r.isSavingCloud ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <CloudUpload size={14} />
              )}
              <span>
                {r.isSavingCloud
                  ? 'Subiendo WAV 24-Bit a Supabase...'
                  : `Guardar en Canción${r.selectedSong ? `: ${r.selectedSong.title.slice(0, 18)}` : ''}`}
              </span>
            </button>

            <p className="text-[10px] text-slate-500 leading-snug">
              <Wand2 size={10} className="inline mr-1 text-[#FF6B00]" />
              Duración bloqueada al sample original ({duration.toFixed(2)}s) para encajar cuadrado con los demás stems del tema.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
