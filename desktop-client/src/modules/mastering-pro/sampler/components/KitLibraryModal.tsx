import React, { useEffect, useState } from 'react';
import { FolderArchive, Cloud, Trash2, X, Loader2, HardDrive } from 'lucide-react';
import type { CloudSampleKitRecord, SampleKit } from '../types/sampler.types';
import { deleteLocalKit, listSavedLocalKits } from '../engine/KitStorage';
import { fetchCloudSampleKits } from '../services/supabaseSamplerService';

interface KitLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveLocalSnapshot: () => Promise<void>;
  onLoadLocalKit: (kit: SampleKit) => Promise<void>;
  onLoadCloudKit: (record: CloudSampleKitRecord) => Promise<void>;
}

export const KitLibraryModal: React.FC<KitLibraryModalProps> = ({
  isOpen,
  onClose,
  onSaveLocalSnapshot,
  onLoadLocalKit,
  onLoadCloudKit,
}) => {
  const [localKits, setLocalKits] = useState<SampleKit[]>([]);
  const [cloudKits, setCloudKits] = useState<CloudSampleKitRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const [loc, cld] = await Promise.all([
        listSavedLocalKits(),
        fetchCloudSampleKits(),
      ]);
      setLocalKits(loc);
      setCloudKits(cld);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) void refresh();
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-800 p-5 shadow-2xl flex flex-col gap-4 max-h-[85vh]">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <FolderArchive size={18} className="text-[#00E5FF]" />
            <h3 className="text-sm font-mono font-bold uppercase text-white">
              Biblioteca de Kits (Temporales IndexedDB & Supabase Cloud)
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

        <div className="flex items-center justify-between bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs">
          <span className="text-slate-300">
            Tu sesión actual se guarda automáticamente de forma temporal en IndexedDB.
          </span>
          <button
            type="button"
            onClick={() =>
              void onSaveLocalSnapshot().then(() => refresh())
            }
            className="px-3 py-1.5 rounded-lg bg-[#FF6B00] text-slate-950 font-mono font-bold cursor-pointer shrink-0"
          >
            Guardar Copia Local
          </button>
        </div>

        {loading ? (
          <div className="py-10 flex items-center justify-center gap-2 text-xs font-mono text-slate-400">
            <Loader2 size={16} className="animate-spin" />
            <span>Cargando kits...</span>
          </div>
        ) : (
          <div className="overflow-y-auto space-y-4 pr-1 text-xs">
            {/* Local IndexedDB Kits */}
            <div className="space-y-2">
              <div className="text-[11px] font-mono font-bold text-[#FF6B00] flex items-center gap-1.5">
                <HardDrive size={13} />
                <span>Kits Temporales Locales ({localKits.length})</span>
              </div>
              {localKits.length === 0 ? (
                <p className="text-slate-500 font-mono text-[11px]">
                  Sin copias locales adicionales todavía.
                </p>
              ) : (
                localKits.map((k) => (
                  <div
                    key={k.id}
                    className="rounded-xl bg-slate-950 border border-slate-800 p-2.5 flex items-center justify-between"
                  >
                    <div>
                      <div className="font-bold text-white">{k.name}</div>
                      <div className="text-[10px] font-mono text-slate-400">
                        {k.regions.length} slices · {k.pattern.bpm} BPM
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          void onLoadLocalKit(k).then(() => onClose())
                        }
                        className="px-2.5 py-1 rounded-lg bg-[#00E5FF]/15 border border-[#00E5FF]/40 text-[#00E5FF] font-mono font-bold cursor-pointer"
                      >
                        Cargar
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteLocalKit(k.id).then(() => refresh())}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 cursor-pointer"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Supabase Cloud Kits */}
            <div className="space-y-2">
              <div className="text-[11px] font-mono font-bold text-[#00E5FF] flex items-center gap-1.5">
                <Cloud size={13} />
                <span>Kits en Supabase Cloud ({cloudKits.length})</span>
              </div>
              {cloudKits.length === 0 ? (
                <p className="text-slate-500 font-mono text-[11px]">
                  No hay kits en Supabase Cloud aún. Usa el botón "Guardar en Supabase".
                </p>
              ) : (
                cloudKits.map((ck) => (
                  <div
                    key={ck.id}
                    className="rounded-xl bg-slate-950 border border-slate-800 p-2.5 flex items-center justify-between"
                  >
                    <div>
                      <div className="font-bold text-white">{ck.name}</div>
                      <div className="text-[10px] font-mono text-slate-400">
                        {(ck.total_bytes / (1024 * 1024)).toFixed(2)} MB ·{' '}
                        {ck.kit_json?.regions?.length ?? 0} slices
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        void onLoadCloudKit(ck).then(() => onClose())
                      }
                      className="px-2.5 py-1 rounded-lg bg-[#FF6B00] text-slate-950 font-mono font-bold cursor-pointer"
                    >
                      Abrir Kit Cloud
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
