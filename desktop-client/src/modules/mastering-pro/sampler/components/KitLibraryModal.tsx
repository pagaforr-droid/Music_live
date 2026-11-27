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
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-[#121215] border border-white/[0.1] p-5 shadow-2xl flex flex-col gap-4 max-h-[85vh]">
        <div className="flex items-center justify-between border-b border-white/[0.07] pb-3">
          <div className="flex items-center gap-2">
            <FolderArchive size={17} className="text-zinc-300" />
            <h3 className="text-sm font-semibold tracking-tight text-zinc-100">
              Biblioteca de Kits (Local IndexedDB & Supabase Cloud)
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-white cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex items-center justify-between bg-[#0B0B0D] border border-white/[0.07] rounded-xl p-3 text-xs">
          <span className="text-zinc-400">
            Tu sesión actual se guarda automáticamente de forma temporal en IndexedDB.
          </span>
          <button
            type="button"
            onClick={() =>
              void onSaveLocalSnapshot().then(() => refresh())
            }
            className="px-3 py-1.5 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 font-semibold cursor-pointer shrink-0 transition-colors"
          >
            Guardar Copia Local
          </button>
        </div>

        {loading ? (
          <div className="py-10 flex items-center justify-center gap-2 text-xs text-zinc-400">
            <Loader2 size={16} className="animate-spin" />
            <span>Cargando kits...</span>
          </div>
        ) : (
          <div className="overflow-y-auto studio-scrollbar-thin space-y-4 pr-1 text-xs">
            {/* Local IndexedDB Kits */}
            <div className="space-y-2">
              <div className="text-[11px] font-semibold text-zinc-300 flex items-center gap-1.5">
                <HardDrive size={13} className="text-orange-400" />
                <span>Kits Temporales Locales ({localKits.length})</span>
              </div>
              {localKits.length === 0 ? (
                <p className="text-zinc-500 text-xs">
                  Sin copias locales adicionales todavía.
                </p>
              ) : (
                localKits.map((k) => (
                  <div
                    key={k.id}
                    className="rounded-xl bg-[#0D0D10] border border-white/[0.07] p-3 flex items-center justify-between"
                  >
                    <div>
                      <div className="font-semibold text-zinc-100">{k.name}</div>
                      <div className="text-[10.5px] font-mono text-zinc-500">
                        {k.regions.length} slices · {k.pattern.bpm} BPM
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          void onLoadLocalKit(k).then(() => onClose())
                        }
                        className="px-3 py-1 rounded-lg bg-[#222228] hover:bg-[#2E2E36] border border-white/[0.1] text-zinc-100 font-medium cursor-pointer"
                      >
                        Cargar
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteLocalKit(k.id).then(() => refresh())}
                        className="p-1.5 rounded-lg text-zinc-500 hover:text-rose-400 cursor-pointer"
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
              <div className="text-[11px] font-semibold text-zinc-300 flex items-center gap-1.5">
                <Cloud size={13} className="text-emerald-400" />
                <span>Kits en Supabase Cloud ({cloudKits.length})</span>
              </div>
              {cloudKits.length === 0 ? (
                <p className="text-zinc-500 text-xs">
                  No hay kits en Supabase Cloud aún. Usa el botón "Guardar en Nube".
                </p>
              ) : (
                cloudKits.map((ck) => (
                  <div
                    key={ck.id}
                    className="rounded-xl bg-[#0D0D10] border border-white/[0.07] p-3 flex items-center justify-between"
                  >
                    <div>
                      <div className="font-semibold text-zinc-100">{ck.name}</div>
                      <div className="text-[10.5px] font-mono text-zinc-500">
                        {(ck.total_bytes / (1024 * 1024)).toFixed(2)} MB ·{' '}
                        {ck.kit_json?.regions?.length ?? 0} slices
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        void onLoadCloudKit(ck).then(() => onClose())
                      }
                      className="px-3 py-1 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 font-semibold cursor-pointer"
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
