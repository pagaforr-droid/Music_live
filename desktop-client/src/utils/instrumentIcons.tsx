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
  | 'percussion'
  | 'brass'
  | 'strings'
  | 'accordion'
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
    badgeBg: 'bg-emerald-50/90',
    badgeText: 'text-emerald-800',
    badgeBorder: 'border-emerald-200/90',
    accentColor: '#10b981',
  },
  {
    id: 'bass',
    label: 'Bajo',
    shortLabel: 'Bajo',
    badgeBg: 'bg-cyan-50/90',
    badgeText: 'text-cyan-800',
    badgeBorder: 'border-cyan-200/90',
    accentColor: '#0891b2',
  },
  {
    id: 'electric_guitar',
    label: 'Guit. Eléctrica',
    shortLabel: 'Eléctrica',
    badgeBg: 'bg-indigo-50/90',
    badgeText: 'text-indigo-800',
    badgeBorder: 'border-indigo-200/90',
    accentColor: '#4f46e5',
  },
  {
    id: 'acoustic_guitar',
    label: 'Guit. Acústica',
    shortLabel: 'Acústica',
    badgeBg: 'bg-amber-50/90',
    badgeText: 'text-amber-800',
    badgeBorder: 'border-amber-200/90',
    accentColor: '#d97706',
  },
  {
    id: 'guitar',
    label: 'Guitarra',
    shortLabel: 'Guitarra',
    badgeBg: 'bg-violet-50/90',
    badgeText: 'text-violet-800',
    badgeBorder: 'border-violet-200/90',
    accentColor: '#7c3aed',
  },
  {
    id: 'piano',
    label: 'Piano',
    shortLabel: 'Piano',
    badgeBg: 'bg-sky-50/90',
    badgeText: 'text-sky-800',
    badgeBorder: 'border-sky-200/90',
    accentColor: '#0284c7',
  },
  {
    id: 'synth',
    label: 'Sintetizador',
    shortLabel: 'Synth',
    badgeBg: 'bg-fuchsia-50/90',
    badgeText: 'text-fuchsia-800',
    badgeBorder: 'border-fuchsia-200/90',
    accentColor: '#c026d3',
  },
  {
    id: 'voice',
    label: 'Voz',
    shortLabel: 'Voz',
    badgeBg: 'bg-rose-50/90',
    badgeText: 'text-rose-800',
    badgeBorder: 'border-rose-200/90',
    accentColor: '#e11d48',
  },
  {
    id: 'vocals',
    label: 'Voces / Coros',
    shortLabel: 'Voces',
    badgeBg: 'bg-orange-50/90',
    badgeText: 'text-orange-800',
    badgeBorder: 'border-orange-200/90',
    accentColor: '#ea580c',
  },
  {
    id: 'percussion',
    label: 'Percusión',
    shortLabel: 'Perc',
    badgeBg: 'bg-teal-50/90',
    badgeText: 'text-teal-800',
    badgeBorder: 'border-teal-200/90',
    accentColor: '#0d9488',
  },
  {
    id: 'brass',
    label: 'Metales / Sax',
    shortLabel: 'Metales',
    badgeBg: 'bg-yellow-50/90',
    badgeText: 'text-yellow-800',
    badgeBorder: 'border-yellow-200/90',
    accentColor: '#ca8a04',
  },
  {
    id: 'strings',
    label: 'Cuerdas',
    shortLabel: 'Cuerdas',
    badgeBg: 'bg-purple-50/90',
    badgeText: 'text-purple-800',
    badgeBorder: 'border-purple-200/90',
    accentColor: '#9333ea',
  },
  {
    id: 'accordion',
    label: 'Acordeón',
    shortLabel: 'Acordeón',
    badgeBg: 'bg-lime-50/90',
    badgeText: 'text-lime-800',
    badgeBorder: 'border-lime-200/90',
    accentColor: '#65a30d',
  },
  {
    id: 'master',
    label: 'Master',
    shortLabel: 'Master',
    badgeBg: 'bg-amber-50/90',
    badgeText: 'text-amber-800',
    badgeBorder: 'border-amber-200/90',
    accentColor: '#f59e0b',
  },
  {
    id: 'click',
    label: 'Metrónomo',
    shortLabel: 'Clic',
    badgeBg: 'bg-sky-50/90',
    badgeText: 'text-sky-800',
    badgeBorder: 'border-sky-200/90',
    accentColor: '#0284c7',
  },
  {
    id: 'cue',
    label: 'Voz Guía',
    shortLabel: 'Guía',
    badgeBg: 'bg-rose-50/90',
    badgeText: 'text-rose-800',
    badgeBorder: 'border-rose-200/90',
    accentColor: '#e11d48',
  },
  {
    id: 'other',
    label: 'Otro',
    shortLabel: 'Pista',
    badgeBg: 'bg-slate-100',
    badgeText: 'text-slate-700',
    badgeBorder: 'border-slate-200/90',
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

  if (/(drum|bater|kick|bombo|snare|caja|tarola|tom|hihat|cymbal|plato|kit)/.test(n)) {
    return 'drums';
  }
  if (/(perc|conga|bongo|timbal|pander|tambourine|shaker|maraca|loop)/.test(n)) {
    return 'percussion';
  }
  if (/(bass|bajo|sub|808)/.test(n)) {
    return 'bass';
  }
  if (/(acous|acust|nylon|strum|\bag\b|\bag\d)/.test(n)) {
    return 'acoustic_guitar';
  }
  if (/(electr|elec|crunch|drive|overdrive|lead\s*g|\beg\b|\beg\d)/.test(n)) {
    return 'electric_guitar';
  }
  if (/(guitar|guit|gtr)/.test(n)) {
    return 'guitar';
  }
  if (/(acord|accord|bandoneon)/.test(n)) {
    return 'accordion';
  }
  if (/(piano|grand|upright|rhodes|wurli|tecla|keys|keyb|\bep\b|\bpno\b)/.test(n)) {
    return 'piano';
  }
  if (/(synth|sint|pad|arp|organ|atmos|lead\s*s|fx)/.test(n)) {
    return 'synth';
  }
  if (/(brass|metal|sax|tromp|tromb|horn|flaut|flute|wind)/.test(n)) {
    return 'brass';
  }
  if (/(string|cuerda|violin|cello|chelo|viola|orq|orch)/.test(n)) {
    return 'strings';
  }
  if (/(voces|coro|coros|choir|bgv|back|armon|harmony|crowd)/.test(n)) {
    return 'vocals';
  }
  if (/(voz|vox|vocal|canta|singer|lead\s*v)/.test(n)) {
    return 'voice';
  }

  return 'other';
}

/**
 * Extrae el prefijo común repetido entre los nombres de pistas de una misma canción
 * (ej. "Cambia mi vida_bass" -> "Bass") sin modificar jamás el nombre real en DB/AudioEngine.
 */
export function extractCleanTrackLabel(stemName: string, allStemNames: string[]): string {
  const trimmed = (stemName || '').trim();
  if (!trimmed) return 'Pista';

  const realNames = allStemNames
    .map((n) => (n || '').trim())
    .filter((n) => n && n !== 'Metrónomo IA' && n !== 'Voz Guía IA');

  let cleaned = trimmed;

  if (realNames.length >= 2 && trimmed !== 'Metrónomo IA' && trimmed !== 'Voz Guía IA') {
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

  cleaned = cleaned.replace(/^[_\-.\s|]+/, '').replace(/_/g, ' ').trim();
  if (!cleaned) return trimmed;

  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

interface InstrumentIconProps {
  category: InstrumentCategory;
  size?: number;
  className?: string;
}

/**
 * Iconos vectoriales en silueta sólida (estilo Apple Logic Pro / referencia visual de instrumentos),
 * construidos con geometría exacta y recortes transparentes evenodd para lucir nítidos en gran tamaño.
 */
export const InstrumentSvgIcon: React.FC<InstrumentIconProps> = ({
  category,
  size = 28,
  className = '',
}) => {
  const svgProps = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'currentColor',
    className,
  };

  switch (category) {
    case 'piano':
      // Piano de Cola sólido (Fila 1 Col 1)
      return (
        <svg {...svgProps}>
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M3 8.2C3 4.7 5.7 2.4 9.3 2.4c2.3 0 3.6 1 4.8 2.4 1.1 1.3 2.3 1.8 3.8 2.1 1.8.3 3.1 1.6 3.1 3.6V20c0 .9-.7 1.6-1.6 1.6H4.6c-.9 0-1.6-.7-1.6-1.6V8.2zm1.8 6.1v5.5h14.4v-5.5H4.8z"
          />
          <rect x="6.6" y="14.1" width="1.6" height="3.4" rx="0.25" />
          <rect x="9.3" y="14.1" width="1.6" height="3.4" rx="0.25" />
          <rect x="13.0" y="14.1" width="1.6" height="3.4" rx="0.25" />
          <rect x="15.8" y="14.1" width="1.6" height="3.4" rx="0.25" />
          <rect x="8.4" y="17.5" width="0.65" height="2.4" />
          <rect x="11.65" y="14.2" width="0.65" height="5.7" />
          <rect x="15.0" y="17.5" width="0.65" height="2.4" />
        </svg>
      );

    case 'synth':
      // Teclado / Sintetizador sólido (Fila 1 Col 3)
      return (
        <svg {...svgProps}>
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M2.2 7c0-1.1.9-2 2-2h15.6c1.1 0 2 .9 2 2v10c0 1.1-.9 2-2 2H4.2c-1.1 0-2-.9-2-2V7zm1.9 4.2v6h15.8v-6H4.1zM6 8.1a.9.9 0 1 0 1.8 0 .9.9 0 1 0-1.8 0zm3.3 0a.9.9 0 1 0 1.8 0 .9.9 0 1 0-1.8 0zm3.3 0a.9.9 0 1 0 1.8 0 .9.9 0 1 0-1.8 0z"
          />
          <rect x="6.1" y="11" width="1.7" height="3.7" rx="0.25" />
          <rect x="9.0" y="11" width="1.7" height="3.7" rx="0.25" />
          <rect x="13.1" y="11" width="1.7" height="3.7" rx="0.25" />
          <rect x="16.0" y="11" width="1.7" height="3.7" rx="0.25" />
          <rect x="11.6" y="11.2" width="0.7" height="6" />
        </svg>
      );

    case 'drums':
      // Kit completo de Batería sólido (Fila 3 Col 7: bombo con aro + tom + 2 platillos)
      return (
        <svg {...svgProps}>
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M14.1 11.2a4.6 4.6 0 1 0 0 9.2 4.6 4.6 0 0 0 0-9.2zm0 2.1a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z"
          />
          <rect x="11.4" y="19.8" width="5.4" height="1.5" rx="0.7" />
          <rect x="5.3" y="10.2" width="4.4" height="3.7" rx="0.7" />
          <rect x="6.85" y="13.9" width="1.35" height="7" rx="0.5" />
          <path d="M2 6.6l6.7 1.3-.3 1.3-6.7-1.3z" />
          <rect x="4.5" y="7.9" width="1.3" height="13" rx="0.5" />
          <path d="M5.1 17.6L2.4 20.9H4l1.8-2.3z" />
          <path d="M15.3 7.9L22 6.4l.3 1.3-6.7 1.5z" />
          <rect x="18.2" y="7.7" width="1.3" height="13.2" rx="0.5" />
          <path d="M18.9 17.6l2.7 3.3H20l-1.8-2.3z" />
        </svg>
      );

    case 'percussion':
      // Tambor sólido con 2 baquetas (Fila 1 Col 4: cabezas y varillas visibles sobre parche + mangos salientes)
      return (
        <svg {...svgProps}>
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M12 3.2a7.4 7.4 0 1 0 0 14.8 7.4 7.4 0 0 0 0-14.8zM9.6 8.4a1.35 1.35 0 1 0 0 2.7 1.35 1.35 0 0 0 0-2.7zm4.8 0a1.35 1.35 0 1 0 0 2.7 1.35 1.35 0 0 0 0-2.7zM9 10.6l-2.6 5.3.9.45 2.6-5.3-.9-.45zm6 0l2.6 5.3-.9.45-2.6-5.3.9-.45z"
          />
          {/* Mangos exteriores de las baquetas */}
          <path d="M6.4 15.9l-2.3 4.5a.85.85 0 0 0 1.5.75l2.3-4.5z" />
          <path d="M17.6 15.9l2.3 4.5a.85.85 0 0 1-1.5.75l-2.3-4.5z" />
        </svg>
      );

    case 'acoustic_guitar':
      // Guitarra Acústica sólida (Fila 1 Col 7: cuerpo en ocho con boca redonda, inclinada 42°)
      return (
        <svg {...svgProps}>
          <g transform="rotate(42 12 12)">
            {/* Clavijero y mástil */}
            <rect x="10.4" y="1.4" width="3.2" height="2.6" rx="0.7" />
            <rect x="11.1" y="3.8" width="1.8" height="6.8" />
            {/* Cuerpo acústico en ocho con boca y puente recortados */}
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M11.1 9.8c-1.8 0-3 1.3-3 2.8 0 1 .4 1.6 1 2-.9.8-1.9 1.9-1.9 3.6 0 2.3 2 3.9 4.8 3.9s4.8-1.6 4.8-3.9c0-1.7-1-2.8-1.9-3.6.6-.4 1-1 1-2 0-1.5-1.2-2.8-3-2.8h-1.8zm.9 2.4a1.65 1.65 0 1 0 0 3.3 1.65 1.65 0 0 0 0-3.3zm-1.6 5.5h3.2v.9h-3.2v-.9z"
            />
          </g>
        </svg>
      );

    case 'electric_guitar':
      // Guitarra Eléctrica doble cutaway sólida (Fila 4 Col 1: Stratocaster inclinada 42°)
      return (
        <svg {...svgProps}>
          <g transform="rotate(42 12 12)">
            {/* Clavijero asimétrico Stratocaster */}
            <path d="M11.1 1.4l2.1.4c.5.1.8.6.6 1.2l-.7 1.2H11.1V1.4z" />
            {/* Mástil */}
            <rect x="11.2" y="4" width="1.6" height="7" />
            {/* Cuerpo doble cutaway con 2 pastillas recortadas */}
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M11.2 10.6c-.8-.9-1.7-1.4-2.3-.9-.6.5-.3 2 .2 3 .3.7.2 1.3-.3 1.9-.9 1-1.5 2-1.5 3.4 0 2.2 1.8 3.9 4.7 3.9s4.7-1.7 4.7-3.9c0-1.4-.6-2.5-1.4-3.4-.5-.6-.6-1.2-.3-1.9.4-.9.7-2.1.1-2.5-.6-.4-1.5.2-2.3 1l-1.6-.6zm-1 3.7h3.6v1h-3.6v-1zm0 2.3h3.6v1h-3.6v-1z"
            />
          </g>
        </svg>
      );

    case 'bass':
      // Bajo Eléctrico sólido: clavijero ancho con 4 clavijas pronunciadas + mástil largo + cuerpo Jazz/Precision
      return (
        <svg {...svgProps}>
          <g transform="rotate(42 12 12)">
            {/* 4 clavijas bien marcadas de Bajo */}
            <circle cx="9.8" cy="1.9" r="0.8" />
            <circle cx="9.8" cy="3.5" r="0.8" />
            <circle cx="14.2" cy="1.9" r="0.8" />
            <circle cx="14.2" cy="3.5" r="0.8" />
            <rect x="10.7" y="1.3" width="2.6" height="2.8" rx="0.6" />
            {/* Mástil */}
            <rect x="11.1" y="3.9" width="1.8" height="7.4" />
            {/* Cuerpo robusto de Bajo con pastillas split-coil */}
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M11.1 10.7c-.9-1.2-2-1.7-2.6-1.1-.6.6-.2 2.2.3 3.3.3.7.2 1.3-.4 1.9-1 1.1-1.4 2.2-1.2 3.8.3 2.1 2.2 3.6 4.8 3.6 2.8 0 4.8-1.6 4.8-4 0-1.4-.6-2.4-1.5-3.2-.6-.5-.7-1.1-.4-1.9.4-1 .6-2 0-2.4-.7-.4-1.5.2-2.1 1l-1.7-.9zm-.9 4.1h1.7v1.1h-1.7v-1.1zm1.9.8h1.7v1.1h-1.7v-1.1zm-1.9 2.2h3.6v.9h-3.6v-.9z"
            />
          </g>
        </svg>
      );

    case 'guitar':
      // Guitarra sólida single-cutaway / clásica (Fila 2 Col 1)
      return (
        <svg {...svgProps}>
          <g transform="rotate(42 12 12)">
            <rect x="10.6" y="1.5" width="2.8" height="2.5" rx="0.6" />
            <rect x="11.15" y="3.8" width="1.7" height="7" />
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M11.1 10.2c-1.8.2-3 1.6-2.8 3.3.1.8.4 1.4.2 2-.6 1-1.2 2.1-1 3.4.3 2 2.1 3.3 4.5 3.3s4.3-1.4 4.5-3.5c.1-1.3-.4-2.3-1.1-3.2-.3-.5-.3-1.1 0-1.7.4-.9.7-2 .1-2.5-.6-.5-1.5 0-2.5.7l-1.9-1.8zm.9 3.6a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5zm-1.5 4.1h3v.9h-3v-.9z"
            />
          </g>
        </svg>
      );

    case 'voice':
      // Voz Principal sólida (Fila 1 Col 2: perfil humano cantando + ondas de voz)
      return (
        <svg {...svgProps}>
          <path d="M9.6 3.5c-3.3 0-6 2.7-6 6 0 1.9.9 3.6 2.3 4.7V20.2l5.7-1.3c.6-.7 1-1.5 1-2.5v-.5h1.2c.7 0 1.2-.5 1.2-1.1 0-.3-.1-.6-.4-.8l.7-1c.2-.3.2-.7 0-1l-1-1.6c.3-.6.4-1.2.4-1.9 0-2.9-2.2-5-5.1-5z" />
          <path d="M16.9 9.1c.6.8.6 2 0 2.8a1 1 0 0 0 1.6 1.2c1.1-1.5 1.1-3.7 0-5.2a1 1 0 0 0-1.6 1.2z" />
          <path d="M19.4 6.8c1.5 2.1 1.5 5.3 0 7.4a1 1 0 1 0 1.6 1.2c2.1-2.8 2.1-7 0-9.8a1 1 0 1 0-1.6 1.2z" />
        </svg>
      );

    case 'vocals':
      // Voces / Coros (dos cabezas cantando en armonía + ondas de voz)
      return (
        <svg {...svgProps}>
          <path
            fillOpacity="0.45"
            d="M6.4 3.5C4 3.5 2 5.5 2 8c0 1.5.7 2.8 1.8 3.6V17l4.2-.9c.4-.5.6-1.1.6-1.9v-.4h.9c.5 0 .9-.4.9-.9l-.2-.6.5-.8c.2-.2.2-.5 0-.8l-.7-1.1c.2-.4.3-.9.3-1.4 0-2.2-1.7-4.7-3.9-4.7z"
          />
          <path d="M11.6 5.9c-2.8 0-5 2.2-5 5 0 1.6.7 3 1.9 4v4.9l4.9-1c.5-.6.9-1.3.9-2.1v-.5h1c.6 0 1-.4 1-1 0-.3-.1-.5-.3-.7l.6-.8c.2-.3.2-.6 0-.9l-.8-1.3c.2-.5.3-1 .3-1.6 0-2.5-1.9-5-4.5-5z" />
          <path d="M18.1 10.6c.5.7.5 1.8 0 2.5a.9.9 0 0 0 1.5 1.1c.9-1.3.9-3.4 0-4.7a.9.9 0 0 0-1.5 1.1z" />
          <path d="M20.3 8.8c1.2 1.7 1.2 4.4 0 6.1a.9.9 0 1 0 1.4 1.1c1.7-2.4 1.7-5.9 0-8.3a.9.9 0 1 0-1.4 1.1z" />
        </svg>
      );

    case 'brass':
      // Saxofón sólido (Fila 2 Col 6)
      return (
        <svg {...svgProps}>
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M6.2 4.8l1.3-1.8H10c1 0 1.8.8 1.8 1.8v10c0 .9.7 1.6 1.6 1.6s1.6-.7 1.6-1.6v-2.7l-1.5-1.3 5.7-1.9-1.1 4.4-.9-.3v2c0 2.5-2 4.5-4.5 4.5s-4.5-2-4.5-4.5V5.6H6.2v-.8zm4 2.9a.7.7 0 1 0 0 1.4.7.7 0 0 0 0-1.4zm0 2.6a.7.7 0 1 0 0 1.4.7.7 0 0 0 0-1.4zm0 2.6a.7.7 0 1 0 0 1.4.7.7 0 0 0 0-1.4z"
          />
        </svg>
      );

    case 'strings':
      // Violín / Chelo sólido con arco (Fila 1 Col 5 / Fila 3 Col 5)
      return (
        <svg {...svgProps}>
          <g transform="rotate(42 12 12)">
            <rect x="10.9" y="1.6" width="2.2" height="2.4" rx="0.6" />
            <rect x="11.35" y="3.8" width="1.3" height="6.6" />
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M11.3 9.8c-1.5.1-2.6 1.3-2.5 2.7.1.8.4 1.4.1 2-.6.9-1.1 1.9-1 3.1.2 1.8 1.8 3.2 4.1 3.2s3.9-1.4 4.1-3.2c.1-1.2-.4-2.2-1-3.1-.3-.6 0-1.2.1-2 .1-1.4-1-2.6-2.5-2.7h-1.4zm-.9 3.9v2.2h.7v-2.2h-.7zm2.5 0v2.2h.7v-2.2h-.7z"
            />
          </g>
          {/* Arco diagonal cruzado */}
          <path d="M4.2 5.4l15.6 13.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );

    case 'accordion':
      // Acordeón sólido (Fila 2 Col 3)
      return (
        <svg {...svgProps}>
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M2.6 6.5c0-.8.7-1.5 1.5-1.5h3.7v14H4.1c-.8 0-1.5-.7-1.5-1.5v-11zm1.8 1.3v8.4h2V7.8h-2z"
          />
          <rect x="9.0" y="5.5" width="1.6" height="13" rx="0.4" />
          <rect x="11.4" y="5.5" width="1.6" height="13" rx="0.4" />
          <rect x="13.8" y="5.5" width="1.6" height="13" rx="0.4" />
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M16.6 5h3.3c.8 0 1.5.7 1.5 1.5v11c0 .8-.7 1.5-1.5 1.5h-3.3V5zm2.4 3.4a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6zm0 2.9a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6zm0 2.9a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6z"
          />
        </svg>
      );

    case 'master':
      // Master sólido
      return (
        <svg {...svgProps}>
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M12 2.4a9.6 9.6 0 1 0 0 19.2 9.6 9.6 0 0 0 0-19.2zm0 4.2l1.6 3.2 3.5.5-2.5 2.5.6 3.5-3.2-1.7-3.2 1.7.6-3.5-2.5-2.5 3.5-.5L12 6.6z"
          />
        </svg>
      );

    case 'click':
      // Metrónomo sólido
      return (
        <svg {...svgProps}>
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M9.4 3.4h5.2c.8 0 1.5.5 1.7 1.3l3.2 13.7c.3 1.2-.6 2.3-1.8 2.3H6.3c-1.2 0-2.1-1.1-1.8-2.3L7.7 4.7c.2-.8.9-1.3 1.7-1.3zM12 16l4.6-6.8a.9.9 0 0 0-1.5-1l-3.8 5.6a1.5 1.5 0 0 0 .7 2.2z"
          />
        </svg>
      );

    case 'cue':
      // Voz Guía sólida (barras de voz)
      return (
        <svg {...svgProps}>
          <rect x="2.8" y="9.5" width="2.7" height="5" rx="1.35" />
          <rect x="7.0" y="6.2" width="2.7" height="11.6" rx="1.35" />
          <rect x="11.2" y="3.2" width="2.7" height="17.6" rx="1.35" />
          <rect x="15.4" y="6.8" width="2.7" height="10.4" rx="1.35" />
          <rect x="19.6" y="9.5" width="2.7" height="5" rx="1.35" />
        </svg>
      );

    default:
      // Nota musical sólida grande
      return (
        <svg {...svgProps}>
          <path d="M18.6 3.2l-9.2 1.9c-.6.1-1 .6-1 1.2v8.9a3.4 3.4 0 1 0 2 3V9.6l7.2-1.5v5.8a3.4 3.4 0 1 0 2 3V4.4c0-.7-.6-1.3-1-1.2z" />
        </svg>
      );
  }
};
