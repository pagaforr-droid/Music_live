import React, { useEffect, useState } from 'react';
import { CloudUpload, FolderPlus, Music2, CheckCircle2, Database, X, Loader2 } from 'lucide-react';
import type { SamplePad, SampleRegion, SongFolderItem } from '../types/sampler.types';
import {
  SAMPLE_KITS_MIGRATION_SQL,
  createSongFolderForSampler,
  fetchSongFoldersForSampler,
} from '../services/supabaseSamplerService';

interface SaveToSupabaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  kitName: string;
  selectedPad: SamplePad;
  selectedRegion: SampleRegion | null;
  hasSources: boolean;
  onSaveKitToCloud: (songId?: string | null) => Promise<void>;
  onAddSampleToSongFolder: (opts: {
    songId: string;
    bandId?: string;
    sampleName: string;
    sourceKind: 'pad' | 'region' | 'bounce';
    bounceBars: number;
  }) => Promise<{ stemName: string }>;
}

export const SaveToSupabaseModal: React.FC<SaveToSupabaseModalProps> = ({
  isOpen,
  onClose,
  kitName,
  selectedPad,
  selectedRegion,
  hasSources,
  onSaveKitToCloud,
  onAddSampleToSongFolder,
}) => {
  const [activeTab, setActiveTab] = useState<'song-folder' | 'cloud-kit' | 'sql'>('song-folder');
  const [folders, setFolders] = useState<SongFolderItem[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedSongId, setSelectedSongId] = useState<string>('');
  const [newFolderTitle, setNewFolderTitle] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);

  const [sourceKind, setSourceKind] = useState<'pad' | 'region' | 'bounce'>('pad');
  const [bounceBars, setBounceBars] = useState<number>(2);
  const [sampleName, setSampleName] = useState<string>(selectedPad.label || 'Sample_24bit');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setSuccessMsg(null);
    setSampleName(
      sourceKind === 'pad'
        ? selectedPad.label || `Pad_${selectedPad.index + 1}`
        : sourceKind === 'region'
        ? selectedRegion?.name || 'Sample_Region'
        : `${kitName}_Bounce`
    );
    setLoadingFolders(true);
    void fetchSongFoldersForSampler()
      .then((list) => {
        setFolders(list);
        if (list.length > 0 && !selectedSongId) {
          setSelectedSongId(list[0].id);
        }
      })
      .finally(() => setLoadingFolders(false));
  }, [isOpen]);

  useEffect(() => {
    if (sourceKind === 'pad') setSampleName(selectedPad.label || `Pad_${selectedPad.index + 1}`);
    else if (sourceKind === 'region') setSampleName(selectedRegion?.name || 'Sample_Region');
    else setSampleName(`${kitName}_Bounce_${bounceBars}bars`);
  }, [sourceKind, selectedPad, selectedRegion, kitName, bounceBars]);

  if (!isOpen) return null;

  const filteredFolders = folders.filter((f) =>
    f.title.toLowerCase().includes(search.toLowerCase())
  );

  const handleCreateFolder = async () => {
    if (!newFolderTitle.trim()) return;
    setCreatingFolder(true);
    setError(null);
    try {
      const created = await createSongFolderForSampler(newFolderTitle);
      setFolders((prev) => [created, ...prev]);
      setSelectedSongId(created.id);
      setNewFolderTitle('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error creando carpeta de tema.');
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleAddToFolderSubmit = async () => {
    if (!selectedSongId) {
      setError('Selecciona o crea un Tema (carpeta de pistas) primero.');
      return;
    }
    setBusy(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const folder = folders.find((f) => f.id === selectedSongId);
      const res = await onAddSampleToSongFolder({
        songId: selectedSongId,
        bandId: folder?.band_id,
        sampleName,
        sourceKind,
        bounceBars,
      });
      setSuccessMsg(
        `¡"${res.stemName}" guardado en Supabase dentro del tema "${folder?.title ?? 'seleccionado'}"! Ya está listo en Stem Studio y Mastering Pro.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error guardando muestra en el tema.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveFullKitSubmit = async () => {
    setBusy(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await onSaveKitToCloud(selectedSongId || null);
      setSuccessMsg(
        `Kit "${kitName}" y sus archivos WAV guardados en Supabase Cloud listos para exportar o reutilizar.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error guardando Kit en Supabase.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-800 p-5 shadow-2xl flex flex-col gap-4 max-h-[88vh] overflow-y-auto studio-scrollbar-thin">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <CloudUpload size={18} className="text-[#00E5FF]" />
            <h3 className="text-sm font-mono font-bold uppercase text-white">
              Guardar en Supabase · Carpetas de Temas & Kits Cloud
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap gap-1.5 bg-slate-950 border border-slate-800 rounded-xl p-1 text-xs font-mono">
          <button
            type="button"
            onClick={() => setActiveTab('song-folder')}
            className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'song-folder'
                ? 'bg-[#FF6B00] text-slate-950'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Music2 size={13} />
            <span>Agregar a un Tema (Carpeta de Pistas)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('cloud-kit')}
            className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'cloud-kit'
                ? 'bg-[#00E5FF] text-slate-950'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <CloudUpload size={13} />
            <span>Guardar Kit Completo Cloud</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('sql')}
            className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'sql'
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Database size={13} />
            <span>SQL Schema</span>
          </button>
        </div>

        {error && (
          <div className="px-3 py-2 rounded-xl bg-rose-500/15 border border-rose-500/40 text-xs text-rose-300">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-xs text-emerald-300 flex items-center gap-2">
            <CheckCircle2 size={15} className="shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* TAB 1: ADD SAMPLE / BOUNCE TO SONG FOLDER */}
        {activeTab === 'song-folder' && (
          <div className="flex flex-col gap-3 text-xs">
            {/* Step 1: What audio to send */}
            <div className="rounded-xl bg-slate-950 border border-slate-800 p-3 space-y-2.5">
              <span className="text-[11px] font-mono font-bold text-[#00E5FF] uppercase">
                1. ¿Qué archivo WAV 24-Bit deseas guardar en el Tema?
              </span>
              <div className="grid grid-cols-3 gap-2 font-mono">
                <button
                  type="button"
                  disabled={!selectedPad.regionId}
                  onClick={() => setSourceKind('pad')}
                  className={`py-2 px-2 rounded-lg border text-left disabled:opacity-40 cursor-pointer ${
                    sourceKind === 'pad'
                      ? 'bg-[#FF6B00]/20 border-[#FF6B00] text-white'
                      : 'bg-slate-900 border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="font-bold">Pad {selectedPad.index + 1}</div>
                  <div className="text-[10px] truncate">{selectedPad.label}</div>
                </button>
                <button
                  type="button"
                  disabled={!selectedRegion}
                  onClick={() => setSourceKind('region')}
                  className={`py-2 px-2 rounded-lg border text-left disabled:opacity-40 cursor-pointer ${
                    sourceKind === 'region'
                      ? 'bg-[#00E5FF]/20 border-[#00E5FF] text-white'
                      : 'bg-slate-900 border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="font-bold">Región Cortada</div>
                  <div className="text-[10px] truncate">{selectedRegion?.name ?? '—'}</div>
                </button>
                <button
                  type="button"
                  disabled={!hasSources}
                  onClick={() => setSourceKind('bounce')}
                  className={`py-2 px-2 rounded-lg border text-left disabled:opacity-40 cursor-pointer ${
                    sourceKind === 'bounce'
                      ? 'bg-emerald-500/20 border-emerald-400 text-white'
                      : 'bg-slate-900 border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="font-bold">Bounce Secuenciador</div>
                  <div className="text-[10px]">{bounceBars} compases</div>
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <div className="flex-1 min-w-[200px]">
                  <label className="text-[10px] font-mono text-slate-400 block mb-1">
                    Nombre de la pista en la carpeta del Tema:
                  </label>
                  <input
                    type="text"
                    value={sampleName}
                    onChange={(e) => setSampleName(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white focus:border-[#00E5FF] focus:outline-none"
                  />
                </div>
                {sourceKind === 'bounce' && (
                  <div>
                    <label className="text-[10px] font-mono text-slate-400 block mb-1">
                      Compases:
                    </label>
                    <select
                      value={bounceBars}
                      onChange={(e) => setBounceBars(Number(e.target.value))}
                      className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs font-mono text-white"
                    >
                      {[1, 2, 4, 8].map((b) => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>

            {/* Step 2: Choose or Create Tema (Carpeta) */}
            <div className="rounded-xl bg-slate-950 border border-slate-800 p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono font-bold text-[#FF6B00] uppercase">
                  2. Elige el Tema / Carpeta de Pistas destino
                </span>
                <input
                  type="text"
                  placeholder="Buscar tema..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-white w-44"
                />
              </div>

              <div className="max-h-36 overflow-y-auto studio-scrollbar-thin space-y-1 pr-1">
                {loadingFolders ? (
                  <div className="py-4 text-center text-slate-500 font-mono">
                    Cargando temas de Supabase...
                  </div>
                ) : filteredFolders.length === 0 ? (
                  <div className="py-3 text-center text-slate-500 font-mono">
                    No se encontraron temas. Crea uno abajo.
                  </div>
                ) : (
                  filteredFolders.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setSelectedSongId(f.id)}
                      className={`w-full px-3 py-1.5 rounded-lg border text-left font-mono flex items-center justify-between cursor-pointer ${
                        selectedSongId === f.id
                          ? 'bg-[#00E5FF]/15 border-[#00E5FF] text-white'
                          : 'bg-slate-900/70 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <span className="truncate font-bold">{f.title}</span>
                      <span className="text-[10px] text-slate-400">
                        {f.stemCount ?? 0} pistas
                      </span>
                    </button>
                  ))
                )}
              </div>

              {/* Inline Create New Tema */}
              <div className="flex gap-2 pt-1 border-t border-slate-800">
                <input
                  type="text"
                  placeholder="O crea una carpeta/tema nuevo..."
                  value={newFolderTitle}
                  onChange={(e) => setNewFolderTitle(e.target.value)}
                  className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                />
                <button
                  type="button"
                  disabled={!newFolderTitle.trim() || creatingFolder}
                  onClick={() => void handleCreateFolder()}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-mono text-[#00E5FF] flex items-center gap-1 disabled:opacity-40 cursor-pointer"
                >
                  <FolderPlus size={13} />
                  <span>Crear Tema</span>
                </button>
              </div>
            </div>

            <button
              type="button"
              disabled={busy || !selectedSongId || !hasSources}
              onClick={() => void handleAddToFolderSubmit()}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-[#FF6B00] to-[#00E5FF] text-slate-950 font-extrabold text-xs flex items-center justify-center gap-2 disabled:opacity-40 cursor-pointer"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <CloudUpload size={15} />}
              <span>
                {busy
                  ? 'Renderizando 24-Bit WAV y subiendo a Supabase...'
                  : 'Subir y Agregar al Tema en Supabase'}
              </span>
            </button>
          </div>
        )}

        {/* TAB 2: SAVE FULL KIT TO CLOUD */}
        {activeTab === 'cloud-kit' && (
          <div className="flex flex-col gap-3 text-xs">
            <div className="rounded-xl bg-slate-950 border border-slate-800 p-4 space-y-2">
              <h4 className="font-bold text-white">
                Respaldar Kit Completo "{kitName}" en Supabase Storage + DB
              </h4>
              <p className="text-slate-400 leading-relaxed">
                Sube todas las fuentes WAV originales, los cortes (slices), ajustes ADSR/Filtro/Warp de los 16 Pads y el patrón del Secuenciador a tu cuenta en la nube, listo para abrir o exportar desde cualquier sesión.
              </p>
            </div>
            <button
              type="button"
              disabled={busy || !hasSources}
              onClick={() => void handleSaveFullKitSubmit()}
              className="w-full py-2.5 rounded-xl bg-[#00E5FF] hover:bg-cyan-300 text-slate-950 font-extrabold text-xs flex items-center justify-center gap-2 disabled:opacity-40 cursor-pointer"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <CloudUpload size={15} />}
              <span>{busy ? 'Subiendo Kit...' : 'Guardar Kit Completo en Supabase'}</span>
            </button>
          </div>
        )}

        {/* TAB 3: SQL MIGRATION */}
        {activeTab === 'sql' && (
          <pre className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-mono text-emerald-300 overflow-x-auto overflow-y-auto studio-scrollbar-thin max-h-72">
            {SAMPLE_KITS_MIGRATION_SQL}
          </pre>
        )}
      </div>
    </div>
  );
};
