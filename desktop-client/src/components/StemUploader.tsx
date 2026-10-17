import React, { useState } from 'react';
import { UploadCloud, CheckCircle, AlertTriangle, FileAudio, Archive } from 'lucide-react';
import { supabase } from '../lib/supabase';
import JSZip from 'jszip';

interface StemUploaderProps {
  songId?: string | null;
  bandId: string;
  onUploadComplete?: (newSongId?: string) => void;
  compact?: boolean;
}

export default function StemUploader({ songId, bandId, onUploadComplete, compact = false }: StemUploaderProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'success' | 'error' | 'processing'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [progressInfo, setProgressInfo] = useState('');
  const [progressPct, setProgressPct] = useState<number>(0);

  // Mejorado con Timeout Anti-Congelamiento
  const getAudioDuration = (file: File | Blob): Promise<number> => {
    const audioPromise = new Promise<number>((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const audio = new Audio(url);
      audio.addEventListener('loadedmetadata', () => {
        URL.revokeObjectURL(url);
        resolve(audio.duration);
      });
      audio.addEventListener('error', (e) => {
        URL.revokeObjectURL(url);
        reject(e);
      });
    });

    // Timeout de 2 segundos. Si falla, asume duración 0 para no romper la subida.
    const timeoutPromise = new Promise<number>((resolve) => {
      setTimeout(() => resolve(0), 2000);
    });

    return Promise.race([audioPromise, timeoutPromise]).catch(() => 0);
  };

  const checkDuplicateName = async (targetSongId: string, baseName: string) => {
    const { data } = await supabase
      .from('stems')
      .select('id')
      .eq('song_id', targetSongId)
      .eq('name', baseName)
      .limit(1);
    
    return data && data.length > 0;
  };

  const sanitizeStorageName = (name: string) =>
    name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '_');

  const uploadSingleFile = async (file: File | Blob, fileName: string, fileType: string, targetSongId: string) => {
    const baseName = fileName.replace(/\.[^.]+$/, '') || 'Nuevo Stem';
    
    // Check duplicates
    const isDuplicate = await checkDuplicateName(targetSongId, baseName);
    if (isDuplicate) {
      console.warn(`Se omitió pista duplicada "${baseName}" en esta carpeta.`);
      return;
    }

    // 1. Obtener duración real para pasarle al backend (con protección timeout)
    const durationSeconds = await getAudioDuration(file);
    
    // 2. Subir al Storage
    const safeFileName = sanitizeStorageName(fileName);
    const storagePath = `${bandId}/${targetSongId}/${Date.now()}_${safeFileName}`;
    const { error: uploadError } = await supabase.storage
      .from('audios')
      .upload(storagePath, file, { contentType: fileType || 'audio/wav' });

    if (uploadError) throw uploadError;

    // 3. Obtener URL pública
    const { data: publicUrlData } = supabase.storage.from('audios').getPublicUrl(storagePath);

    // Identificar si es un Master Track (Fuente #1 para Tempo, Grilla y Acordes IA)
    // Es master si el nombre termina o contiene claramente "master", "full", "mezcla" o "mix" SIN un instrumento entre paréntesis al final
    const nameWithoutExt = baseName.toLowerCase().trim();
    const hasInstrumentSuffix = /\(([^)]+)\)\s*$/.test(baseName);
    const isMaster = !hasInstrumentSuffix && (
      nameWithoutExt.endsWith('master') ||
      nameWithoutExt.endsWith('full') ||
      nameWithoutExt.endsWith('mezcla') ||
      nameWithoutExt.endsWith('mix') ||
      nameWithoutExt === 'master' ||
      nameWithoutExt.includes('mezcla master')
    );

    // 4. Insertar en la tabla stems
    const { error: dbError } = await supabase.from('stems').insert({
      song_id: targetSongId,
      name: baseName,
      file_url: publicUrlData.publicUrl,
      type: 'Audio',
      metadata: {
        duration_seconds: Math.round(durationSeconds),
        format: fileType || 'audio/wav',
        original_name: fileName,
        is_master: isMaster
      }
    });

    if (dbError) throw dbError;
  };

  const createNewSong = async (rawTitle: string) => {
    const title = rawTitle.replace(/\.(zip|wav|mp3|ogg|flac|m4a)$/i, '').trim() || 'Nuevo Proyecto';
    const { data, error } = await supabase.from('songs').insert({
      band_id: bandId,
      title: title
    }).select('id').single();

    if (error) throw error;
    return data.id;
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);

    setIsUploading(true);
    setUploadStatus('processing');
    setErrorMessage('');
    setProgressPct(0);
    
    let activeSongId = songId;

    try {
      const firstFile = files[0];
      const isZipUpload = files.length === 1 && (firstFile.name.toLowerCase().endsWith('.zip') || firstFile.type === 'application/zip');

      if (isZipUpload) {
        // Si no hay proyecto seleccionado, creamos uno con el nombre del ZIP.
        // Si ya hay proyecto seleccionado pero tiene pistas, consultamos o creamos; si está vacío, depositamos directo ahí.
        if (!activeSongId) {
          setProgressInfo('Creando nuevo proyecto desde archivo .ZIP...');
          activeSongId = await createNewSong(firstFile.name);
        } else {
          const { count } = await supabase
            .from('stems')
            .select('id', { count: 'exact', head: true })
            .eq('song_id', activeSongId);
          if ((count ?? 0) > 0) {
            setProgressInfo('Creando nuevo proyecto desde archivo .ZIP...');
            activeSongId = await createNewSong(firstFile.name);
          }
        }

        setProgressInfo('Descomprimiendo paquete de Stems (.ZIP)...');
        const zip = new JSZip();
        const loadedZip = await zip.loadAsync(firstFile);
        
        const validExtensions = ['.wav', '.mp3', '.ogg', '.flac', '.m4a'];
        const audioFiles = Object.keys(loadedZip.files).filter(filename => {
          const isDir = loadedZip.files[filename].dir;
          const isMacTrash = filename.includes('__MACOSX') || filename.includes('.DS_Store');
          const isAudio = validExtensions.some(ext => filename.toLowerCase().endsWith(ext));
          return !isDir && !isMacTrash && isAudio;
        });

        if (audioFiles.length === 0) {
          throw new Error("No se encontraron archivos de audio válidos dentro del ZIP.");
        }

        let uploadedCount = 0;
        for (const filename of audioFiles) {
          const shortName = filename.split('/').pop() || filename;
          setProgressInfo(`Subiendo stem ${uploadedCount + 1}/${audioFiles.length}: ${shortName}`);
          setProgressPct(Math.round(((uploadedCount) / audioFiles.length) * 100));
          
          const fileData = await loadedZip.files[filename].async('blob');
          const ext = filename.split('.').pop()?.toLowerCase();
          const mimeType = ext === 'wav' ? 'audio/wav' : ext === 'mp3' ? 'audio/mpeg' : ext === 'flac' ? 'audio/flac' : 'audio/ogg';
          
          await uploadSingleFile(fileData, shortName, mimeType, activeSongId as string);
          uploadedCount++;
          setProgressPct(Math.round((uploadedCount / audioFiles.length) * 100));
        }
      } else {
        // Subida de 1 o múltiples archivos de Stems ya separados (.wav, .mp3, etc.)
        if (!activeSongId) {
          const suggestedTitle = firstFile.name.replace(/\.(wav|mp3|ogg|flac|m4a)$/i, '').replace(/[-_ ]*(drums|bass|keys|piano|guitar|vocals|master|click|guia|pad|strings)$/i, '').trim() || 'Nuevo Proyecto';
          const customTitle = prompt("Nombre del proyecto para estos Stems:", suggestedTitle);
          if (!customTitle) {
            setIsUploading(false);
            setUploadStatus('idle');
            return;
          }
          setProgressInfo(`Creando proyecto "${customTitle}"...`);
          activeSongId = await createNewSong(customTitle);
        }

        if (!activeSongId) throw new Error('No se pudo determinar el ID de la canción.');
        let uploadedCount = 0;
        for (const f of files) {
          if (f.name.toLowerCase().endsWith('.zip')) continue;
          setProgressInfo(`Subiendo stem ${uploadedCount + 1}/${files.length}: ${f.name}`);
          setProgressPct(Math.round((uploadedCount / files.length) * 100));
          await uploadSingleFile(f, f.name, f.type || 'audio/wav', activeSongId);
          uploadedCount++;
          setProgressPct(Math.round((uploadedCount / files.length) * 100));
        }
      }

      setUploadStatus('success');
      setProgressInfo('');
      setProgressPct(100);
      if (onUploadComplete) onUploadComplete(activeSongId ?? undefined);
      setTimeout(() => setUploadStatus('idle'), 3500);
    } catch (error: any) {
      console.error('Error uploading stem:', error);
      setUploadStatus('error');
      if (error.message?.includes('Tier Limit Reached') || error.error === 'Tenant quota exceeded' || error.statusCode === 413) {
        setErrorMessage('Almacenamiento Lleno: Has superado el límite de almacenamiento o el archivo es demasiado pesado.');
      } else {
        setErrorMessage(error.message || 'Error desconocido al subir archivo');
      }
    } finally {
      setIsUploading(false);
      if (event.target) event.target.value = '';
    }
  };

  if (compact) {
    return (
      <div className="relative group w-full">
        <input
          type="file"
          multiple
          accept="audio/*,.zip,application/zip"
          onChange={handleFileUpload}
          disabled={isUploading}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed z-10"
        />
        <div
          className={`stage-tactile-btn w-full px-4 py-3 rounded-2xl border border-dashed transition-all flex items-center justify-between gap-3 ${
            isUploading
              ? 'border-[#ef4444]/60 bg-[#ef4444]/10'
              : uploadStatus === 'success'
              ? 'border-emerald-500/60 bg-emerald-950/20'
              : 'border-white/15 group-hover:border-[#ef4444]/60 bg-[#12151f]/90 group-hover:bg-[#171b27]'
          }`}
        >
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#ef4444]/25 to-[#ef4444]/5 border border-[#ef4444]/35 flex items-center justify-center shrink-0 text-[#ef4444] shadow-[0_0_12px_rgba(239,68,68,0.2)]">
              {isUploading ? (
                <UploadCloud size={17} className="animate-bounce" />
              ) : uploadStatus === 'success' ? (
                <CheckCircle size={17} className="text-emerald-400" />
              ) : (
                <UploadCloud size={17} />
              )}
            </div>
            <div className="flex flex-col min-w-0 text-left">
              <span className="text-xs font-extrabold text-white truncate tracking-tight">
                {isUploading
                  ? progressInfo || 'Subiendo Stems...'
                  : uploadStatus === 'success'
                  ? '¡Stems cargados correctamente!'
                  : 'Cargar Stems Separados (WAV / MP3 / .ZIP) + Pista Master'}
              </span>
              <span className="text-[10px] text-[#8e96a4] truncate">
                {isUploading
                  ? `${progressPct}% completado`
                  : 'Selecciona múltiples pistas a la vez o arrastra un paquete .ZIP (Incluye tu pista "Master" para la IA)'}
              </span>
            </div>
          </div>
          <span className="px-3.5 py-1.5 rounded-full bg-gradient-to-r from-[#ef4444] to-[#dc2626] text-white text-[10px] font-black uppercase tracking-wider shrink-0 shadow-[0_0_14px_rgba(239,68,68,0.35)] border border-white/15">
            {isUploading ? `${progressPct}%` : '+ Subir Stems'}
          </span>
        </div>
        {uploadStatus === 'error' && (
          <div className="mt-1.5 text-[10px] text-red-400 font-medium px-1">{errorMessage}</div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`stage-glass-panel border-2 border-dashed ${
        !songId ? 'border-[#ef4444]/40 hover:border-[#ef4444]' : 'border-white/10 hover:border-[#ef4444]/55'
      } rounded-3xl p-8 text-center transition-all relative group overflow-hidden`}
    >
      {/* Subtle Concentric Rings */}
      <div className="pointer-events-none absolute -right-20 -bottom-20 w-64 h-64 rounded-full border border-white/[0.03]" />
      <div className="pointer-events-none absolute -right-10 -bottom-10 w-44 h-44 rounded-full border border-[#ef4444]/10" />

      <input
        type="file"
        multiple
        accept="audio/*,.zip,application/zip"
        onChange={handleFileUpload}
        disabled={isUploading}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed z-10"
      />

      <div className="flex flex-col items-center justify-center space-y-3.5 relative z-0">
        {isUploading ? (
          <div className="animate-bounce text-[#ef4444] drop-shadow-[0_0_16px_rgba(239,68,68,0.6)]">
            <UploadCloud size={46} />
          </div>
        ) : uploadStatus === 'success' ? (
          <CheckCircle size={46} className="text-emerald-400 drop-shadow-[0_0_16px_rgba(16,185,129,0.5)]" />
        ) : uploadStatus === 'error' ? (
          <AlertTriangle size={46} className="text-red-500" />
        ) : (
          <div className="flex items-center space-x-3">
            <div className="w-13 h-13 rounded-2xl bg-gradient-to-br from-[#ef4444]/20 to-[#ef4444]/5 border border-[#ef4444]/35 flex items-center justify-center text-[#ef4444] shadow-[0_8px_20px_rgba(239,68,68,0.2)]">
              <FileAudio size={24} />
            </div>
            <div className="w-13 h-13 rounded-2xl bg-[#151822] border border-white/10 flex items-center justify-center text-gray-300 shadow-inner">
              <Archive size={24} />
            </div>
          </div>
        )}

        <div className="text-white font-extrabold text-sm tracking-tight">
          {isUploading ? (
            'Cargando pistas al proyecto...'
          ) : !songId ? (
            <span>
              Arrastra tus <span className="text-[#ef4444]">Stems Separados</span> o un{' '}
              <span className="text-[#ef4444]">.ZIP</span> para crear una Canción
            </span>
          ) : (
            'Arrastra múltiples Stems separados o un paquete .ZIP a esta canción'
          )}
        </div>
        <p className="text-[11px] text-[#8e96a4] max-w-md leading-relaxed">
          Tip: Incluye un archivo terminado en{' '}
          <strong className="text-amber-400 font-bold">Master</strong> (ej.{' '}
          <code className="px-1.5 py-0.5 rounded bg-white/[0.06] text-gray-200">Cancion_Master.wav</code>) para que la IA detecte el Tempo, Compás y Acordes con precisión total.
        </p>

        {progressInfo && (
          <div className="w-full max-w-xs space-y-2 pt-1">
            <div className="text-[#ef4444] text-xs font-bold animate-pulse truncate">
              {progressInfo}
            </div>
            <div className="w-full h-2 bg-[#090b10] rounded-full overflow-hidden border border-white/[0.06]">
              <div
                className="h-full bg-gradient-to-r from-[#ef4444] to-amber-500 transition-all duration-300 shadow-[0_0_12px_#ef4444]"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        {uploadStatus === 'error' && (
          <div className="text-red-300 text-xs max-w-sm bg-red-950/40 border border-red-500/35 rounded-xl px-3.5 py-2">
            {errorMessage}
          </div>
        )}

        {uploadStatus === 'success' && (
          <div className="text-emerald-400 text-xs font-extrabold tracking-wide">
            ¡Stems cargados exitosamente!
          </div>
        )}
      </div>
    </div>
  );
}
