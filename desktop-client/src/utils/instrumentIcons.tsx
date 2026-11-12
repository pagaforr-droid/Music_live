import React from 'react';

export type InstrumentCategory =
  | 'drums'
  | 'bass'
  | 'electric_guitar'
  | 'acoustic_guitar'
  | 'guitar'
  | 'piano'
  | 'synth'
  | 'voice'
  | 'vocals'
  | 'master'
  | 'click'
  | 'cue'
  | 'other';

export interface InstrumentPreset {
  id: InstrumentCategory;
  label: string;
  shortLabel: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
  accentColor: string;
}

export const INSTRUMENT_PRESETS: InstrumentPreset[] = [
  {
    id: 'drums',
    label: 'Batería',
    shortLabel: 'Batería',
    badgeBg: 'bg-emerald-50',
    badgeText: 'text-emerald-700',
    badgeBorder: 'border-emerald-200/80',
    accentColor: '#10b981',
  },
  {
    id: 'bass',
    label: 'Bajo',
    shortLabel: 'Bajo',
    badgeBg: 'bg-cyan-50',
    badgeText: 'text-cyan-700',
    badgeBorder: 'border-cyan-200/80',
    accentColor: '#0891b2',
  },
  {
    id: 'electric_guitar',
    label: 'Guit. Eléctrica',
    shortLabel: 'Eléctrica',
    badgeBg: 'bg-indigo-50',
    badgeText: 'text-indigo-700',
    badgeBorder: 'border-indigo-200/80',
    accentColor: '#4f46e5',
  },
  {
    id: 'acoustic_guitar',
    label: 'Guit. Acústica',
    shortLabel: 'Acústica',
    badgeBg: 'bg-amber-50',
    badgeText: 'text-amber-700',
    badgeBorder: 'border-amber-200/80',
    accentColor: '#d97706',
  },
  {
    id: 'guitar',
    label: 'Guitarra',
    shortLabel: 'Guitarra',
    badgeBg: 'bg-violet-50',
    badgeText: 'text-violet-700',
    badgeBorder: 'border-violet-200/80',
    accentColor: '#7c3aed',
  },
  {
    id: 'piano',
    label: 'Piano',
    shortLabel: 'Piano',
    badgeBg: 'bg-sky-50',
    badgeText: 'text-sky-700',
    badgeBorder: 'border-sky-200/80',
    accentColor: '#0284c7',
  },
  {
    id: 'synth',
    label: 'Sintetizador',
    shortLabel: 'Synth',
    badgeBg: 'bg-fuchsia-50',
    badgeText: 'text-fuchsia-700',
    badgeBorder: 'border-fuchsia-200/80',
    accentColor: '#c026d3',
  },
  {
    id: 'voice',
    label: 'Voz',
    shortLabel: 'Voz',
    badgeBg: 'bg-rose-50',
    badgeText: 'text-rose-700',
    badgeBorder: 'border-rose-200/80',
    accentColor: '#e11d48',
  },
  {
    id: 'vocals',
    label: 'Voces / Coros',
    shortLabel: 'Voces',
    badgeBg: 'bg-orange-50',
    badgeText: 'text-orange-700',
    badgeBorder: 'border-orange-200/80',
    accentColor: '#ea580c',
  },
  {
    id: 'master',
    label: 'Master',
    shortLabel: 'Master',
    badgeBg: 'bg-amber-50',
    badgeText: 'text-amber-700',
    badgeBorder: 'border-amber-200/90',
    accentColor: '#f59e0b',
  },
  {
    id: 'click',
    label: 'Metrónomo',
    shortLabel: 'Clic',
    badgeBg: 'bg-sky-50',
    badgeText: 'text-sky-700',
    badgeBorder: 'border-sky-200/80',
    accentColor: '#0284c7',
  },
  {
    id: 'cue',
    label: 'Voz Guía',
    shortLabel: 'Guía',
    badgeBg: 'bg-rose-50',
    badgeText: 'text-rose-700',
    badgeBorder: 'border-rose-200/80',
    accentColor: '#e11d48',
  },
  {
    id: 'other',
    label: 'Otro',
    shortLabel: 'Pista',
    badgeBg: 'bg-slate-100',
    badgeText: 'text-slate-600',
    badgeBorder: 'border-slate-200/80',
    accentColor: '#475569',
  },
];

export const SELECTABLE_INSTRUMENT_PRESETS = INSTRUMENT_PRESETS.filter(
  (p) => p.id !== 'click' && p.id !== 'cue'
);

export function getInstrumentPreset(category: InstrumentCategory): InstrumentPreset {
  return INSTRUMENT_PRESETS.find((p) => p.id === category) || INSTRUMENT_PRESETS[INSTRUMENT_PRESETS.length - 1];
}

/**
 * Detección automática inteligente de instrumento basada en el nombre del stem y metadatos.
 * Respeta orden de especificidad (ej. Voces/Coros antes que Voz, Acústica/Eléctrica antes que Guitarra).
 */
export function detectInstrumentCategory(
  stemName: string,
  stemType?: string,
  isMaster?: boolean
): InstrumentCategory {
  const n = (stemName || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (stemType === 'Click' || /\b(click|clic|metronom|metr)\b/.test(n)) {
    return 'click';
  }
  if (stemType === 'Cues' || /\b(cue|cues|guia|guide)\b/.test(n)) {
    return 'cue';
  }
  if (isMaster || /\b(master|full\s*mix|mixdown)\b/.test(n)) {
    return 'master';
  }

  // Batería y percusión
  if (/(drum|bater|perc|kick|bombo|snare|caja|tarola|tom|hihat|hat|cymbal|plato|loop|kit)/.test(n)) {
    return 'drums';
  }

  // Bajo
  if (/(bass|bajo|sub|808)/.test(n)) {
    return 'bass';
  }

  // Guitarras (específicas primero)
  if (/(acous|acust|nylon|strum|\bag\b|\bag\d)/.test(n)) {
    return 'acoustic_guitar';
  }
  if (/(electr|elec|crunch|drive|overdrive|lead\s*g|\beg\b|\beg\d)/.test(n)) {
    return 'electric_guitar';
  }
  if (/(guitar|guit|gtr)/.test(n)) {
    return 'guitar';
  }

  // Pianos y teclados
  if (/(piano|grand|upright|rhodes|wurli|tecla|keys|keyb|\bep\b|\bpno\b)/.test(n)) {
    return 'piano';
  }

  // Sintetizadores, pads, órganos
  if (/(synth|sint|pad|arp|organ|brass|string|cuerda|atmos|lead\s*s|fx)/.test(n)) {
    return 'synth';
  }

  // Voces / Coros (plural antes que singular)
  if (/(voces|coro|coros|choir|bgv|back|armon|harmony|crowd)/.test(n)) {
    return 'vocals';
  }

  // Voz principal
  if (/(voz|vox|vocal|canta|singer|lead\s*v)/.test(n)) {
    return 'voice';
  }

  return 'other';
}

/**
 * Extrae el prefijo común repetido entre los nombres de pistas de una misma canción
 * (ej. "Cambia mi vida_bass" -> "Bass", "Cambia mi vida_guitar 2" -> "Guitar 2")
 * sin modificar jamás el nombre real guardado en Supabase o en el motor de audio.
 */
export function extractCleanTrackLabel(stemName: string, allStemNames: string[]): string {
  const trimmed = (stemName || '').trim();
  if (!trimmed) return 'Pista';

  // Filtrar nombres reales (excluir los sintéticos locales)
  const realNames = allStemNames
    .map((n) => (n || '').trim())
    .filter((n) => n && n !== 'Metrónomo IA' && n !== 'Voz Guía IA');

  let cleaned = trimmed;

  if (realNames.length >= 2 && trimmed !== 'Metrónomo IA' && trimmed !== 'Voz Guía IA') {
    // 1. Detectar prefijo dominante por separador (_ o - o |) aunque exista alguna pista sin prefijo
    const prefixCounts = new Map<string, { raw: string; count: number }>();
    for (const name of realNames) {
      const m = name.match(/^([^_\-|]{3,}[_\-|]\s*)/);
      if (m) {
        const key = m[1].toLowerCase();
        const entry = prefixCounts.get(key);
        prefixCounts.set(key, { raw: entry?.raw || m[1], count: (entry?.count || 0) + 1 });
      }
    }

    let dominantPrefix = '';
    let bestScore = 0;
    for (const entry of prefixCounts.values()) {
      if (entry.count >= 2 && entry.count * 100 + entry.raw.length > bestScore) {
        bestScore = entry.count * 100 + entry.raw.length;
        dominantPrefix = entry.raw;
      }
    }

    // 2. Fallback: prefijo común más largo entre pares si comparten >= 5 caracteres hasta espacio/separador
    if (!dominantPrefix) {
      const sorted = [...realNames].sort();
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      let i = 0;
      const minLen = Math.min(first.length, last.length);
      while (i < minLen && first[i].toLowerCase() === last[i].toLowerCase()) {
        i++;
      }
      const lcp = first.slice(0, i);
      const sepMatch = lcp.match(/^(.+?[_\-\s.|]+)/);
      if (sepMatch && sepMatch[1].length >= 5) {
        dominantPrefix = sepMatch[1];
      }
    }

    if (
      dominantPrefix &&
      trimmed.toLowerCase().startsWith(dominantPrefix.toLowerCase()) &&
      trimmed.length > dominantPrefix.length
    ) {
      cleaned = trimmed.slice(dominantPrefix.length);
    }
  }

  // Limpiar separadores sobrantes iniciales y guiones bajos
  cleaned = cleaned.replace(/^[_\-.\s|]+/, '').replace(/_/g, ' ').trim();
  if (!cleaned) return trimmed;

  // Capitalizar primera letra manteniendo números/siglas
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

interface InstrumentIconProps {
  category: InstrumentCategory;
  size?: number;
  className?: string;
}

/**
 * Iconos vectoriales minimalistas inspirados en Apple SF Symbols / Logic Pro.
 * Diseñados con trazos uniformes para máxima nitidez desde 15px hasta 24px.
 */
export const InstrumentSvgIcon: React.FC<InstrumentIconProps> = ({
  category,
  size = 17,
  className = '',
}) => {
  const commonProps = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.85,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
  };

  switch (category) {
    case 'drums':
      // Batería (bombo + toms/tarola + platillo)
      return (
        <svg {...commonProps}>
          <ellipse cx="12" cy="14.5" rx="6.5" ry="5" />
          <path d="M5.5 14.5v2.5c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-2.5" />
          <path d="M7.5 8.5l4-3.5" />
          <path d="M16.5 8.5l-4-3.5" />
          <path d="M3.5 9.5h5" />
          <path d="M15.5 9.5h5" />
          <circle cx="12" cy="14.5" r="1.5" />
        </svg>
      );

    case 'bass':
      // Bajo eléctrico (4 clavijas marcadas + cuerpo sólido alargado)
      return (
        <svg {...commonProps}>
          <path d="M15.5 3.5l5 5" />
          <path d="M17.5 6.5l-7.2 7.2" />
          <path d="M10.3 13.7a4.3 4.3 0 0 0-5.8.5c-1.5 1.5-1.4 4.1.3 5.7 1.6 1.7 4.2 1.8 5.7.3a4.3 4.3 0 0 0 .5-5.8z" />
          <path d="M6.8 16.5l1.2 1.2" />
          <circle cx="19.5" cy="4.5" r="0.8" fill="currentColor" />
          <circle cx="21" cy="6" r="0.8" fill="currentColor" />
        </svg>
      );

    case 'electric_guitar':
      // Guitarra eléctrica (silueta doble cutaway + mástil)
      return (
        <svg {...commonProps}>
          <path d="M18.5 3.5l2 2-1.5 1.5-2-2z" />
          <path d="M17 7l-6.2 6.2" />
          <path d="M11.2 12.8l-1.8-.4a3 3 0 0 0-3 1.2c-.9 1.2-.8 2.9.2 4.1 1.2 1 2.9 1.1 4.1.2a3 3 0 0 0 1.2-3l-.4-1.8z" />
          <path d="M8 15.5l1.4 1.4" />
          <path d="M14 4l1.5 1.5" />
        </svg>
      );

    case 'acoustic_guitar':
      // Guitarra acústica (caja resonante en ocho + boca central)
      return (
        <svg {...commonProps}>
          <path d="M17.5 3.5l3 3" />
          <path d="M19 5l-6.5 6.5" />
          <path d="M12.5 11.5c-1.4-1.2-3.5-1-4.7.3-.9 1-.9 2.3-.3 3.4-.9 1-1 2.7.1 3.9 1.3 1.3 3.4 1.2 4.7-.1.7-.7 1-1.6 1-2.5.9 0 1.8-.3 2.4-1 1.1-1.2.9-3.1-.3-4.1" />
          <circle cx="9.8" cy="15.2" r="1.4" />
        </svg>
      );

    case 'guitar':
      // Guitarra genérica (púa / clavijero + cuerpo)
      return (
        <svg {...commonProps}>
          <path d="M16.5 4.5l3 3" />
          <path d="M18 6l-7 7" />
          <circle cx="8.5" cy="15.5" r="4.2" />
          <circle cx="8.5" cy="15.5" r="1.2" />
        </svg>
      );

    case 'piano':
      // Piano (teclado con teclas negras)
      return (
        <svg {...commonProps}>
          <rect x="3" y="5" width="18" height="14" rx="2.5" />
          <path d="M9 5v14" />
          <path d="M15 5v14" />
          <path d="M7.2 5v8h2.6V5" fill="currentColor" stroke="none" />
          <path d="M14.2 5v8h2.6V5" fill="currentColor" stroke="none" />
        </svg>
      );

    case 'synth':
      // Sintetizador (onda sinusoidal + perillas/sliders de modulación)
      return (
        <svg {...commonProps}>
          <rect x="3" y="5" width="18" height="14" rx="2.5" />
          <path d="M6 12c1.2-3.2 2.6-3.2 3.8 0s2.6 3.2 3.8 0 2.6-3.2 3.8 0" />
          <circle cx="7.5" cy="16.2" r="0.8" fill="currentColor" />
          <circle cx="12" cy="16.2" r="0.8" fill="currentColor" />
          <circle cx="16.5" cy="16.2" r="0.8" fill="currentColor" />
        </svg>
      );

    case 'voice':
      // Voz principal (micrófono de estudio limpio)
      return (
        <svg {...commonProps}>
          <rect x="9" y="3" width="6" height="10" rx="3" />
          <path d="M6 10.5a6 6 0 0 0 12 0" />
          <path d="M12 16.5V21" />
          <path d="M8.5 21h7" />
        </svg>
      );

    case 'vocals':
      // Voces / Coros (dos micrófonos o dos siluetas vocales en armonía)
      return (
        <svg {...commonProps}>
          <rect x="5" y="4" width="4.5" height="8" rx="2.25" />
          <path d="M3.5 10a3.75 3.75 0 0 0 7.5 0" />
          <path d="M7.25 13.75V19" />
          <rect x="14.5" y="6" width="4.5" height="8" rx="2.25" />
          <path d="M13 12a3.75 3.75 0 0 0 7.5 0" />
          <path d="M16.75 15.75V20" />
        </svg>
      );

    case 'master':
      // Master (estrella/disco estéreo)
      return (
        <svg {...commonProps}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5l1.3 2.8 3 .4-2.2 2.1.5 3-2.6-1.4-2.6 1.4.5-3-2.2-2.1 3-.4z" />
        </svg>
      );

    case 'click':
      // Metrónomo clásico
      return (
        <svg {...commonProps}>
          <path d="M6 20l3.5-15h5L18 20H6z" />
          <path d="M12 16l4.5-7.5" />
          <circle cx="15.2" cy="10.5" r="1" fill="currentColor" />
        </svg>
      );

    case 'cue':
      // Voz Guía (ondas sonoras / talkback)
      return (
        <svg {...commonProps}>
          <path d="M4 10v4" />
          <path d="M8 7v10" />
          <path d="M12 4v16" />
          <path d="M16 8v8" />
          <path d="M20 10v4" />
        </svg>
      );

    default:
      // Pista genérica (nota musical)
      return (
        <svg {...commonProps}>
          <path d="M9 17.5V6l10-2v11.5" />
          <circle cx="6.5" cy="17.5" r="2.5" />
          <circle cx="16.5" cy="15.5" r="2.5" />
        </svg>
      );
  }
};
