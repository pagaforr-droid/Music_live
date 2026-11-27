export type LyricWordRole = 'normal' | 'hero' | 'badge' | 'accent-script' | 'whisper';

export interface LyricWordTiming {
  word: string;
  startOffsetMs: number; // Offset in ms from line.startMs
  durationMs: number;
  role?: LyricWordRole; // Multi-scale typographic hierarchy (70/20/8/2 rule)
  customScale?: number; // Optional explicit scale multiplier (0.5..2.8)
  customColor?: string; // Optional per-word override color
}

export type LyricEffectType =
  | 'capcut-karaoke'
  | 'kinetic'
  | 'smooth-blur'
  | 'neon-stage'
  | 'stacked-impact'
  | 'chromatic-glow'
  | 'gradient-wipe'
  | 'glitch'
  | 'double-exposure'
  | 'write-on'
  | 'liquid'
  // Brutal FX (HyperFrames motion rules ported to the deterministic canvas renderer)
  | 'beat-slam'
  | 'decrypt'
  | 'depth-extrude'
  | 'waterfall'
  | 'luxe-chrome'
  | 'crash-zoom'
  | 'font-shuffle'
  // Studio AE / HyperFrames / Lemo-Opuscar Pro Catalog
  | 'ae-poster-spin'
  | 'hf-split-tape'
  | 'hf-kinetic-cascade'
  | 'knock-echo-matrix'
  | 'riso-pop-halftone'
  | 'neon-wet-street'
  | 'laser-cage-drop'
  | 'vhs-rec-freeze';

export type LyricFontFamily =
  | 'Montserrat'
  | 'Bebas Neue'
  | 'Outfit'
  | 'Playfair Display'
  | 'Roboto Slab'
  | 'Nexa Rust'
  | 'Northwell'
  // Luxury typography system
  | 'Anton'
  | 'Archivo Black'
  | 'Unbounded'
  | 'Bodoni Moda'
  | 'Fraunces'
  | 'Instrument Serif'
  | 'DM Serif Display'
  | 'Italiana'
  | 'Syncopate'
  | 'Space Grotesk'
  | 'Space Mono'
  | 'Monoton'
  | 'Kaushan Script'
  | 'Yellowtail';

export type LyricTextCase = 'upper' | 'title' | 'lower';

export type LyricLayoutMode =
  | 'smart-wrap'         // Classic optical multi-line wrap (default)
  | 'poster-stack'       // Multi-scale vertical poster block (BOBBY / AND BIG / APOCALYPSE)
  | 'split-anchor'       // Held left column + dynamic right torn-tape slot (CONTRE COURANT)
  | 'editorial-cascade'  // Asymmetric stair-stepped editorial cascade (intro-kinetic-cascade)
  | 'corner-frame';      // Giant hero center + 4-corner perimeter echo tickers (HEAD IS SPINNIN')

export type LyricTextTexture =
  | 'solid'              // Clean vector fill (default)
  | 'grunge-distress'    // Carbon/paper distressed texture inside letterforms
  | 'halftone-dots'      // 45° Ben-Day / Risograph halftone dots inside letterforms
  | 'metallic-bevel'     // 3D specular chrome/gold bevel with inner engraving
  | 'stroke-hollow';     // Editorial hollow outline with double rim

export type LyricCameraMotion =
  | 'static'             // Fixed stage camera (default for clean overlays)
  | 'cinema-drift'       // 2.5D Dolly Zoom & floating parallax drift (Build/Breathe/Resolve)
  | 'beat-punch'         // Elastic zoom punch + micro-tilt synced to song downbeats & BPM
  | 'whip-handoff';      // Directional whip-pan camera handoff between consecutive phrases

export interface LyricLine {
  id: string;
  text: string;
  sectionTag?: string;
  placed?: boolean; // undefined or true = placed on timeline; false = in lyric pool waiting to be dragged/tapped
  startMs: number;
  durationMs: number;
  effect: LyricEffectType;
  fontFamily: LyricFontFamily;
  fontSize?: number; // Base size in 1920x1080 canvas (default 110)
  positionX?: number; // Normalized 0.0 - 1.0 (default 0.5)
  positionY?: number; // Normalized 0.0 - 1.0 (default 0.5)
  primaryColor?: string; // Default '#ffffff'
  accentColor?: string; // Default '#ef4444' (TANDU Stage Red)
  words?: LyricWordTiming[];
  // Luxury typography controls (all optional — undefined reproduces the classic render)
  letterSpacing?: number; // Tracking in em (default: font preset tracking)
  textCase?: LyricTextCase; // Applied at draw time only (default 'upper')
  strokeWidth?: number; // Outline thickness in px at 1080p (default 0)
  fxIntensity?: number; // "Brutalidad" multiplier 0..2 (default 1)
  ghostText?: boolean; // Giant drifting ghost word behind the line
  // Pro Studio AE / HyperFrames / Lemo-Opuscar architecture (100% backward-compatible)
  layoutMode?: LyricLayoutMode;
  textTexture?: LyricTextTexture;
  cameraMotion?: LyricCameraMotion;
  autoHierarchy?: boolean; // Automatic 70/20/8/2 typographic hierarchy (Hero, Badge, Script, Whisper)
  secondaryFontFamily?: LyricFontFamily; // Contrast font for 'accent-script' words
  rhythmLocked?: boolean; // Word onsets quantized to musical beat subdivisions
}

export interface LyricEffectPreset {
  id: LyricEffectType;
  name: string;
  badge: string;
  description: string;
  previewGradient: string;
  defaultAccent: string;
  group?: 'classic' | 'brutal' | 'studio-ae';
  recommendedLayout?: LyricLayoutMode;
  recommendedTexture?: LyricTextTexture;
  recommendedCamera?: LyricCameraMotion;
}

export const LYRIC_EFFECT_PRESETS: LyricEffectPreset[] = [
  // ───────── STUDIO AE / CINE · Fiverr Pro + HyperFrames + Lemo-Opuscar ─────────
  {
    id: 'ae-poster-spin',
    name: 'Poster Grunge & Badges',
    badge: 'FIVERR PRO',
    description: 'Palabra Hero gigante con textura grunge, conectores en cajas [BADGE] superpuestas y 4 ecos perimetrales al BPM.',
    previewGradient: 'from-red-600/55 via-amber-500/25 to-black',
    defaultAccent: '#facc15',
    group: 'studio-ae',
    recommendedLayout: 'corner-frame',
    recommendedTexture: 'grunge-distress',
    recommendedCamera: 'beat-punch',
  },
  {
    id: 'hf-split-tape',
    name: 'Torn-Tape Brutalist',
    badge: 'HYPERFRAMES',
    description: 'Columna izquierda ancla inclinada (-3.5°) + cintas de papel rasgado que entran en latigazo y laten con el ritmo.',
    previewGradient: 'from-blue-600/50 via-lime-400/25 to-black',
    defaultAccent: '#5cf03a',
    group: 'studio-ae',
    recommendedLayout: 'split-anchor',
    recommendedTexture: 'solid',
    recommendedCamera: 'beat-punch',
  },
  {
    id: 'hf-kinetic-cascade',
    name: 'Editorial Cascade + Splash',
    badge: 'AFTER EFFECTS',
    description: 'Escalera multi-escala con mancha vectorial orgánica, palabra Hero en fuente de contraste y onda expansiva al clímax.',
    previewGradient: 'from-emerald-500/45 via-amber-400/25 to-black',
    defaultAccent: '#facc15',
    group: 'studio-ae',
    recommendedLayout: 'editorial-cascade',
    recommendedTexture: 'solid',
    recommendedCamera: 'cinema-drift',
  },
  {
    id: 'knock-echo-matrix',
    name: 'Knock Echo Matrix 16th',
    badge: 'RITMO 1/16',
    description: 'Titular geométrico expandido + matriz de micro-ecos apilados que disparan en semicorcheas sincronizadas al BPM.',
    previewGradient: 'from-teal-500/50 via-yellow-400/25 to-black',
    defaultAccent: '#fef08a',
    group: 'studio-ae',
    recommendedLayout: 'poster-stack',
    recommendedTexture: 'grunge-distress',
    recommendedCamera: 'beat-punch',
  },
  {
    id: 'riso-pop-halftone',
    name: 'Risograph Pop-Art Dots',
    badge: 'LEMO-OPUSCAR',
    description: 'Impresión por placas con trama de puntos Ben-Day a 45°, halo papel, keyline negro y golpe de registro en cada pulso.',
    previewGradient: 'from-rose-500/50 via-yellow-400/30 to-black',
    defaultAccent: '#ffd21f',
    group: 'studio-ae',
    recommendedLayout: 'poster-stack',
    recommendedTexture: 'halftone-dots',
    recommendedCamera: 'beat-punch',
  },
  {
    id: 'neon-wet-street',
    name: 'Glass Neon & Wet Mirror',
    badge: 'NEON TUBES',
    description: 'Tubo de vidrio con encendido físico (strike flicker), núcleo de gas real y reflejo invertido sobre asfalto húmedo.',
    previewGradient: 'from-cyan-400/50 via-fuchsia-600/30 to-black',
    defaultAccent: '#1ff2d9',
    group: 'studio-ae',
    recommendedLayout: 'smart-wrap',
    recommendedTexture: 'solid',
    recommendedCamera: 'cinema-drift',
  },
  {
    id: 'laser-cage-drop',
    name: 'Concert Laser Rig 6X',
    badge: 'LASER DROP',
    description: 'Dos haces láser convergen e incendian cada palabra al pulso; en el clímax se despliega una jaula de 6 láseres.',
    previewGradient: 'from-fuchsia-500/50 via-emerald-400/25 to-black',
    defaultAccent: '#38bdf8',
    group: 'studio-ae',
    recommendedLayout: 'poster-stack',
    recommendedTexture: 'metallic-bevel',
    recommendedCamera: 'beat-punch',
  },
  {
    id: 'vhs-rec-freeze',
    name: '90s VHS Tracking Slam',
    badge: 'REC FREEZE',
    description: 'Visor OSD de videocámara (● REC), franja RGB y golpe de 3 bandas de tracking cizalladas que encajan al beat.',
    previewGradient: 'from-red-500/45 via-cyan-500/25 to-black',
    defaultAccent: '#22d3ee',
    group: 'studio-ae',
    recommendedLayout: 'editorial-cascade',
    recommendedTexture: 'grunge-distress',
    recommendedCamera: 'whip-handoff',
  },
  // ───────── CLASSIC STAGE ─────────
  {
    id: 'capcut-karaoke',
    name: 'CapCut Karaoke Pro',
    badge: 'TOP SYNC',
    description: 'Resaltado activo palabra por palabra con física elástica y llenado de color.',
    previewGradient: 'from-red-600/40 via-red-500/20 to-black',
    defaultAccent: '#ef4444',
    group: 'classic',
  },
  {
    id: 'kinetic',
    name: 'Kinetic Stage Slam',
    badge: 'IMPACTO',
    description: 'Entrada explosiva con rebote spring por palabra, ideal para coros potentes.',
    previewGradient: 'from-rose-600/35 via-orange-500/15 to-black',
    defaultAccent: '#f43f5e',
    group: 'classic',
  },
  {
    id: 'smooth-blur',
    name: 'Cinematic Blur Reveal',
    badge: 'WORSHIP',
    description: 'Aparición etérea con desenfoque óptico progresivo y suavizado cinematográfico.',
    previewGradient: 'from-slate-500/30 via-zinc-700/20 to-black',
    defaultAccent: '#ffffff',
    group: 'classic',
  },
  {
    id: 'neon-stage',
    name: 'Neon Pulse Arena',
    badge: 'ARENA LED',
    description: 'Doble trazo luminoso con halo de neón sincronizado al pulso del escenario.',
    previewGradient: 'from-red-500/40 via-fuchsia-600/20 to-black',
    defaultAccent: '#ef4444',
    group: 'classic',
  },
  {
    id: 'stacked-impact',
    name: 'Stacked Poster 3D',
    badge: 'URBANO',
    description: 'Apila las palabras en bloques verticales de alto impacto visual estilo festival.',
    previewGradient: 'from-amber-500/35 via-red-600/20 to-black',
    defaultAccent: '#f59e0b',
    group: 'classic',
  },
  {
    id: 'chromatic-glow',
    name: 'Chromatic RGB Split',
    badge: 'FX',
    description: 'Separación de canales rojo/azul con vibración armónica de concierto.',
    previewGradient: 'from-cyan-500/30 via-red-500/30 to-black',
    defaultAccent: '#06b6d4',
    group: 'classic',
  },
  {
    id: 'gradient-wipe',
    name: 'Laser Wipe Sweep',
    badge: 'BARRIDO',
    description: 'Barrido horizontal de luz sobre texto metálico en alta definición.',
    previewGradient: 'from-emerald-500/30 via-teal-600/20 to-black',
    defaultAccent: '#10b981',
    group: 'classic',
  },
  {
    id: 'glitch',
    name: 'Cyber Glitch RGB',
    badge: 'ELECTRO',
    description: 'Jitter RGB cuantizado + cortes horizontales que convergen y resuelven nítido.',
    previewGradient: 'from-purple-600/35 via-red-500/25 to-black',
    defaultAccent: '#a855f7',
    group: 'classic',
  },
  // ───────── BRUTAL FX · HyperFrames motion rules (deterministic canvas ports) ─────────
  {
    id: 'beat-slam',
    name: 'Beat Slam Brutal',
    badge: 'BRUTAL',
    description: 'Cada palabra golpea con un eje distinto (escala+blur, latigazo, giro) y sacude el escenario.',
    previewGradient: 'from-orange-600/45 via-red-600/25 to-black',
    defaultAccent: '#ff5b2e',
    group: 'brutal',
  },
  {
    id: 'crash-zoom',
    name: 'Crash Zoom Impact',
    badge: 'DROP',
    description: 'Flash de impacto, líneas radiales de velocidad y entrada violenta desde 3x con ecos.',
    previewGradient: 'from-yellow-500/40 via-red-600/25 to-black',
    defaultAccent: '#facc15',
    group: 'brutal',
  },
  {
    id: 'decrypt',
    name: 'Hacker Decrypt 3D',
    badge: 'DECODE',
    description: 'Caracteres que giran en 3D barajando glifos hasta descifrar la palabra real.',
    previewGradient: 'from-emerald-500/40 via-lime-600/15 to-black',
    defaultAccent: '#22c55e',
    group: 'brutal',
  },
  {
    id: 'depth-extrude',
    name: '3D Depth Extrude',
    badge: 'POSTER 3D',
    description: 'Extrusión de 6 capas que crece al entrar y late al pulso del BPM.',
    previewGradient: 'from-pink-600/40 via-rose-600/20 to-black',
    defaultAccent: '#ec4899',
    group: 'brutal',
  },
  {
    id: 'waterfall',
    name: 'Waterfall Whip',
    badge: 'CASCADA',
    description: 'Las palabras suben en latigazo solapado, con peso según su longitud. Sin fundidos.',
    previewGradient: 'from-sky-500/40 via-blue-700/20 to-black',
    defaultAccent: '#38bdf8',
    group: 'brutal',
  },
  {
    id: 'luxe-chrome',
    name: 'Luxe Chrome Sweep',
    badge: 'LUJO',
    description: 'Banda especular metálica oro/cromo que barre el interior de las letras.',
    previewGradient: 'from-amber-400/45 via-yellow-700/20 to-black',
    defaultAccent: '#d4af37',
    group: 'brutal',
  },
  {
    id: 'font-shuffle',
    name: 'Font Shuffle Beat',
    badge: 'TIPO-RITMO',
    description: 'La frase se escribe palabra a palabra y la palabra clave cambia de fuente a cada beat.',
    previewGradient: 'from-fuchsia-500/40 via-violet-700/20 to-black',
    defaultAccent: '#d946ef',
    group: 'brutal',
  },
  {
    id: 'write-on',
    name: 'Write-On Outline Fill',
    badge: 'TRAZO',
    description: 'Se dibuja el contorno de cada palabra y se inunda de color de abajo hacia arriba.',
    previewGradient: 'from-teal-400/40 via-cyan-700/20 to-black',
    defaultAccent: '#2dd4bf',
    group: 'brutal',
  },
  {
    id: 'liquid',
    name: 'Liquid Wave',
    badge: 'FLUIDO',
    description: 'Ondulación líquida por carácter que se asienta al cantarse la palabra.',
    previewGradient: 'from-indigo-500/40 via-blue-600/20 to-black',
    defaultAccent: '#818cf8',
    group: 'brutal',
  },
  {
    id: 'double-exposure',
    name: 'Double Exposure',
    badge: 'CINE',
    description: 'Dos exposiciones desfasadas en escala y color que se funden en pantalla.',
    previewGradient: 'from-red-500/35 via-cyan-500/20 to-black',
    defaultAccent: '#f43f5e',
    group: 'brutal',
  },
];

export const LYRIC_LAYOUT_PRESETS: {
  id: LyricLayoutMode;
  label: string;
  badge: string;
  description: string;
}[] = [
  {
    id: 'smart-wrap',
    label: 'Smart Balance',
    badge: 'ESTÁNDAR',
    description: 'Renglones centrados con balance óptico y soporte para jerarquía de palabras.',
  },
  {
    id: 'poster-stack',
    label: 'Poster Multi-Escala',
    badge: 'FIVERR AE',
    description: 'Apila la frase en pisos verticales auto-escalados estilo póster (BOBBY / AND BIG / APOCALYPSE).',
  },
  {
    id: 'split-anchor',
    label: 'Split Anchor + Cintas',
    badge: 'BRUTALIST',
    description: 'Columna izquierda fija y cintas rasgadas dinámicas a la derecha (HyperFrames Contre Courant).',
  },
  {
    id: 'editorial-cascade',
    label: 'Cascada Editorial',
    badge: 'KINETIC',
    description: 'Escalera asimétrica con sangrías progresivas y palabra Hero sobredimensionada.',
  },
  {
    id: 'corner-frame',
    label: 'Hero + 4 Esquinas',
    badge: 'HEAD SPINNIN',
    description: 'Palabra principal gigante al centro, conectores en [BADGE] y ecos rítmicos en las 4 esquinas.',
  },
];

export const LYRIC_TEXTURE_PRESETS: {
  id: LyricTextTexture;
  label: string;
  badge: string;
  description: string;
}[] = [
  {
    id: 'solid',
    label: 'Sólido Nítido',
    badge: 'CLEAN',
    description: 'Relleno vectorial limpio de máximo contraste.',
  },
  {
    id: 'grunge-distress',
    label: 'Grunge / Carbón',
    badge: 'FIVERR',
    description: 'Textura desgastada de papel y tinta dentro del cuerpo de las letras.',
  },
  {
    id: 'halftone-dots',
    label: 'Halftone Ben-Day',
    badge: 'POP-ART',
    description: 'Trama de puntos de serigrafía/risografía a 45° dentro de los glifos.',
  },
  {
    id: 'metallic-bevel',
    label: 'Bisel Metálico 3D',
    badge: 'CROMO',
    description: 'Gradiente especular metálico con grabado interior y brillo al pulso.',
  },
  {
    id: 'stroke-hollow',
    label: 'Contorno Hueco',
    badge: 'OUTLINE',
    description: 'Tipografía transparente con doble trazo editorial luminoso.',
  },
];

export const LYRIC_CAMERA_PRESETS: {
  id: LyricCameraMotion;
  label: string;
  badge: string;
  description: string;
}[] = [
  {
    id: 'static',
    label: 'Estática (Fija)',
    badge: '0° LOCK',
    description: 'Sin movimiento global de cámara; ideal para subtítulos u overlays OBS.',
  },
  {
    id: 'cinema-drift',
    label: 'Dolly Zoom 2.5D',
    badge: 'CINE',
    description: 'Acercamiento progresivo (Build → Breathe → Resolve) con paralaje flotante.',
  },
  {
    id: 'beat-punch',
    label: 'Beat Punch & Tilt',
    badge: 'RITMO BPM',
    description: 'Empuje de cámara elástico en cada compás/pulso y micro-rotación rítmica.',
  },
  {
    id: 'whip-handoff',
    label: 'HyperCut Whip Pan',
    badge: 'VELOCIDAD',
    description: 'Entrada y salida por barrido lateral de cámara de alta velocidad entre frases.',
  },
];

export type LyricFontCategory = 'impact' | 'luxury' | 'tech' | 'script';

export interface LyricFontPreset {
  id: LyricFontFamily;
  label: string;
  sampleClass: string;
  category: LyricFontCategory;
  cssStack: string; // Canvas / CSS font-family stack
  weight: number; // REAL weight shipped by the font (no synthetic bold)
  italic?: boolean;
  tracking?: number; // Default letter-spacing in em
  defaultCase?: LyricTextCase;
}

export const LYRIC_FONT_PRESETS: LyricFontPreset[] = [
  // IMPACTO / ESCENARIO
  { id: 'Montserrat', label: 'Montserrat Black', sampleClass: 'font-sans font-black', category: 'impact', cssStack: '"Montserrat", "Inter", sans-serif', weight: 900, tracking: -0.02 },
  { id: 'Bebas Neue', label: 'Bebas Neue', sampleClass: 'tracking-wider font-bold', category: 'impact', cssStack: '"Bebas Neue", "Oswald", sans-serif', weight: 400, tracking: 0.02 },
  { id: 'Anton', label: 'Anton', sampleClass: '', category: 'impact', cssStack: '"Anton", "Bebas Neue", sans-serif', weight: 400, tracking: -0.01 },
  { id: 'Archivo Black', label: 'Archivo Black', sampleClass: '', category: 'impact', cssStack: '"Archivo Black", "Montserrat", sans-serif', weight: 400, tracking: -0.03 },
  { id: 'Unbounded', label: 'Unbounded Black', sampleClass: '', category: 'impact', cssStack: '"Unbounded", "Montserrat", sans-serif', weight: 900, tracking: -0.02 },
  { id: 'Outfit', label: 'Outfit Black', sampleClass: 'font-extrabold', category: 'impact', cssStack: '"Outfit", "Plus Jakarta Sans", sans-serif', weight: 900, tracking: -0.02 },
  // LUJO EDITORIAL
  { id: 'Bodoni Moda', label: 'Bodoni Moda (Fashion)', sampleClass: '', category: 'luxury', cssStack: '"Bodoni Moda", "Playfair Display", Georgia, serif', weight: 700, tracking: -0.01 },
  { id: 'Fraunces', label: 'Fraunces Black Italic', sampleClass: '', category: 'luxury', cssStack: '"Fraunces", Georgia, serif', weight: 900, italic: true, tracking: -0.02, defaultCase: 'title' },
  { id: 'Instrument Serif', label: 'Instrument Serif Italic', sampleClass: '', category: 'luxury', cssStack: '"Instrument Serif", Georgia, serif', weight: 400, italic: true, tracking: -0.01, defaultCase: 'title' },
  { id: 'DM Serif Display', label: 'DM Serif Display', sampleClass: '', category: 'luxury', cssStack: '"DM Serif Display", Georgia, serif', weight: 400, tracking: -0.01 },
  { id: 'Italiana', label: 'Italiana (Haute Couture)', sampleClass: '', category: 'luxury', cssStack: '"Italiana", "Playfair Display", serif', weight: 400, tracking: 0.12 },
  { id: 'Playfair Display', label: 'Playfair Display Italic', sampleClass: 'font-serif italic font-bold', category: 'luxury', cssStack: '"Playfair Display", Georgia, serif', weight: 900, italic: true, tracking: -0.01 },
  { id: 'Roboto Slab', label: 'Roboto Slab Black', sampleClass: 'font-serif font-black', category: 'luxury', cssStack: '"Roboto Slab", serif', weight: 900, tracking: -0.01 },
  // TECH / FUTURISTA
  { id: 'Syncopate', label: 'Syncopate Wide', sampleClass: '', category: 'tech', cssStack: '"Syncopate", "Unbounded", sans-serif', weight: 700, tracking: 0.08 },
  { id: 'Space Grotesk', label: 'Space Grotesk', sampleClass: '', category: 'tech', cssStack: '"Space Grotesk", "Inter", sans-serif', weight: 700, tracking: -0.03 },
  { id: 'Space Mono', label: 'Space Mono (Decrypt)', sampleClass: '', category: 'tech', cssStack: '"Space Mono", "JetBrains Mono", monospace', weight: 700, tracking: 0 },
  { id: 'Monoton', label: 'Monoton (Neón Retro)', sampleClass: '', category: 'tech', cssStack: '"Monoton", "Bebas Neue", sans-serif', weight: 400, tracking: 0.04 },
  // SCRIPT / FIRMA
  { id: 'Kaushan Script', label: 'Kaushan Script', sampleClass: '', category: 'script', cssStack: '"Kaushan Script", cursive', weight: 400, tracking: 0, defaultCase: 'title' },
  { id: 'Yellowtail', label: 'Yellowtail', sampleClass: '', category: 'script', cssStack: '"Yellowtail", cursive', weight: 400, tracking: 0, defaultCase: 'title' },
];

export const LYRIC_FONT_CATEGORIES: { id: LyricFontCategory; label: string }[] = [
  { id: 'impact', label: 'Impacto' },
  { id: 'luxury', label: 'Lujo' },
  { id: 'tech', label: 'Tech' },
  { id: 'script', label: 'Script' },
];

/** Resolves the font preset (falls back to Montserrat for legacy / unknown ids). */
export function getFontPreset(fontFamily?: string): LyricFontPreset {
  return (
    LYRIC_FONT_PRESETS.find((f) => f.id === fontFamily) ||
    LYRIC_FONT_PRESETS[0]
  );
}

/** Builds the exact CSS / canvas font shorthand using the font's REAL weight & style. */
export function buildFontString(fontFamily: string | undefined, sizePx: number): string {
  const p = getFontPreset(fontFamily);
  return `${p.italic ? 'italic ' : ''}${p.weight} ${Math.max(12, Math.round(sizePx))}px ${p.cssStack}`;
}

/** Applies draw-time capitalisation without mutating the stored text (word timings stay intact). */
export function applyTextCase(text: string, textCase: LyricTextCase = 'upper'): string {
  if (textCase === 'lower') return text.toLocaleLowerCase('es');
  if (textCase === 'title') {
    return text
      .toLocaleLowerCase('es')
      .replace(/(^|\s)(\S)/g, (_m, sp: string, ch: string) => sp + ch.toLocaleUpperCase('es'));
  }
  return text.toLocaleUpperCase('es');
}

// ─────────────────────────────────────────────────────────────────────────────
// MULTI-SCALE TYPOGRAPHIC HIERARCHY ENGINE (Embedded-Captions Rule #13: 70/20/8/2)
// ─────────────────────────────────────────────────────────────────────────────
const SHORT_CONNECTOR_WORDS = new Set([
  'A', 'AL', 'CON', 'DE', 'DEL', 'EL', 'EN', 'ES', 'LA', 'LAS', 'LO', 'LOS',
  'MI', 'MIS', 'NI', 'NO', 'O', 'POR', 'QUE', 'SE', 'SI', 'SIN', 'SU', 'SUS',
  'TE', 'TU', 'TUS', 'UN', 'UNA', 'Y', 'YA', 'YO',
  'AM', 'AN', 'AND', 'ARE', 'AS', 'AT', 'BE', 'BY', 'FOR', 'IN', 'IS', 'IT',
  'ME', 'MY', 'OF', 'ON', 'OR', 'SO', 'THE', 'TO', 'UP', 'US', 'WE',
]);

/**
 * Deterministically assigns multi-scale typographic roles ('normal' | 'hero' | 'badge' | 'accent-script' | 'whisper')
 * to the words of a phrase following the 70/20/8/2 rule and Fiverr After Effects poster conventions.
 */
export function assignAutoWordHierarchy(
  words: LyricWordTiming[],
  effect?: LyricEffectType
): LyricWordTiming[] {
  if (!words || words.length === 0) return [];
  if (words.length === 1) {
    return [{ ...words[0], role: words[0].role || 'hero' }];
  }

  // Find the strongest content word to promote as the primary HERO climax word
  let heroIdx = words.length - 1;
  let bestScore = -1;
  words.forEach((w, idx) => {
    const clean = w.word.replace(/[^A-ZÁÉÍÓÚÑ0-9]/gi, '').toUpperCase();
    const isConnector = SHORT_CONNECTOR_WORDS.has(clean);
    // Favor longer non-connector words, with a slight bias toward the end/climax of the phrase
    const score = (isConnector ? 0.5 : clean.length * 2.2) + (idx === words.length - 1 ? 2.5 : idx * 0.35);
    if (score > bestScore) {
      bestScore = score;
      heroIdx = idx;
    }
  });

  // Optional secondary expressive word for phrases with 5+ words
  let scriptIdx = -1;
  if (words.length >= 5) {
    let secondBest = -1;
    words.forEach((w, idx) => {
      if (idx === heroIdx || Math.abs(idx - heroIdx) <= 1) return;
      const clean = w.word.replace(/[^A-ZÁÉÍÓÚÑ0-9]/gi, '').toUpperCase();
      if (SHORT_CONNECTOR_WORDS.has(clean)) return;
      const score = clean.length * 1.8;
      if (score > secondBest) {
        secondBest = score;
        scriptIdx = idx;
      }
    });
  }

  const preferBadge =
    effect === 'ae-poster-spin' ||
    effect === 'hf-split-tape' ||
    effect === 'riso-pop-halftone' ||
    effect === 'vhs-rec-freeze';

  let badgeAssigned = false;

  return words.map((w, idx) => {
    const clean = w.word.replace(/[^A-ZÁÉÍÓÚÑ0-9]/gi, '').toUpperCase();
    const isConnector = SHORT_CONNECTOR_WORDS.has(clean) || clean.length <= 2;

    let role: LyricWordRole = 'normal';
    if (idx === heroIdx) {
      role = 'hero';
    } else if (idx === scriptIdx) {
      role = effect === 'hf-kinetic-cascade' ? 'accent-script' : 'hero';
    } else if (isConnector) {
      if (!badgeAssigned && (preferBadge || idx === heroIdx - 1 || idx === 1)) {
        role = 'badge';
        badgeAssigned = true;
      } else {
        role = 'whisper';
      }
    }

    return {
      ...w,
      role,
    };
  });
}

/**
 * Generates proportional word-level timings inside a line so every phrase
 * supports CapCut-style word-by-word highlight out of the box, preserving any user-assigned roles.
 */
export function computeWordTimings(
  text: string,
  totalDurationMs: number,
  existingWords?: LyricWordTiming[]
): LyricWordTiming[] {
  const cleanWords = text
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (cleanWords.length === 0) return [];

  // If existingWords match the exact word count and words (case-insensitive), scale them proportionally and preserve roles
  if (
    existingWords &&
    existingWords.length === cleanWords.length &&
    existingWords.every((w, i) => w.word.toUpperCase() === cleanWords[i].toUpperCase())
  ) {
    const lastEnd = existingWords.reduce(
      (max, w) => Math.max(max, w.startOffsetMs + w.durationMs),
      0
    );
    if (lastEnd > 0 && Math.abs(lastEnd - totalDurationMs) > 20) {
      const ratio = totalDurationMs / lastEnd;
      return existingWords.map((w, i) => ({
        ...w,
        word: cleanWords[i],
        startOffsetMs: Math.round(w.startOffsetMs * ratio),
        durationMs: Math.max(80, Math.round(w.durationMs * ratio)),
      }));
    }
    return existingWords.map((w, i) => ({ ...w, word: cleanWords[i] }));
  }

  // Weight each word slightly by character count (minimum weight 2) so short connectors ("DE", "Y") are faster than long words
  const weights = cleanWords.map((w) => Math.max(2, Math.min(12, w.length + 1)));
  const totalWeight = weights.reduce((acc, v) => acc + v, 0);
  const activeSpanMs = Math.max(200, totalDurationMs * 0.92); // Leave 8% tail hold on the final word

  let cursorMs = 0;
  return cleanWords.map((word, index) => {
    const prevRole = existingWords?.[index]?.role;
    const prevScale = existingWords?.[index]?.customScale;
    const prevColor = existingWords?.[index]?.customColor;
    const share = (weights[index] / totalWeight) * activeSpanMs;
    const durationMs =
      index === cleanWords.length - 1
        ? Math.max(100, Math.round(totalDurationMs - cursorMs))
        : Math.max(80, Math.round(share));
    const item: LyricWordTiming = {
      word,
      startOffsetMs: Math.round(cursorMs),
      durationMs,
      ...(prevRole ? { role: prevRole } : {}),
      ...(prevScale !== undefined ? { customScale: prevScale } : {}),
      ...(prevColor ? { customColor: prevColor } : {}),
    };
    cursorMs += share;
    return item;
  });
}

/**
 * RHYTHM-GUIDED WORD QUANTIZER:
 * Aligns every word inside a phrase to the song's musical subdivisions (beats, 8th notes, 16th notes)
 * and weights word onsets by real vocal waveform peak transients when available.
 */
export function quantizeLineWordsToRhythm(
  text: string,
  lineStartMs: number,
  lineDurationMs: number,
  bpm: number = 120,
  beatMarkers: BeatMarker[] = [],
  waveformPeaks: number[] = [],
  totalDurationMs: number = 180000,
  existingWords?: LyricWordTiming[],
  effect?: LyricEffectType
): LyricWordTiming[] {
  const baseWords = computeWordTimings(text, lineDurationMs, existingWords);
  if (baseWords.length <= 1) {
    return assignAutoWordHierarchy(baseWords, effect);
  }

  const safeBpm = bpm > 20 && bpm < 300 ? bpm : 120;
  const beatMs = 60000 / safeBpm;
  const sub8Ms = beatMs / 2;
  const sub16Ms = beatMs / 4;

  // Build local subdivision grid inside [0, lineDurationMs] relative to lineStartMs
  const localGrid: number[] = [0];
  const lineEndMs = lineStartMs + lineDurationMs;

  if (beatMarkers.length > 0) {
    const relevantBeats = beatMarkers.filter(
      (m) => m.timeMs >= lineStartMs - beatMs && m.timeMs <= lineEndMs + beatMs
    );
    for (let i = 0; i < relevantBeats.length; i++) {
      const b0 = relevantBeats[i].timeMs;
      const b1 = relevantBeats[i + 1]?.timeMs ?? b0 + beatMs;
      const step = (b1 - b0) / 4; // 16th-note subdivisions between real beats
      for (let s = 0; s < 4; s++) {
        const rel = Math.round(b0 + s * step - lineStartMs);
        if (rel > 40 && rel < lineDurationMs - 80) {
          localGrid.push(rel);
        }
      }
    }
  } else {
    for (let t = sub16Ms; t < lineDurationMs - 80; t += sub16Ms) {
      localGrid.push(Math.round(t));
    }
  }
  localGrid.sort((a, b) => a - b);

  // Sample local waveform energy weights per word if waveformPeaks exist
  const hasPeaks = waveformPeaks && waveformPeaks.length > 10 && totalDurationMs > 0;
  const snapWindowMs = Math.min(180, sub8Ms * 0.75);

  const snappedStarts: number[] = baseWords.map((w, idx) => {
    if (idx === 0) return 0;
    let targetOffset = w.startOffsetMs;

    // Look for a local vocal transient peak near targetOffset
    if (hasPeaks) {
      const absTargetMs = lineStartMs + targetOffset;
      const searchRadiusMs = Math.min(110, sub16Ms * 0.9);
      const idxStart = Math.max(
        0,
        Math.floor(((absTargetMs - searchRadiusMs) / totalDurationMs) * waveformPeaks.length)
      );
      const idxEnd = Math.min(
        waveformPeaks.length - 1,
        Math.ceil(((absTargetMs + searchRadiusMs) / totalDurationMs) * waveformPeaks.length)
      );
      let maxRise = -1;
      let bestPeakIdx = -1;
      for (let p = idxStart; p <= idxEnd; p++) {
        const prevAmp = p > 0 ? waveformPeaks[p - 1] : waveformPeaks[p];
        const rise = waveformPeaks[p] - prevAmp * 0.65;
        if (rise > maxRise) {
          maxRise = rise;
          bestPeakIdx = p;
        }
      }
      if (bestPeakIdx >= 0 && maxRise > 0.12) {
        const peakTimeMs = (bestPeakIdx / waveformPeaks.length) * totalDurationMs;
        const candidateOffset = Math.round(peakTimeMs - lineStartMs);
        if (candidateOffset > 40 && candidateOffset < lineDurationMs - 90) {
          targetOffset = Math.round(targetOffset * 0.45 + candidateOffset * 0.55);
        }
      }
    }

    // Snap to closest musical subdivision in localGrid
    let bestGrid = targetOffset;
    let minDiff = snapWindowMs;
    for (const g of localGrid) {
      const diff = Math.abs(g - targetOffset);
      if (diff <= minDiff) {
        minDiff = diff;
        bestGrid = g;
      }
    }
    return bestGrid;
  });

  // Enforce strictly monotonic start offsets with at least 80ms per word
  for (let i = 1; i < snappedStarts.length; i++) {
    const minAllowed = snappedStarts[i - 1] + 80;
    const maxAllowed = lineDurationMs - (snappedStarts.length - i) * 80;
    snappedStarts[i] = Math.max(minAllowed, Math.min(maxAllowed, snappedStarts[i]));
  }

  const quantized: LyricWordTiming[] = baseWords.map((w, i) => {
    const startOffsetMs = snappedStarts[i];
    const nextStart = i < snappedStarts.length - 1 ? snappedStarts[i + 1] : lineDurationMs;
    return {
      ...w,
      startOffsetMs,
      durationMs: Math.max(80, nextStart - startOffsetMs),
    };
  });

  // If no explicit roles were set yet, enrich with automatic 70/20/8/2 hierarchy
  const hasExplicitRoles = quantized.some((w) => w.role && w.role !== 'normal');
  return hasExplicitRoles ? quantized : assignAutoWordHierarchy(quantized, effect);
}

/**
 * Parses a full song lyric text pasted by the user into draggable LyricLine pills.
 * Detects section headers like [Verso 1], [Coro], INTRO:, CORO:, etc.
 */
export function parseRawLyricsToPills(
  rawText: string,
  defaultEffect: LyricEffectType = 'capcut-karaoke',
  defaultFont: LyricFontFamily = 'Montserrat',
  defaultDurationMs = 2800
): LyricLine[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let currentSection = 'VERSO';
  const result: LyricLine[] = [];
  const sectionRegex = /^(\[.*\]|\(.*\)|(INTRO|VERSO|VERSE|PRE[\s-]?CORO|CORO|CHORUS|PUENTE|BRIDGE|OUTRO|FINAL|SOLO|INSTRUMENTAL)\s*\d*:?)$/i;

  lines.forEach((rawLine, idx) => {
    if (sectionRegex.test(rawLine) && rawLine.length <= 28) {
      currentSection = rawLine.replace(/[\[\]\(\):]/g, '').trim().toUpperCase();
      return;
    }

    const formattedText = rawLine.toUpperCase();
    const initialWords = assignAutoWordHierarchy(
      computeWordTimings(formattedText, defaultDurationMs),
      defaultEffect
    );
    result.push({
      id: `pill-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
      text: formattedText,
      sectionTag: currentSection,
      placed: false, // Starts in the Unassigned Lyric Pool ready to drag or Tap-to-Sync
      startMs: idx * 3000,
      durationMs: defaultDurationMs,
      effect: defaultEffect,
      fontFamily: defaultFont,
      fontSize: 108,
      positionX: 0.5,
      positionY: 0.5,
      primaryColor: '#ffffff',
      accentColor: '#ef4444',
      autoHierarchy: true,
      words: initialWords,
    });
  });

  return result;
}

export interface BeatMarker {
  timeMs: number;
  bar: number;
  beat: number; // 1-based beat within the bar (1 = downbeat)
  isDownbeat: boolean;
}

/**
 * Builds the musical beat grid in milliseconds from AI beatTimes or mathematical BPM.
 */
export function buildBeatGridMs(
  bpm: number = 120,
  firstBeatOffsetSec: number = 0,
  beatTimesSec?: number[],
  totalDurationMs: number = 240000,
  beatsPerBar: number = 4
): BeatMarker[] {
  const markers: BeatMarker[] = [];

  if (beatTimesSec && beatTimesSec.length > 2) {
    beatTimesSec.forEach((sec, idx) => {
      const bar = Math.floor(idx / beatsPerBar) + 1;
      const beat = (idx % beatsPerBar) + 1;
      markers.push({
        timeMs: Math.round(sec * 1000),
        bar,
        beat,
        isDownbeat: beat === 1,
      });
    });
    return markers;
  }

  const safeBpm = bpm > 20 && bpm < 300 ? bpm : 120;
  const beatDurationMs = 60000 / safeBpm;
  const startMs = Math.max(0, Math.round((firstBeatOffsetSec || 0) * 1000));
  let idx = 0;

  for (let t = startMs; t <= totalDurationMs; t += beatDurationMs) {
    const bar = Math.floor(idx / beatsPerBar) + 1;
    const beat = (idx % beatsPerBar) + 1;
    markers.push({
      timeMs: Math.round(t),
      bar,
      beat,
      isDownbeat: beat === 1,
    });
    idx++;
  }

  return markers;
}

/**
 * Real-Time Deterministic Musical Rhythm State at any timestamp `timeMs`.
 * Drives all beat-synced animations, camera punches, laser rigs, neon strikes, and background pulses.
 */
export interface SongRhythmState {
  bpm: number;
  beatPeriodMs: number;
  beatPhase: number;        // 0..1 progress inside the current beat
  barPhase: number;         // 0..1 progress inside the current 4-beat bar
  beatIndex: number;        // 0-based global beat counter
  barNumber: number;        // 1-based musical measure/bar number
  beatInBar: number;        // 1..4 beat position inside the bar (1 = Downbeat)
  isDownbeat: boolean;      // true when on Beat 1 of the bar
  sub8Index: number;        // 8th-note counter
  sub16Index: number;       // 16th-note counter
  beatImpulse: number;      // Sharp percussive decay (1.0 at beat hit -> 0.0)
  downbeatImpulse: number;  // Heavy downbeat slam decay on Beat 1 (1.0 -> 0.0)
  beatPulse: number;        // Smooth sinusoidal pulse [0..1]
  audioEnergy: number;      // Instantaneous audio/vocal energy [0..1] from waveformPeaks + beat
}

export function computeSongRhythmState(
  timeMs: number,
  bpm: number = 120,
  firstBeatOffsetSec: number = 0,
  beatTimesSec?: number[],
  waveformPeaks?: number[],
  totalDurationMs: number = 180000,
  reactivityMultiplier: number = 1.0
): SongRhythmState {
  const safeBpm = bpm > 20 && bpm < 300 ? bpm : 120;
  let beatPeriodMs = 60000 / safeBpm;
  let beatPhase = 0;
  let beatIndex = 0;

  if (beatTimesSec && beatTimesSec.length > 2) {
    const timeSec = timeMs / 1000;
    // Binary search for current beat interval in real AI beatTimesSec
    let lo = 0;
    let hi = beatTimesSec.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (beatTimesSec[mid] <= timeSec) lo = mid;
      else hi = mid - 1;
    }
    beatIndex = lo;
    const b0 = beatTimesSec[lo] * 1000;
    const b1 =
      lo + 1 < beatTimesSec.length
        ? beatTimesSec[lo + 1] * 1000
        : b0 + beatPeriodMs;
    beatPeriodMs = Math.max(180, Math.min(2000, b1 - b0));
    beatPhase = Math.max(0, Math.min(1, (timeMs - b0) / beatPeriodMs));
  } else {
    const offsetMs = (firstBeatOffsetSec || 0) * 1000;
    const relMs = Math.max(0, timeMs - offsetMs);
    beatIndex = Math.floor(relMs / beatPeriodMs);
    beatPhase = (relMs % beatPeriodMs) / beatPeriodMs;
  }

  const beatInBar = ((beatIndex % 4) + 4) % 4 + 1;
  const barNumber = Math.floor(beatIndex / 4) + 1;
  const barPhase = ((beatInBar - 1) + beatPhase) / 4;
  const isDownbeat = beatInBar === 1;

  const sub8Index = beatIndex * 2 + Math.floor(beatPhase * 2);
  const sub16Index = beatIndex * 4 + Math.floor(beatPhase * 4);

  const react = Math.max(0, Math.min(2, reactivityMultiplier));
  const rawBeatImpulse = Math.exp(-beatPhase * 5.2);
  const rawDownbeatImpulse = isDownbeat ? Math.exp(-beatPhase * 4.2) : Math.exp(-barPhase * 12);
  const rawBeatPulse = Math.pow(0.5 + 0.5 * Math.cos(beatPhase * Math.PI * 2), 2);

  // Sample real audio waveform amplitude at timeMs if available
  let waveAmp = 0.45;
  if (waveformPeaks && waveformPeaks.length > 0 && totalDurationMs > 0) {
    const normT = Math.max(0, Math.min(0.9999, timeMs / totalDurationMs));
    const exactIdx = normT * (waveformPeaks.length - 1);
    const i0 = Math.floor(exactIdx);
    const i1 = Math.min(waveformPeaks.length - 1, i0 + 1);
    const frac = exactIdx - i0;
    waveAmp = waveformPeaks[i0] * (1 - frac) + waveformPeaks[i1] * frac;
  }

  const audioEnergy = Math.max(
    0,
    Math.min(1, (waveAmp * 0.65 + rawBeatImpulse * 0.35) * react)
  );

  return {
    bpm: Math.round(60000 / beatPeriodMs),
    beatPeriodMs,
    beatPhase,
    barPhase,
    beatIndex,
    barNumber,
    beatInBar,
    isDownbeat,
    sub8Index,
    sub16Index,
    beatImpulse: Math.min(1.5, rawBeatImpulse * react),
    downbeatImpulse: Math.min(1.5, rawDownbeatImpulse * react),
    beatPulse: Math.min(1.5, rawBeatPulse * react),
    audioEnergy,
  };
}

/**
 * Snaps a candidate timestamp in ms to the closest beat marker or clip boundary.
 */
export function snapTimeMs(
  targetMs: number,
  beatMarkers: BeatMarker[],
  extraSnapPointsMs: number[] = [],
  thresholdMs: number = 140
): { timeMs: number; snapped: boolean; snapSource?: 'beat' | 'downbeat' | 'clip' } {
  let bestTime = Math.max(0, Math.round(targetMs));
  let minDiff = thresholdMs;
  let snapSource: 'beat' | 'downbeat' | 'clip' | undefined;

  // Priority 1: Clip boundaries (for seamless CapCut back-to-back lyric blocks)
  for (const pt of extraSnapPointsMs) {
    const diff = Math.abs(targetMs - pt);
    if (diff <= minDiff) {
      minDiff = diff;
      bestTime = Math.round(pt);
      snapSource = 'clip';
    }
  }

  // Priority 2: Beat Grid markers
  for (const marker of beatMarkers) {
    const diff = Math.abs(targetMs - marker.timeMs);
    if (diff <= minDiff) {
      minDiff = diff;
      bestTime = marker.timeMs;
      snapSource = marker.isDownbeat ? 'downbeat' : 'beat';
    }
  }

  return {
    timeMs: Math.max(0, bestTime),
    snapped: snapSource !== undefined,
    snapSource,
  };
}

/**
 * Extracts normalized waveform peak amplitudes [0.05..1.0] from a Web Audio AudioBuffer.
 */
export function extractAudioPeaks(audioBuffer: AudioBuffer, bucketCount: number = 900): number[] {
  const channel0 = audioBuffer.getChannelData(0);
  const channel1 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : null;
  const totalSamples = channel0.length;
  const samplesPerBucket = Math.max(1, Math.floor(totalSamples / bucketCount));
  const peaks: number[] = new Array(bucketCount).fill(0);

  let globalMax = 0.01;
  for (let i = 0; i < bucketCount; i++) {
    const start = i * samplesPerBucket;
    const end = Math.min(totalSamples, start + samplesPerBucket);
    let maxInBucket = 0;
    // Sample every 8th frame inside the bucket for ultra-fast extraction
    const step = Math.max(1, Math.floor((end - start) / 64));
    for (let j = start; j < end; j += step) {
      const v0 = Math.abs(channel0[j]);
      const v1 = channel1 ? Math.abs(channel1[j]) : 0;
      const v = Math.max(v0, v1);
      if (v > maxInBucket) maxInBucket = v;
    }
    peaks[i] = maxInBucket;
    if (maxInBucket > globalMax) globalMax = maxInBucket;
  }

  return peaks.map((p) => Math.max(0.04, Math.min(1, p / globalMax)));
}

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMIZABLE STAGE BACKGROUND TYPES & PRESETS
// ─────────────────────────────────────────────────────────────────────────────

export type LyricBackgroundType =
  | 'obsidian-red'          // Default TANDU stage pulse
  | 'pure-black'            // Absolute #000000 for zero-emission LED screens
  | 'transparent'           // Alpha 0 for live OBS/vMix camera overlays
  | 'chroma-green'          // #00ff00 for hardware broadcast switchers
  | 'chroma-blue'           // #0000ff broadcast chroma
  | 'warm-gold'             // Warm amber worship glow
  | 'cyber-blue'            // Electric cyan arena glow
  | 'midnight-purple'       // Deep concert violet pulse
  | 'crimson-grunge-poster' // Fiverr Slide 1: Saturated Crimson Red + Grunge & Split Panels
  | 'emerald-split-denim'   // Fiverr Slide 3: Emerald/Teal Split Panels + Denim/Paper Scratch
  | 'swiss-blueprint-grid'  // Lemo-Opuscar Swiss Motion 12-Col Grid + Crosshairs
  | 'album-card-stage'      // Fiverr Slide 5: Blurred Backdrop + Tilted Album Art Card on Left
  | 'vintage-paper-ink'     // Lemo-Opuscar Risograph Warm Cream Paper (#F4EEE2)
  | 'custom-solid'          // User-defined hex color
  | 'custom-image';         // Custom user image URL

export interface LyricBackgroundConfig {
  type: LyricBackgroundType;
  customColor?: string;      // Used when type === 'custom-solid'
  imageUrl?: string;         // Used when type === 'custom-image' or 'album-card-stage'
  particles?: boolean;       // Floating stage bokeh / dust reacting to BPM
  pulseWithBpm?: boolean;    // Ambient pulse toggle (default true)
  filmGrain?: boolean;       // Analog paper/film grain texture overlay
  vignette?: boolean;        // Optical lens vignette around frame perimeter
  hudTelemetry?: boolean;    // Swiss / Tactical BPM, Bar, Beat & Crosshair frame telemetry
  rhythmReactivity?: number; // 0..2 multiplier for beat & waveform reactivity (default 1.0)
}

export interface LyricBackgroundPreset {
  id: LyricBackgroundType;
  label: string;
  badge: string;
  description: string;
  previewBg: string; // CSS background for UI preview card
}

export const DEFAULT_LYRIC_BACKGROUND: LyricBackgroundConfig = {
  type: 'obsidian-red',
  particles: false,
  pulseWithBpm: true,
  filmGrain: false,
  vignette: true,
  hudTelemetry: false,
  rhythmReactivity: 1.0,
};

export const LYRIC_BACKGROUND_PRESETS: LyricBackgroundPreset[] = [
  {
    id: 'crimson-grunge-poster',
    label: 'Crimson Grunge Poster',
    badge: 'FIVERR PRO',
    description: 'Rojo carmesí saturado con bloques tonales y textura grunge de póster (HEAD IS SPINNIN).',
    previewBg: 'linear-gradient(135deg, #e11d1d 0%, #990f0f 55%, #450606 100%)',
  },
  {
    id: 'emerald-split-denim',
    label: 'Emerald Split Denim',
    badge: 'FIVERR TEAL',
    description: 'Verde esmeralda dividido en paneles asimétricos con textura de papel/mezclilla rayada (KNOCK KNOCK).',
    previewBg: 'linear-gradient(135deg, #00a878 0%, #007f5f 50%, #004b38 100%)',
  },
  {
    id: 'swiss-blueprint-grid',
    label: 'Swiss Blueprint 12-Col',
    badge: 'LEMO-OPUSCAR',
    description: 'Grilla arquitectónica modular de 12 columnas con marcas de registro (+) y pulso técnico al BPM.',
    previewBg: 'radial-gradient(circle at center, #182235 0%, #070a10 90%)',
  },
  {
    id: 'album-card-stage',
    label: 'Editorial Album Card',
    badge: 'VINYL STAGE',
    description: 'Fondo atmosférico desenfocado con tarjeta de portada/foto inclinada a la izquierda (Real Love).',
    previewBg: 'linear-gradient(135deg, #4c1d95 0%, #be185d 50%, #0f172a 100%)',
  },
  {
    id: 'vintage-paper-ink',
    label: 'Risograph Paper Stock',
    badge: 'LIGHT PRINT',
    description: 'Papel crema cálido (#F4EEE2) con fibra de impresión y viñeta editorial para letras oscuras/pop-art.',
    previewBg: 'linear-gradient(135deg, #f5efe2 0%, #e4d9c3 100%)',
  },
  {
    id: 'obsidian-red',
    label: 'Obsidian Red',
    badge: 'TANDU STAGE',
    description: 'Negro carbón con halo rojo reactivo al compás del BPM y línea de horizonte LED.',
    previewBg: 'radial-gradient(circle at center, rgba(239,68,68,0.5) 0%, #050608 80%)',
  },
  {
    id: 'pure-black',
    label: 'Negro Puro LED',
    badge: 'OLED / 0% EMISIÓN',
    description: 'Negro absoluto (#000000) para apagar los diodos de pantallas gigantes LED.',
    previewBg: '#000000',
  },
  {
    id: 'transparent',
    label: 'Transparente (Alpha)',
    badge: 'OBS / OVERLAYS',
    description: 'Canal alfa 0 para superponer letras sobre cámaras en vivo en OBS, vMix o ProPresenter.',
    previewBg: 'repeating-conic-gradient(#1f2937 0% 25%, #111827 0% 50%) 50% / 12px 12px',
  },
  {
    id: 'chroma-green',
    label: 'Chroma Verde',
    badge: 'BROADCAST',
    description: 'Verde puro (#00FF00) para switchers de video profesionales (Blackmagic ATEM).',
    previewBg: '#00ff00',
  },
  {
    id: 'warm-gold',
    label: 'Oro Worship',
    badge: 'CATEDRAL',
    description: 'Atmósfera dorada cálida con pulso ámbar para momentos de adoración y acústicos.',
    previewBg: 'radial-gradient(circle at center, rgba(212,175,55,0.55) 0%, #0a0804 80%)',
  },
  {
    id: 'cyber-blue',
    label: 'Cyber Arena',
    badge: 'ELECTRO / ROCK',
    description: 'Resplandor azul cian eléctrico con pulso percutivo de alta energía.',
    previewBg: 'radial-gradient(circle at center, rgba(6,182,212,0.55) 0%, #040812 80%)',
  },
  {
    id: 'midnight-purple',
    label: 'Midnight Violet',
    badge: 'FESTIVAL',
    description: 'Púrpura y fucsia profundo con halo de escenario místico.',
    previewBg: 'radial-gradient(circle at center, rgba(168,85,247,0.55) 0%, #080410 80%)',
  },
  {
    id: 'custom-solid',
    label: 'Color Personalizado',
    badge: 'SÓLIDO',
    description: 'Define cualquier color HEX fijo para adaptarse a la paleta del evento.',
    previewBg: 'linear-gradient(135deg, #374151 0%, #111827 100%)',
  },
  {
    id: 'custom-image',
    label: 'Imagen de Fondo',
    badge: 'TEXTURA / FOTO',
    description: 'Carga un fondo personalizado de luces, concierto o logo de la banda.',
    previewBg: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 1-CLICK STUDIO STYLE PACKS (Complete Art-Directed Fiverr / HyperFrames / Lemo-Opuscar Themes)
// ─────────────────────────────────────────────────────────────────────────────

export interface LyricStylePack {
  id: string;
  name: string;
  badge: string;
  description: string;
  previewGradient: string;
  lineStyle: {
    effect: LyricEffectType;
    fontFamily: LyricFontFamily;
    secondaryFontFamily?: LyricFontFamily;
    fontSize: number;
    primaryColor: string;
    accentColor: string;
    letterSpacing: number;
    textCase: LyricTextCase;
    strokeWidth: number;
    fxIntensity: number;
    ghostText: boolean;
    layoutMode: LyricLayoutMode;
    textTexture: LyricTextTexture;
    cameraMotion: LyricCameraMotion;
    autoHierarchy: boolean;
    rhythmLocked: boolean;
  };
  background: LyricBackgroundConfig;
}

export const LYRIC_STYLE_PACKS: LyricStylePack[] = [
  {
    id: 'wahaj-red-grunge',
    name: 'Wahaj Red Grunge',
    badge: 'FIVERR #1',
    description: 'HEAD [IS] SPINNIN: Tipografía negra ultra-condensada sobre rojo carmesí grunge, conectores en caja amarilla y 4 ecos en esquinas.',
    previewGradient: 'from-red-600 via-red-800 to-black',
    lineStyle: {
      effect: 'ae-poster-spin',
      fontFamily: 'Anton',
      secondaryFontFamily: 'Space Grotesk',
      fontSize: 138,
      primaryColor: '#09090b',
      accentColor: '#facc15',
      letterSpacing: -0.02,
      textCase: 'upper',
      strokeWidth: 0,
      fxIntensity: 1.25,
      ghostText: true,
      layoutMode: 'corner-frame',
      textTexture: 'grunge-distress',
      cameraMotion: 'beat-punch',
      autoHierarchy: true,
      rhythmLocked: true,
    },
    background: {
      type: 'crimson-grunge-poster',
      particles: false,
      pulseWithBpm: true,
      filmGrain: true,
      vignette: true,
      hudTelemetry: false,
      rhythmReactivity: 1.2,
    },
  },
  {
    id: 'hf-acid-tape',
    name: 'HyperFrames Acid Tape',
    badge: 'BRUTAL TAPE',
    description: 'CONTRE COURANT: Bloque inclinado -3.5° con ancla izquierda fija y cintas rasgadas que entran en latigazo al ritmo.',
    previewGradient: 'from-blue-600 via-indigo-700 to-lime-500',
    lineStyle: {
      effect: 'hf-split-tape',
      fontFamily: 'Archivo Black',
      secondaryFontFamily: 'Space Mono',
      fontSize: 112,
      primaryColor: '#ffffff',
      accentColor: '#5cf03a',
      letterSpacing: -0.04,
      textCase: 'lower',
      strokeWidth: 0,
      fxIntensity: 1.3,
      ghostText: false,
      layoutMode: 'split-anchor',
      textTexture: 'solid',
      cameraMotion: 'beat-punch',
      autoHierarchy: true,
      rhythmLocked: true,
    },
    background: {
      type: 'custom-solid',
      customColor: '#0a5cff',
      particles: false,
      pulseWithBpm: true,
      filmGrain: true,
      vignette: true,
      hudTelemetry: true,
      rhythmReactivity: 1.3,
    },
  },
  {
    id: 'pop-art-apocalypse',
    name: 'Pop-Art Poster Stack',
    badge: 'MULTI-ESCALA',
    description: 'BOBBY & BIG APOCALYPSE: Póster apilado en 3 escalas dramáticas con mancha vectorial orgánica y onda de choque.',
    previewGradient: 'from-emerald-500 via-amber-500 to-rose-700',
    lineStyle: {
      effect: 'hf-kinetic-cascade',
      fontFamily: 'Bebas Neue',
      secondaryFontFamily: 'Playfair Display',
      fontSize: 126,
      primaryColor: '#fef08a',
      accentColor: '#ef4444',
      letterSpacing: 0.01,
      textCase: 'upper',
      strokeWidth: 3,
      fxIntensity: 1.2,
      ghostText: false,
      layoutMode: 'poster-stack',
      textTexture: 'solid',
      cameraMotion: 'cinema-drift',
      autoHierarchy: true,
      rhythmLocked: true,
    },
    background: {
      type: 'emerald-split-denim',
      particles: true,
      pulseWithBpm: true,
      filmGrain: true,
      vignette: true,
      hudTelemetry: false,
      rhythmReactivity: 1.15,
    },
  },
  {
    id: 'knock-echo-studio',
    name: 'Knock Echo 16th Matrix',
    badge: 'ECHO 1/16',
    description: 'KNOCK KNOCK: Titular geométrico expandido con matriz inferior de micro-repeticiones que laten en semicorcheas.',
    previewGradient: 'from-teal-500 via-emerald-700 to-black',
    lineStyle: {
      effect: 'knock-echo-matrix',
      fontFamily: 'Unbounded',
      secondaryFontFamily: 'Space Mono',
      fontSize: 110,
      primaryColor: '#fef08a',
      accentColor: '#ffffff',
      letterSpacing: -0.02,
      textCase: 'upper',
      strokeWidth: 0,
      fxIntensity: 1.15,
      ghostText: true,
      layoutMode: 'poster-stack',
      textTexture: 'grunge-distress',
      cameraMotion: 'beat-punch',
      autoHierarchy: true,
      rhythmLocked: true,
    },
    background: {
      type: 'emerald-split-denim',
      particles: false,
      pulseWithBpm: true,
      filmGrain: true,
      vignette: true,
      hudTelemetry: true,
      rhythmReactivity: 1.2,
    },
  },
  {
    id: 'riso-pop-print',
    name: 'Risograph Ben-Day Print',
    badge: 'LEMO-OPUSCAR',
    description: 'Serigrafía sobre papel crema (#F4EEE2) con trama de puntos Ben-Day a 45°, halo blanco y desregistro CMYK al beat.',
    previewGradient: 'from-amber-200 via-rose-500 to-blue-700',
    lineStyle: {
      effect: 'riso-pop-halftone',
      fontFamily: 'Anton',
      secondaryFontFamily: 'Archivo Black',
      fontSize: 124,
      primaryColor: '#141414',
      accentColor: '#e4232b',
      letterSpacing: -0.01,
      textCase: 'upper',
      strokeWidth: 3.5,
      fxIntensity: 1.2,
      ghostText: false,
      layoutMode: 'poster-stack',
      textTexture: 'halftone-dots',
      cameraMotion: 'beat-punch',
      autoHierarchy: true,
      rhythmLocked: true,
    },
    background: {
      type: 'vintage-paper-ink',
      particles: false,
      pulseWithBpm: true,
      filmGrain: true,
      vignette: true,
      hudTelemetry: true,
      rhythmReactivity: 1.1,
    },
  },
  {
    id: 'editorial-real-love',
    name: 'Editorial Album & Script',
    badge: 'REAL LOVE',
    description: 'Escenario dividido con tarjeta de portada inclinada a la izquierda, serif editorial y palabra clímax en Script 3D.',
    previewGradient: 'from-pink-500 via-purple-700 to-slate-900',
    lineStyle: {
      effect: 'hf-kinetic-cascade',
      fontFamily: 'DM Serif Display',
      secondaryFontFamily: 'Kaushan Script',
      fontSize: 108,
      primaryColor: '#ffffff',
      accentColor: '#f43f5e',
      letterSpacing: 0.0,
      textCase: 'title',
      strokeWidth: 2,
      fxIntensity: 1.1,
      ghostText: true,
      layoutMode: 'editorial-cascade',
      textTexture: 'metallic-bevel',
      cameraMotion: 'cinema-drift',
      autoHierarchy: true,
      rhythmLocked: true,
    },
    background: {
      type: 'album-card-stage',
      particles: true,
      pulseWithBpm: true,
      filmGrain: false,
      vignette: true,
      hudTelemetry: false,
      rhythmReactivity: 1.0,
    },
  },
  {
    id: 'arena-laser-drop',
    name: 'Arena Laser Rig 6X',
    badge: 'CONCERT FX',
    description: 'Ignición palabra por palabra con cruce de rayos láser y jaula volumétrica de 6 haces sincronizada al drop.',
    previewGradient: 'from-cyan-500 via-fuchsia-600 to-black',
    lineStyle: {
      effect: 'laser-cage-drop',
      fontFamily: 'Montserrat',
      secondaryFontFamily: 'Syncopate',
      fontSize: 116,
      primaryColor: '#ffffff',
      accentColor: '#06b6d4',
      letterSpacing: -0.02,
      textCase: 'upper',
      strokeWidth: 1.5,
      fxIntensity: 1.35,
      ghostText: true,
      layoutMode: 'poster-stack',
      textTexture: 'metallic-bevel',
      cameraMotion: 'beat-punch',
      autoHierarchy: true,
      rhythmLocked: true,
    },
    background: {
      type: 'cyber-blue',
      particles: true,
      pulseWithBpm: true,
      filmGrain: false,
      vignette: true,
      hudTelemetry: true,
      rhythmReactivity: 1.35,
    },
  },
  {
    id: 'neon-wet-street-pack',
    name: 'Neon Wet Street Reflections',
    badge: 'NEON + LLUVIA',
    description: 'Tubo de vidrio doblado con encendido strike-flicker real y reflejo especular sobre charcos de asfalto nocturno.',
    previewGradient: 'from-teal-400 via-blue-700 to-black',
    lineStyle: {
      effect: 'neon-wet-street',
      fontFamily: 'Outfit',
      secondaryFontFamily: 'Yellowtail',
      fontSize: 114,
      primaryColor: '#ffffff',
      accentColor: '#1ff2d9',
      letterSpacing: 0.02,
      textCase: 'upper',
      strokeWidth: 2,
      fxIntensity: 1.2,
      ghostText: false,
      layoutMode: 'smart-wrap',
      textTexture: 'solid',
      cameraMotion: 'cinema-drift',
      autoHierarchy: true,
      rhythmLocked: true,
    },
    background: {
      type: 'swiss-blueprint-grid',
      particles: true,
      pulseWithBpm: true,
      filmGrain: true,
      vignette: true,
      hudTelemetry: false,
      rhythmReactivity: 1.15,
    },
  },
];
