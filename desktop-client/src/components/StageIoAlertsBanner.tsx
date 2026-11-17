import React from 'react';
import { AlertTriangle, Bluetooth, Check, Music, ShieldAlert, Unplug } from 'lucide-react';
import { StagePatchAnalysis } from '../utils/liveConsoleDSP';

interface StageIoAlertsBannerProps {
  analysis: StagePatchAnalysis;
  detectedMaxChannels: number;
  fohPairLabel: string;
  activeDeviceLabel?: string;
  activeDeviceLatencyMs?: number;
  sinkStatus?: 'idle' | 'ok' | 'missing' | 'rejected';
  savedSinkLabel?: string;
  onResetToDefaultSink?: () => void;
  onTrustWiredDevice?: (deviceLabel: string) => void;
  compact?: boolean;
}

/**
 * Banner único de seguridad de escenario compartido entre StageSoundcheck y StageEqualizerConsole.
 */
export const StageIoAlertsBanner: React.FC<StageIoAlertsBannerProps> = ({
  analysis,
  detectedMaxChannels,
  fohPairLabel,
  activeDeviceLabel,
  activeDeviceLatencyMs,
  sinkStatus = 'ok',
  savedSinkLabel,
  onResetToDefaultSink,
  onTrustWiredDevice,
  compact = false,
}) => {
  const padCls = compact ? 'px-3 py-2 text-[11px]' : 'px-4 py-2.5 text-xs';

  return (
    <div className="space-y-2">
      {(sinkStatus === 'missing' || sinkStatus === 'rejected') && (
        <div className={`${padCls} rounded-xl bg-rose-50 border border-rose-300 text-rose-900 flex items-center justify-between gap-3`}>
          <div className="flex items-center gap-2 min-w-0">
            <Unplug size={15} className="text-[#e11d48] shrink-0" />
            <span>
              <strong>
                {sinkStatus === 'missing'
                  ? 'Interfaz USB guardada desconectada:'
                  : 'Salida de audio rechazada por el sistema:'}
              </strong>{' '}
              &ldquo;{savedSinkLabel || 'Dispositivo anterior'}&rdquo; no está respondiendo. El audio cayó al dispositivo predeterminado ({activeDeviceLabel || 'Sistema'}).
            </span>
          </div>
          {onResetToDefaultSink && (
            <button
              type="button"
              onClick={onResetToDefaultSink}
              className="px-2.5 py-1 rounded-lg bg-white border border-rose-300 hover:bg-rose-100 text-rose-800 text-[10px] font-bold shrink-0 cursor-pointer"
            >
              Confirmar Predeterminado
            </button>
          )}
        </div>
      )}

      {analysis.cueFohConflicts.length > 0 && (
        <div className={`${padCls} rounded-xl bg-rose-50 border border-rose-300 text-rose-900 flex items-center gap-2`}>
          <ShieldAlert size={15} className="text-[#e11d48] shrink-0" />
          <span>
            <strong>¡Alerta Crítica de Conflicto CUE vs FOH!</strong> Click/Guía comparte salida con música en:{' '}
            <strong>{analysis.cueFohConflicts.map((c) => `CH ${c.chNum}`).join(', ')}</strong>. Separa CUE a otro canal antes del show.
          </span>
        </div>
      )}

      {analysis.isBluetoothRisk && activeDeviceLabel && (
        <div className={`${padCls} rounded-xl bg-rose-50 border border-rose-300 text-rose-900 flex items-center justify-between gap-3`}>
          <div className="flex items-center gap-2 min-w-0">
            <Bluetooth size={15} className="text-[#e11d48] shrink-0" />
            <span>
              <strong>Advertencia de Latencia Inalámbrica/BT (~{activeDeviceLatencyMs ?? 0} ms):</strong>{' '}
              &ldquo;{activeDeviceLabel}&rdquo; parece inalámbrico. Usa cable USB o Jack para tocar a tiempo con Click.
            </span>
          </div>
          {onTrustWiredDevice && (
            <button
              type="button"
              onClick={() => onTrustWiredDevice(activeDeviceLabel)}
              className="px-2.5 py-1 rounded-lg bg-white border border-rose-300 hover:bg-rose-100 text-rose-800 text-[10px] font-bold shrink-0 cursor-pointer"
              title="Marca este dispositivo como interfaz cableada confiable para ocultar el aviso"
            >
              Es Cableado (Omitir)
            </button>
          )}
        </div>
      )}

      {analysis.outOfRangeIssues.length > 0 && (
        <div className={`${padCls} rounded-xl bg-amber-50 border border-amber-300 text-amber-900 flex items-center gap-2`}>
          <AlertTriangle size={15} className="text-amber-600 shrink-0" />
          <span>
            <strong>Canales fuera de rango ({detectedMaxChannels} Ch reales):</strong>{' '}
            {analysis.outOfRangeIssues.map((iss) => `${iss.busLabel} → ${iss.target}`).join(' · ')}.{' '}
            Live Concert ajustará esas salidas al límite 1–{detectedMaxChannels}.
          </span>
        </div>
      )}

      {analysis.isFallbackSplit && (
        <div className={`${padCls} rounded-xl bg-amber-50 border border-amber-300 text-amber-900 flex items-center gap-2`}>
          <AlertTriangle size={15} className="text-amber-600 shrink-0" />
          <span>
            <strong>Protección Split L/R Activa ({detectedMaxChannels} Ch):</strong> Con hardware menor a 4 canales se fuerza aislamiento{' '}
            <strong>L = Músicos (CUE), R = Público (FOH Mono)</strong> para evitar fugas de Click al PA.
          </span>
        </div>
      )}

      {analysis.isMultitrackFallbackToFoh && (
        <div className={`${padCls} rounded-xl bg-sky-50 border border-sky-200 text-sky-900 flex items-center gap-2`}>
          <Music size={14} className="text-sky-600 shrink-0" />
          <span>
            La canción seleccionada no tiene stems separados en Stem Studio; saldrá automáticamente por el respaldo <strong>FOH Estéreo ({fohPairLabel})</strong>.
          </span>
        </div>
      )}

      {compact &&
        analysis.preflightLevel === 'ready' &&
        !analysis.isMultitrackFallbackToFoh &&
        sinkStatus === 'ok' && (
          <div className={`${padCls} rounded-xl bg-emerald-50/70 border border-emerald-200 text-emerald-900 flex items-center gap-2`}>
            <Check size={14} className="text-emerald-600 shrink-0" />
            <span>
              <strong>Pre-Flight Limpio:</strong> Matriz verificada ({detectedMaxChannels} Ch disponibles) sin colisiones CUE/FOH.
            </span>
          </div>
        )}
    </div>
  );
};
