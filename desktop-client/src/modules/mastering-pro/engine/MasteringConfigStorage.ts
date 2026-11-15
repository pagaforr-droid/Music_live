import type {
  MasteringDspChain,
  SurgicalOverrides,
} from '../types/mastering.types';

export interface MasteringConfigurationFile {
  schemaVersion: '1.0.0';
  savedAtIso: string;
  trackTitle: string;
  songId?: string;
  selectedPresetId: string;
  presetName: string;
  intensityPct: number;
  autoAdaptEnabled: boolean;
  kickBassSidechain: boolean;
  autoMakeupGainDb: number;
  detectedInputLufs: number;
  surgicalOverrides: SurgicalOverrides;
  effectiveDspChain: MasteringDspChain;
}

const STORAGE_KEY_ACTIVE = 'tandao_mastering_pro_active_config_v1';

/**
 * Guarda instantáneamente toda la configuración activa del módulo Mastering Pro
 * para garantizar que ningún cambio de EQ, Mid/Side, Compresión, Saturación,
 * Drum Layering o Escudo Forense se pierda al momento de exportar el audio.
 */
export function saveActiveMasteringConfigSnapshot(
  config: MasteringConfigurationFile
): MasteringConfigurationFile {
  try {
    const serialized = JSON.stringify(config);
    localStorage.setItem(STORAGE_KEY_ACTIVE, serialized);
    if (config.songId) {
      localStorage.setItem(`${STORAGE_KEY_ACTIVE}:${config.songId}`, serialized);
    }
  } catch {
    // Ignore storage quota errors in restricted environments
  }
  return config;
}

/**
 * Recupera la última configuración guardada en el módulo para inyectarla
 * directamente en el motor de renderizado OfflineAudioContext al exportar.
 */
export function loadActiveMasteringConfigSnapshot(
  songId?: string
): MasteringConfigurationFile | null {
  try {
    const raw =
      (songId && localStorage.getItem(`${STORAGE_KEY_ACTIVE}:${songId}`)) ||
      localStorage.getItem(STORAGE_KEY_ACTIVE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MasteringConfigurationFile;
    if (
      !parsed ||
      !parsed.effectiveDspChain ||
      !parsed.surgicalOverrides ||
      !parsed.selectedPresetId
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Descarga un archivo físico `.mastering.json` con toda la configuración
 * quirúrgica del módulo para respaldo o reutilización en otras pistas.
 */
export function downloadMasteringConfigJsonFile(
  config: MasteringConfigurationFile
): void {
  const cleanName =
    config.trackTitle
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_') || 'Master';
  const fileName = `${cleanName}_${config.selectedPresetId}.mastering.json`;
  const jsonString = JSON.stringify(config, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Lee y valida un archivo `.mastering.json` subido por el usuario.
 */
export async function parseMasteringConfigJsonFile(
  file: File
): Promise<MasteringConfigurationFile> {
  const text = await file.text();
  const parsed = JSON.parse(text) as MasteringConfigurationFile;
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !parsed.selectedPresetId ||
    !parsed.surgicalOverrides ||
    !parsed.effectiveDspChain
  ) {
    throw new Error(
      'El archivo seleccionado no es una configuración válida de Mastering Pro (.mastering.json).'
    );
  }
  return parsed;
}
