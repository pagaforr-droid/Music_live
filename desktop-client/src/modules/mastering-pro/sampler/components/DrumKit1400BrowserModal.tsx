import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Cloud,
  CloudUpload,
  FolderOpen,
  Loader2,
  Play,
  Search,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react';
import {
  DRUM_KIT_1400_FOLDERS,
  getDrumKit1400EntriesByFolder,
  type DrumKit1400Folder,
  type DrumKit1400SampleEntry,
} from '../engine/DrumKit1400Catalog';
import type { DrumPieceRole, SupabaseDrumSyncStatus } from '../types/sampler.types';

const ROLE_OPTIONS: Array<{ role: DrumPieceRole; label: string; color: string }> = [
  { role: 'kick', label: 'Kick (Bombo)', color: '#FB923C' },
  { role: 'snare', label: 'Snare / Snake (Caja)', color: '#22D3EE' },
  { role: 'hat', label: 'Hi-Hats (Charles)', color: '#FBBF24' },
  { role: 'tom', label: 'Toms (High/Mid/Floor)', color: '#34D399' },
  { role: 'crash', label: 'Crash / Ride', color: '#F472B6' },
];

function defaultFolderForRole(role: DrumPieceRole): DrumKit1400Folder {
  if (role === 'kick' || role === 'tom') return 'Kicks';
  if (role === 'hat' || role === 'crash') return 'Hats';
  return 'Snares';
}

export interface DrumKit1400BrowserModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode?: 'replacer' | 'pad';
  initialRole?: DrumPieceRole;
  initialFolder?: DrumKit1400Folder;
  selectedPadIndex?: number;
  padCount?: number;
  activeKit1400ByRole?: Partial<Record<DrumPieceRole, string>>;
  dynamicManifest?: Partial<Record<DrumKit1400Folder, string[]>>;
  syncedSampleIds?: ReadonlySet<string>;
  supabaseSyncStatus?: SupabaseDrumSyncStatus;
  onAuditionSample: (entryId: string) => void | Promise<void>;
  onSelectForRole?: (entryId: string, role: DrumPieceRole) => Promise<unknown> | void;
  onSelectForPad?: (entryId: string, padIndex: number) => Promise<unknown> | void;
  onSyncToSupabase?: () => Promise<boolean>;
}

const PAGE_SIZE = 72;

export const DrumKit1400BrowserModal: React.FC<DrumKit1400BrowserModalProps> = ({
  isOpen,
  onClose,
  mode = 'replacer',
  initialRole = 'kick',
  initialFolder,
  selectedPadIndex = 0,
  padCount = 16,
  activeKit1400ByRole,
  dynamicManifest,
  syncedSampleIds,
  supabaseSyncStatus = 'idle',
  onAuditionSample,
  onSelectForRole,
  onSelectForPad,
  onSyncToSupabase,
}) => {
  const [activeFolder, setActiveFolder] = useState<DrumKit1400Folder>(
    initialFolder ?? defaultFolderForRole(initialRole)
  );
  const [targetRole, setTargetRole] = useState<DrumPieceRole>(initialRole);
  const [targetPadIdx, setTargetPadIdx] = useState<number>(selectedPadIndex);
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyFeatured, setOnlyFeatured] = useState(false);
  const [page, setPage] = useState(0);
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setTargetRole(initialRole);
    setActiveFolder(initialFolder ?? defaultFolderForRole(initialRole));
    setTargetPadIdx(selectedPadIndex);
    setSearchQuery('');
    setOnlyFeatured(false);
    setPage(0);
  }, [isOpen, initialRole, initialFolder, selectedPadIndex]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const folderCounts = useMemo(() => {
    const out: Record<DrumKit1400Folder, number> = {
      Kicks: getDrumKit1400EntriesByFolder('Kicks', dynamicManifest).length,
      Snares: getDrumKit1400EntriesByFolder('Snares', dynamicManifest).length,
      Hats: getDrumKit1400EntriesByFolder('Hats', dynamicManifest).length,
      Claps: getDrumKit1400EntriesByFolder('Claps', dynamicManifest).length,
    };
    return out;
  }, [dynamicManifest]);

  const filteredEntries = useMemo(() => {
    const list = getDrumKit1400EntriesByFolder(activeFolder, dynamicManifest);
    const q = searchQuery.trim().toLowerCase();
    return list.filter((item) => {
      if (onlyFeatured && !item.featured) return false;
      if (!q) return true;
      return (
        item.fileName.toLowerCase().includes(q) ||
        item.label.toLowerCase().includes(q)
      );
    });
  }, [activeFolder, dynamicManifest, searchQuery, onlyFeatured]);

  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = useMemo(
    () => filteredEntries.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE),
    [filteredEntries, safePage]
  );

  if (!isOpen || typeof document === 'undefined') return null;

  const handleFolderSwitch = (folder: DrumKit1400Folder) => {
    setActiveFolder(folder);
    setPage(0);
    if (mode === 'replacer') {
      const folderMeta = DRUM_KIT_1400_FOLDERS.find((f) => f.folder === folder);
      if (folderMeta) {
        setTargetRole(folderMeta.targetRole);
      }
    }
  };

  const handlePickSample = async (entry: DrumKit1400SampleEntry, closeAfter = false) => {
    setBusyEntryId(entry.id);
    try {
      if (mode === 'pad' && onSelectForPad) {
        await onSelectForPad(entry.id, targetPadIdx);
      } else if (onSelectForRole) {
        await onSelectForRole(entry.id, targetRole);
      }
      if (closeAfter) {
        onClose();
      }
    } finally {
      setBusyEntryId(null);
    }
  };

  const activeTargetColor =
    ROLE_OPTIONS.find((r) => r.role === targetRole)?.color ?? '#FB923C';

  const modal = (
    <div
      className="fixed inset-0 z-[150] bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 select-none"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl rounded-2xl bg-[#111114] border border-white/[0.1] shadow-[0_24px_80px_rgba(0,0,0,0.85)] flex flex-col max-h-[88vh] overflow-hidden text-zinc-100"
      >
        {/* Header */}
        <div className="px-5 py-3.5 bg-[#16161A] border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-orange-500/15 border border-orange-400/35 flex items-center justify-center text-orange-300">
              <FolderOpen size={16} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold tracking-tight text-zinc-100">
                  1400 Samples Drum Kit · Biblioteca Predeterminada
                </h3>
                <span className="px-2 py-0.5 rounded-md bg-white/[0.06] border border-white/[0.09] text-[10px] font-mono text-zinc-300">
                  {folderCounts.Kicks + folderCounts.Snares + folderCounts.Hats + folderCounts.Claps} WAVs
                </span>
              </div>
              <p className="text-[11px] text-zinc-400">
                Escucha con un clic y asigna cada sonido a tu pieza o Pad · Se guarda y sincroniza en Supabase
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onSyncToSupabase && (
              <button
                type="button"
                onClick={() => void onSyncToSupabase()}
                disabled={supabaseSyncStatus === 'syncing'}
                className={`px-3 py-1.5 rounded-xl border text-[11px] font-medium flex items-center gap-1.5 cursor-pointer transition-colors ${
                  supabaseSyncStatus === 'synced'
                    ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300 hover:bg-emerald-500/25'
                    : supabaseSyncStatus === 'pending-offline'
                    ? 'bg-amber-500/15 border-amber-500/35 text-amber-300 hover:bg-amber-500/25'
                    : 'bg-[#202027] border-white/[0.1] text-zinc-200 hover:bg-[#2A2A33]'
                }`}
                title="Subir y sincronizar sonidos seleccionados en Supabase Storage y Base de Datos"
              >
                {supabaseSyncStatus === 'syncing' ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : supabaseSyncStatus === 'synced' ? (
                  <CheckCircle2 size={12} />
                ) : (
                  <CloudUpload size={12} />
                )}
                <span>
                  {supabaseSyncStatus === 'syncing'
                    ? 'Sincronizando...'
                    : supabaseSyncStatus === 'synced'
                    ? 'Guardado en Supabase'
                    : 'Guardar en Supabase'}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl bg-[#1E1E24] hover:bg-[#2A2A32] border border-white/[0.08] text-zinc-400 hover:text-white cursor-pointer"
              title="Cerrar (ESC)"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Folder Tabs (Kicks · Snares · Hats · Claps) + Target Assignment */}
        <div className="px-5 py-3 bg-[#0D0D10] border-b border-white/[0.07] flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {DRUM_KIT_1400_FOLDERS.map((f) => {
                const isActive = activeFolder === f.folder;
                return (
                  <button
                    key={f.folder}
                    type="button"
                    onClick={() => handleFolderSwitch(f.folder)}
                    style={
                      isActive
                        ? { borderColor: `${f.color}88`, backgroundColor: `${f.color}1C` }
                        : undefined
                    }
                    className={`px-3 py-1.5 rounded-xl border text-xs font-medium flex items-center gap-2 cursor-pointer transition-all ${
                      isActive
                        ? 'text-white shadow-sm'
                        : 'bg-[#151519] border-white/[0.07] text-zinc-400 hover:text-zinc-200 hover:border-white/[0.15]'
                    }`}
                  >
                    <FolderOpen size={13} style={{ color: f.color }} />
                    <span>{f.shortLabel}</span>
                    <span className="px-1.5 py-0.2 rounded bg-black/40 text-[10px] font-mono text-zinc-300 tabular-nums">
                      {folderCounts[f.folder]}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Destination Selector */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-[11px] text-zinc-400">Asignar sonido a:</span>
              {mode === 'pad' ? (
                <select
                  value={targetPadIdx}
                  onChange={(e) => setTargetPadIdx(Number(e.target.value))}
                  className="bg-[#17171C] border border-white/[0.12] rounded-xl px-2.5 py-1.5 text-xs text-zinc-100 cursor-pointer focus:outline-none"
                >
                  {Array.from({ length: padCount }, (_, idx) => (
                    <option key={idx} value={idx}>
                      Pad {idx + 1}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="flex flex-wrap items-center gap-1 bg-[#151519] border border-white/[0.08] rounded-xl p-0.5">
                  {ROLE_OPTIONS.map((ro) => {
                    const active = targetRole === ro.role;
                    return (
                      <button
                        key={ro.role}
                        type="button"
                        onClick={() => setTargetRole(ro.role)}
                        style={
                          active
                            ? { backgroundColor: ro.color, color: '#09090B' }
                            : undefined
                        }
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer transition-all ${
                          active ? '' : 'text-zinc-400 hover:text-zinc-100'
                        }`}
                      >
                        {ro.role === 'hat'
                          ? 'Hi-Hat'
                          : ro.role === 'snare'
                          ? 'Snare / Snake'
                          : ro.role === 'kick'
                          ? 'Kick'
                          : ro.role === 'tom'
                          ? 'Toms'
                          : 'Crash'}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Search & Quick Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search
                size={13}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(0);
                }}
                placeholder={`Buscar en ${activeFolder} (ej: NATURAL, 12, 74, 105...)`}
                className="w-full bg-[#151519] border border-white/[0.09] rounded-xl pl-8 pr-8 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-white/25"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setPage(0);
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200 cursor-pointer"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 text-[11px]">
              <button
                type="button"
                onClick={() => {
                  setOnlyFeatured((v) => !v);
                  setPage(0);
                }}
                className={`px-2.5 py-1.5 rounded-xl border font-medium flex items-center gap-1.5 cursor-pointer transition-colors ${
                  onlyFeatured
                    ? 'bg-amber-400/15 border-amber-400/45 text-amber-300'
                    : 'bg-[#151519] border-white/[0.08] text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Sparkles size={11} />
                <span>Destacados / NATURAL</span>
              </button>

              <span className="text-zinc-500 font-mono tabular-nums">
                {filteredEntries.length} sonidos
              </span>
            </div>
          </div>
        </div>

        {/* Sample Grid List */}
        <div className="flex-1 overflow-y-auto studio-scrollbar p-4 bg-[#09090B]">
          {pageItems.length === 0 ? (
            <div className="py-12 text-center text-xs text-zinc-500">
              No se encontraron muestras que coincidan con "{searchQuery}".
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {pageItems.map((entry) => {
                const assignedRoles = ROLE_OPTIONS.filter(
                  (ro) => activeKit1400ByRole?.[ro.role] === entry.id
                );
                const isSelectedForTarget =
                  mode === 'replacer' && activeKit1400ByRole?.[targetRole] === entry.id;
                const isBusy = busyEntryId === entry.id;
                const isSynced = syncedSampleIds?.has(entry.id);
                const isPreviewing = previewingId === entry.id;

                return (
                  <div
                    key={entry.id}
                    className={`rounded-xl border px-3 py-2 flex items-center justify-between gap-2 transition-all ${
                      isSelectedForTarget
                        ? 'bg-[#1D1D24] border-white/30 shadow-md'
                        : 'bg-[#121216] border-white/[0.07] hover:border-white/[0.16] hover:bg-[#17171C]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => {
                          setPreviewingId(entry.id);
                          void Promise.resolve(onAuditionSample(entry.id)).finally(() => {
                            setTimeout(() => {
                              setPreviewingId((cur) => (cur === entry.id ? null : cur));
                            }, 350);
                          });
                        }}
                        className={`w-7 h-7 rounded-full border flex items-center justify-center shrink-0 cursor-pointer transition-all ${
                          isPreviewing
                            ? 'bg-zinc-100 border-white text-zinc-950 scale-105'
                            : 'bg-[#1E1E25] hover:bg-zinc-100 border-white/[0.1] text-zinc-200 hover:text-zinc-950'
                        }`}
                        title={`Escuchar ${entry.fileName}`}
                      >
                        {isPreviewing ? (
                          <Volume2 size={12} />
                        ) : (
                          <Play size={11} className="fill-current ml-0.5" />
                        )}
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium text-zinc-100 truncate">
                            {entry.fileName.replace(/\.wav$/i, '')}
                          </span>
                          {/natural/i.test(entry.fileName) && (
                            <span className="px-1.5 py-0.2 rounded bg-emerald-500/15 border border-emerald-500/35 text-[9px] font-mono font-bold text-emerald-300 shrink-0">
                              NATURAL
                            </span>
                          )}
                          {isSynced && (
                            <span title="Sincronizado en Supabase Cloud" className="text-emerald-400 shrink-0">
                              <Cloud size={11} />
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 font-mono">
                          <span>{entry.folder}</span>
                          {assignedRoles.map((ar) => (
                            <span
                              key={ar.role}
                              style={{ color: ar.color }}
                              className="font-bold"
                            >
                              · ✓ {ar.role.toUpperCase()}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handlePickSample(entry, false)}
                      style={
                        isSelectedForTarget
                          ? { backgroundColor: activeTargetColor, color: '#09090B' }
                          : undefined
                      }
                      className={`px-2.5 py-1 rounded-lg text-[10.5px] font-semibold shrink-0 cursor-pointer transition-all ${
                        isSelectedForTarget
                          ? 'shadow-sm'
                          : 'bg-[#1F1F26] hover:bg-zinc-100 text-zinc-200 hover:text-zinc-950 border border-white/[0.09]'
                      }`}
                      title={
                        mode === 'pad'
                          ? `Cargar en Pad ${targetPadIdx + 1}`
                          : `Seleccionar para ${targetRole.toUpperCase()} y guardar en Supabase`
                      }
                    >
                      {isBusy ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : isSelectedForTarget ? (
                        '✓ Activo'
                      ) : mode === 'pad' ? (
                        `→ Pad ${targetPadIdx + 1}`
                      ) : (
                        'Usar'
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Pagination & Footer */}
        <div className="px-5 py-2.5 bg-[#141418] border-t border-white/[0.08] flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-[11px] text-zinc-400">
            Carpeta activa: <code className="text-zinc-200 font-mono">1400 Samples Drum Kit/{activeFolder}</code>
          </span>

          {totalPages > 1 && (
            <div className="flex items-center gap-1.5 font-mono text-[11px]">
              <button
                type="button"
                disabled={safePage === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="px-2 py-1 rounded-lg bg-[#1E1E24] hover:bg-[#282830] border border-white/[0.08] text-zinc-200 disabled:opacity-35 cursor-pointer flex items-center gap-1"
              >
                <ChevronLeft size={12} />
                <span>Ant.</span>
              </button>
              <span className="px-2 text-zinc-300 tabular-nums">
                Pág {safePage + 1} / {totalPages}
              </span>
              <button
                type="button"
                disabled={safePage >= totalPages - 1}
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                className="px-2 py-1 rounded-lg bg-[#1E1E24] hover:bg-[#282830] border border-white/[0.08] text-zinc-200 disabled:opacity-35 cursor-pointer flex items-center gap-1"
              >
                <span>Sig.</span>
                <ChevronRight size={12} />
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 font-semibold cursor-pointer"
          >
            Listo
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
};
