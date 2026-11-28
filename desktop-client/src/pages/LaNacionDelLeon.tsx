import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  ArrowUpRight,
  X,
  ChevronLeft,
  ChevronRight,
  Menu,
  Disc3,
  Film,
  Camera,
  Calendar,
  Loader2,
  Settings2,
  ArrowUp,
  Mail,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  DEFAULT_ALBUM_COVER,
  DEFAULT_BAND_PROFILE,
  DEFAULT_HERO_IMAGE,
  formatSecondsToMMSS,
  getAutoVideoThumbnail,
  getEmbedVideoUrl,
  loadBandHubData,
} from '../services/bandContentService';
import { useBandAudioPlayer } from '../hooks/useBandAudioPlayer';
import type { BandAlbum, BandEvent, BandPhoto, BandProfile, BandVideo } from '../types/bandContent';
import '../styles/laNacionDelLeon.css';

const SPRING_UI = { type: 'spring' as const, stiffness: 320, damping: 28, mass: 0.9 };
const EASE_EDITORIAL = [0.2, 0.7, 0.2, 1] as const;

const LionCrestMark: React.FC<{ className?: string }> = ({ className = 'w-9 h-9' }) => (
  <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
    <polygon
      points="24,2 42,12 45,30 34,44 14,44 3,30 6,12"
      fill="#141417"
      stroke="#d43822"
      strokeWidth="2"
    />
    <path
      d="M14 20 L19 13 L24 18 L29 13 L34 20 L31 32 L24 37 L17 32 Z"
      fill="none"
      stroke="#f4efe6"
      strokeWidth="1.8"
    />
    <polygon points="24,21 28,28 24,33 20,28" fill="#d43822" />
  </svg>
);

const EqBars: React.FC<{ active: boolean; className?: string }> = ({ active, className = '' }) => (
  <span className={`inline-flex items-end gap-[2px] h-3.5 w-3.5 justify-center ${className}`} aria-hidden="true">
    <span className={`w-[2.5px] rounded-full bg-current transition-all ${active ? 'animate-eq-1' : 'h-[4px]'}`} />
    <span className={`w-[2.5px] rounded-full bg-current transition-all ${active ? 'animate-eq-2' : 'h-[9px]'}`} />
    <span className={`w-[2.5px] rounded-full bg-current transition-all ${active ? 'animate-eq-3' : 'h-[6px]'}`} />
  </span>
);

/**
 * Renders condensed uppercase headings with Toontrack's Conduit ITC signature contrast:
 * sleek Light (300) opening words paired with Bold/ExtraBold (700/800) anchor words.
 */
function renderSplitHeading(text: string): React.ReactNode {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return <strong>{text}</strong>;
  const splitIdx = words.length >= 4 ? words.length - 2 : words.length - 1;
  return (
    <>
      {words.slice(0, splitIdx).join(' ')}{' '}
      <strong>{words.slice(splitIdx).join(' ')}</strong>
    </>
  );
}

function parseDateParts(iso: string): { day: string; month: string; year: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return { day: '--', month: '---', year: '2026', time: '' };
  }
  const months = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
  return {
    day: String(d.getDate()).padStart(2, '0'),
    month: months[d.getMonth()] || '---',
    year: String(d.getFullYear()),
    time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}h`,
  };
}

const NAV_ITEMS = [
  { id: 'musica', href: '#musica', label: 'Música' },
  { id: 'videos', href: '#videos', label: 'Videos' },
  { id: 'fotos', href: '#fotos', label: 'Fotos' },
  { id: 'gira', href: '#gira', label: 'Gira' },
  { id: 'banda', href: '#banda', label: 'La Banda' },
  { id: 'contacto', href: '#contacto', label: 'Booking' },
] as const;

export default function LaNacionDelLeon() {
  const { session } = useAuth();

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<BandProfile>(DEFAULT_BAND_PROFILE);
  const [albums, setAlbums] = useState<BandAlbum[]>([]);
  const [videos, setVideos] = useState<BandVideo[]>([]);
  const [photos, setPhotos] = useState<BandPhoto[]>([]);
  const [events, setEvents] = useState<BandEvent[]>([]);

  // Interactive UI states
  const [isScrolled, setIsScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState<string>('');
  const [showFloatingPlayer, setShowFloatingPlayer] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedVideoModal, setSelectedVideoModal] = useState<BandVideo | null>(null);
  const [photoFilter, setPhotoFilter] = useState<string>('TODAS');
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [newsletterEmail, setNewsletterEmail] = useState('');
  const [newsletterDone, setNewsletterDone] = useState(false);
  const [countdownNow, setCountdownNow] = useState(() => Date.now());

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Set page document title for public visitors
  useEffect(() => {
    const prevTitle = document.title;
    document.title = `${profile.band_name || 'La Nación del León'} · Sitio Oficial`;
    return () => {
      document.title = prevTitle;
    };
  }, [profile.band_name]);

  // Fetch all real band content from Supabase
  useEffect(() => {
    let active = true;
    loadBandHubData()
      .then((data) => {
        if (!active) return;
        setProfile(data.profile);
        setAlbums(data.albums);
        setVideos(data.videos);
        setPhotos(data.photos);
        setEvents(data.events);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Resolve initial/featured album
  const featuredAlbum = useMemo<BandAlbum | null>(() => {
    if (albums.length === 0) return null;
    if (profile.featured_album_id) {
      const found = albums.find((a) => a.id === profile.featured_album_id);
      if (found) return found;
    }
    return albums[0];
  }, [albums, profile.featured_album_id]);

  const player = useBandAudioPlayer(featuredAlbum);

  // Update scroll flags for sticky masthead & floating mini-player
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
      setIsScrolled(y > 24);
      setShowFloatingPlayer(y > 540);
      if (y < 240) setActiveSection('');
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Track active section in sticky navigation
  useEffect(() => {
    const sectionIds = NAV_ITEMS.map((item) => item.id);
    const elements = sectionIds
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (elements.length === 0 || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target?.id) {
          setActiveSection(visible[0].target.id);
        }
      },
      { rootMargin: '-25% 0px -55% 0px', threshold: [0.1, 0.35, 0.6] }
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [loading]);

  // Countdown tick every second for the next upcoming concert
  const nextShow = useMemo<BandEvent | null>(() => {
    if (events.length === 0) return null;
    const now = Date.now();
    const upcoming = events.find((ev) => new Date(ev.event_date).getTime() > now);
    return upcoming || events[0];
  }, [events]);

  useEffect(() => {
    if (!nextShow) return;
    const timer = window.setInterval(() => setCountdownNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [nextShow]);

  const countdown = useMemo(() => {
    if (!nextShow) return null;
    const diff = Math.max(0, new Date(nextShow.event_date).getTime() - countdownNow);
    const totalSec = Math.floor(diff / 1000);
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    return {
      days: String(days).padStart(2, '0'),
      hours: String(hours).padStart(2, '0'),
      mins: String(mins).padStart(2, '0'),
      secs: String(secs).padStart(2, '0'),
    };
  }, [nextShow, countdownNow]);

  // Filtered photo gallery + keyboard navigation inside Lightbox
  const photoCategories = useMemo(() => {
    const cats = Array.from(new Set(photos.map((p) => (p.category || 'En Vivo').toUpperCase())));
    return ['TODAS', ...cats];
  }, [photos]);

  const filteredPhotos = useMemo(() => {
    if (photoFilter === 'TODAS') return photos;
    return photos.filter((p) => (p.category || 'En Vivo').toUpperCase() === photoFilter);
  }, [photos, photoFilter]);

  useEffect(() => {
    if (lightboxIndex === null && !selectedVideoModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLightboxIndex(null);
        setSelectedVideoModal(null);
      } else if (lightboxIndex !== null && filteredPhotos.length > 0) {
        if (e.key === 'ArrowRight') {
          setLightboxIndex((prev) => (prev === null ? 0 : (prev + 1) % filteredPhotos.length));
        } else if (e.key === 'ArrowLeft') {
          setLightboxIndex((prev) =>
            prev === null ? 0 : (prev - 1 + filteredPhotos.length) % filteredPhotos.length
          );
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lightboxIndex, selectedVideoModal, filteredPhotos.length]);

  // Reactive Circular Equalizer Canvas driven by real FFT audio
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    let phase = 0;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = parent.clientWidth * dpr;
      canvas.height = parent.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener('resize', resize);

    const draw = () => {
      const parent = canvas.parentElement;
      if (parent) {
        const w = parent.clientWidth;
        const h = parent.clientHeight;
        ctx.clearRect(0, 0, w, h);

        const cx = w >= 1024 ? w * 0.7 : w * 0.5;
        const cy = h * 0.48;
        const baseR = Math.min(w, h) * 0.24;
        const bars = 96;
        phase += player.isPlaying ? 0.045 : 0.01;

        const bins = player.sampleFrequencyBins(bars, phase);

        // Subtle outer & inner precision studio rings
        ctx.beginPath();
        ctx.arc(cx, cy, baseR, 0, Math.PI * 2);
        ctx.strokeStyle = player.isPlaying ? 'rgba(212, 56, 34, 0.34)' : 'rgba(244, 239, 230, 0.1)';
        ctx.lineWidth = 1.1;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cx, cy, baseR * 0.84, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(244, 239, 230, 0.05)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Radial audio spectrum spikes
        for (let i = 0; i < bars; i++) {
          const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;
          const energy = bins[i] || 0;
          const spikeLen = player.isPlaying ? 8 + energy * 58 : 3 + energy * 12;

          const x1 = cx + Math.cos(angle) * (baseR + 5);
          const y1 = cy + Math.sin(angle) * (baseR + 5);
          const x2 = cx + Math.cos(angle) * (baseR + 5 + spikeLen);
          const y2 = cy + Math.sin(angle) * (baseR + 5 + spikeLen);

          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.strokeStyle =
            i % 4 === 0
              ? `rgba(244, 239, 230, ${player.isPlaying ? 0.42 : 0.16})`
              : `rgba(212, 56, 34, ${player.isPlaying ? 0.56 : 0.22})`;
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }
      }
      rafId = window.requestAnimationFrame(draw);
    };

    rafId = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, [player.isPlaying, player.sampleFrequencyBins]);

  const openVideoModal = (video: BandVideo) => {
    player.pause();
    setSelectedVideoModal(video);
  };

  const featuredVideo = useMemo<BandVideo | null>(() => {
    if (videos.length === 0) return null;
    return videos.find((v) => v.is_featured) || videos[0];
  }, [videos]);

  const secondaryVideos = useMemo(() => {
    if (!featuredVideo) return [];
    return videos.filter((v) => v.id !== featuredVideo.id);
  }, [videos, featuredVideo]);

  const progressPct = player.duration > 0 ? Math.min(100, (player.currentTime / player.duration) * 100) : 0;

  const tickerItems = useMemo(() => {
    if (events.length > 0) {
      return events.map((ev) => {
        const dp = parseDateParts(ev.event_date);
        return `${dp.day} ${dp.month} · ${ev.city.toUpperCase()} — ${ev.venue.toUpperCase()}`;
      });
    }
    return [
      `${profile.band_name.toUpperCase()} · ROCK EN VIVO`,
      'NUEVA MÚSICA EN STREAMING DIRECTO',
      'VIDEOS EN 4K & SESIONES DE ESTUDIO',
      `BOOKING · ${profile.booking_email.toUpperCase()}`,
    ];
  }, [events, profile.band_name, profile.booking_email]);

  const heroImage = profile.hero_image_url || DEFAULT_HERO_IMAGE;
  const activeCover = player.activeAlbum?.cover_url || featuredAlbum?.cover_url || DEFAULT_ALBUM_COVER;

  return (
    <div id="top" className="lion-root relative w-full overflow-x-hidden">
      {/* Keyboard accessibility skip link */}
      <a
        href="#musica"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[90] focus:px-4 focus:py-2 focus:rounded-full focus:bg-[#d43822] focus:text-[#f4efe6] focus:text-xs focus:font-medium"
      >
        Ir al contenido principal
      </a>

      {/* =====================================================================
          1. FIXED FROSTED GLASS MASTHEAD (Toontrack Sticky Submenu Bar Discipline)
         ===================================================================== */}
      <header
        data-scrolled={isScrolled ? 'true' : 'false'}
        className="lion-header-glass fixed inset-x-0 top-0 z-50"
      >
        <div className="max-w-[1360px] mx-auto px-5 sm:px-8 lg:px-12 h-[68px] flex items-center justify-between gap-6">
          {/* Brand Crest + Condensed Light/Bold Lockup */}
          <a href="#top" className="flex items-center gap-3 group shrink-0">
            <LionCrestMark className="w-9 h-9 transition-transform duration-200 group-hover:scale-105" />
            <div className="flex flex-col leading-none">
              <span className="lion-display text-[1.45rem] sm:text-[1.6rem] text-[#f4efe6] group-hover:text-[#e6522e] transition-colors">
                {renderSplitHeading(profile.band_name)}
              </span>
              <span className="text-[10px] font-light uppercase tracking-[0.22em] text-[#9b958c] mt-0.5">
                Rock · Sitio Oficial
              </span>
            </div>
          </a>

          {/* Center Navigation with Toontrack Pipe Dividers */}
          <nav className="hidden lg:flex items-center gap-1" aria-label="Navegación principal">
            {NAV_ITEMS.map((item, idx) => (
              <React.Fragment key={item.href}>
                {idx > 0 && (
                  <span
                    className="mx-3 h-3 w-px bg-[rgba(244,239,230,0.2)] select-none"
                    aria-hidden="true"
                  />
                )}
                <a
                  href={item.href}
                  data-active={activeSection === item.id ? 'true' : 'false'}
                  className="lion-nav-link"
                >
                  {item.label}
                </a>
              </React.Fragment>
            ))}
          </nav>

          {/* Right Controls: Pill Live Player Trigger + CMS + Mobile Drawer */}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                if (player.activeTrack) {
                  player.togglePlay();
                } else {
                  document.getElementById('musica')?.scrollIntoView({ behavior: 'smooth' });
                }
              }}
              className={`hidden sm:inline-flex items-center gap-2.5 px-4 py-2 rounded-full border transition-all duration-200 cursor-pointer ${
                player.isPlaying
                  ? 'border-[#d43822] bg-[#d43822] text-[#f4efe6] shadow-[0_6px_20px_-6px_rgba(212,56,34,0.65)]'
                  : 'border-[rgba(244,239,230,0.16)] bg-[rgba(244,239,230,0.05)] text-[#f4efe6] hover:border-[#b91d1d] hover:bg-[#b91d1d]'
              }`}
              title={player.activeTrack ? `Reproducir ${player.activeTrack.title}` : 'Ir a discografía'}
            >
              <EqBars active={player.isPlaying} />
              <span className="lion-label text-[11px]">
                {player.isPlaying ? 'Sonando' : 'Escuchar'}
              </span>
            </button>

            <Link
              to={session ? '/nacion-cms' : '/login'}
              className="hidden md:inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-[rgba(244,239,230,0.13)] hover:border-[rgba(244,239,230,0.34)] text-[#b8b2a8] hover:text-[#f4efe6] transition-colors lion-label text-[11px]"
              title="Administrar música, videos y fotos"
            >
              <Settings2 size={13} />
              <span>CMS</span>
            </Link>

            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden inline-flex items-center justify-center w-10 h-10 rounded-full border border-[rgba(244,239,230,0.18)] text-[#f4efe6] hover:border-[#d43822] transition-colors cursor-pointer"
              aria-label="Abrir menú"
            >
              <Menu size={19} />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Navigation Drawer */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[70] bg-[#09090b]/96 backdrop-blur-2xl flex flex-col justify-between p-6"
          >
            <div className="flex items-center justify-between border-b border-[rgba(244,239,230,0.1)] pb-5">
              <div className="flex items-center gap-3">
                <LionCrestMark className="w-9 h-9" />
                <span className="lion-display text-2xl text-[#f4efe6]">
                  {renderSplitHeading(profile.band_name)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="w-10 h-10 rounded-full border border-[rgba(244,239,230,0.18)] flex items-center justify-center text-[#f4efe6] hover:border-[#d43822] cursor-pointer"
                aria-label="Cerrar menú"
              >
                <X size={19} />
              </button>
            </div>

            <nav className="flex flex-col gap-2 my-auto" aria-label="Menú móvil">
              {NAV_ITEMS.map((item, idx) => (
                <motion.a
                  key={item.href}
                  href={item.href}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ ...SPRING_UI, delay: idx * 0.04 }}
                  onClick={() => setMobileMenuOpen(false)}
                  className="lion-display text-4xl text-[#f4efe6] hover:text-[#e6522e] py-2 border-b border-[rgba(244,239,230,0.07)] transition-colors"
                >
                  {item.label}
                </motion.a>
              ))}
            </nav>

            <div className="flex items-center justify-between pt-4 border-t border-[rgba(244,239,230,0.1)]">
              <Link
                to={session ? '/nacion-cms' : '/login'}
                onClick={() => setMobileMenuOpen(false)}
                className="lion-label text-xs text-[#e6522e] inline-flex items-center gap-2"
              >
                <Settings2 size={14} />
                <span>Gestor de contenido</span>
              </Link>
              <span className="lion-label text-xs text-[#7c7770] tnum">© {new Date().getFullYear()}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <main>
        {/* =====================================================================
            2. HERO SECTION (Toontrack Light/Bold Condensed Lockup + Studio Deck)
           ===================================================================== */}
        <section className="relative min-h-[100dvh] flex flex-col justify-between pt-[76px] overflow-hidden">
          {/* Background Media Layer */}
          <div className="absolute inset-0 z-0 overflow-hidden bg-[#09090b]">
            {profile.hero_video_url ? (
              <video
                src={profile.hero_video_url}
                poster={heroImage}
                autoPlay
                loop
                muted
                playsInline
                className="w-full h-full object-cover object-center opacity-80"
              />
            ) : (
              <img
                src={heroImage}
                alt={`Escenario de ${profile.band_name}`}
                className="w-full h-full object-cover object-[72%_25%] sm:object-center scale-[1.01]"
              />
            )}

            {/* Studio directional vignette + subtle warm crimson ambient leak */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  'linear-gradient(180deg, rgba(9,9,11,0.68) 0%, rgba(9,9,11,0.28) 38%, rgba(9,9,11,0.82) 78%, #09090b 100%), linear-gradient(90deg, rgba(9,9,11,0.94) 0%, rgba(9,9,11,0.62) 45%, rgba(9,9,11,0.14) 78%), radial-gradient(45% 55% at 92% 40%, rgba(185,29,29,0.22) 0%, transparent 72%)',
              }}
            />

            {/* Subtle 35mm film grain */}
            <div className="lion-grain absolute inset-0" />

            {/* Live Reactive Circular Equalizer Canvas */}
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full pointer-events-none opacity-80"
            />
          </div>

          {/* HERO TOP AUDIO CONSOLE */}
          <div className="relative z-10 max-w-[1360px] mx-auto w-full px-5 sm:px-8 lg:px-12 pt-5">
            <div className="bg-[#16161a]/82 backdrop-blur-xl border border-[rgba(244,239,230,0.1)] rounded-2xl px-4 sm:px-5 py-3 flex flex-wrap items-center justify-between gap-4 shadow-[0_16px_44px_-20px_rgba(0,0,0,0.9)]">
              {/* Transport controls */}
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={player.prevTrack}
                  disabled={!player.activeTrack}
                  className="text-[#b8b2a8] hover:text-[#f4efe6] disabled:opacity-30 p-1.5 rounded-full transition-colors cursor-pointer"
                  aria-label="Pista anterior"
                >
                  <SkipBack size={16} />
                </button>

                <button
                  type="button"
                  onClick={player.togglePlay}
                  disabled={!player.activeTrack}
                  className="w-10 h-10 rounded-full bg-[#d43822] hover:bg-[#e6522e] disabled:bg-[#2a2a2f] disabled:text-[#7c7770] disabled:shadow-none text-[#f4efe6] flex items-center justify-center transition-colors cursor-pointer shadow-[0_6px_18px_-4px_rgba(212,56,34,0.6)]"
                  aria-label={player.isPlaying ? 'Pausar' : 'Reproducir'}
                >
                  {player.isBuffering ? (
                    <Loader2 size={17} className="animate-spin" />
                  ) : player.isPlaying ? (
                    <Pause size={17} fill="currentColor" />
                  ) : (
                    <Play size={17} fill="currentColor" className="ml-0.5" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={player.nextTrack}
                  disabled={!player.activeTrack}
                  className="text-[#b8b2a8] hover:text-[#f4efe6] disabled:opacity-30 p-1.5 rounded-full transition-colors cursor-pointer"
                  aria-label="Siguiente pista"
                >
                  <SkipForward size={16} />
                </button>

                <div className="pl-3.5 border-l border-[rgba(244,239,230,0.1)] min-w-0 flex-1 sm:flex-initial">
                  <div className="lion-display-bold text-[11px] tracking-[0.14em] text-[#e6522e] whitespace-nowrap">
                    {player.isPlaying ? 'REPRODUCIENDO AHORA' : 'REPRODUCTOR OFICIAL'}
                  </div>
                  <div className="lion-title text-sm sm:text-[15px] text-[#f4efe6] truncate max-w-[190px] sm:max-w-[280px] whitespace-nowrap mt-0.5">
                    {player.activeTrack
                      ? `${String(player.activeTrackIndex + 1).padStart(2, '0')}. ${player.activeTrack.title}`
                      : loading
                        ? 'Cargando catálogo...'
                        : 'Sube tu música en CMS'}
                  </div>
                </div>
              </div>

              {/* Scrubber Rail */}
              <div className="flex-1 min-w-[180px] flex items-center gap-3">
                <span className="text-xs font-light text-[#b8b2a8] tnum w-10 text-right">
                  {formatSecondsToMMSS(player.currentTime)}
                </span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(player.duration, 1)}
                  step={0.5}
                  value={Math.min(player.currentTime, Math.max(player.duration, 1))}
                  onChange={(e) => player.seek(Number(e.target.value))}
                  disabled={!player.activeTrack}
                  className="lion-scrubber flex-1"
                  aria-label="Línea de tiempo"
                />
                <span className="text-xs font-light text-[#b8b2a8] tnum w-10">
                  {player.duration > 0
                    ? formatSecondsToMMSS(player.duration)
                    : player.activeTrack?.duration || '0:00'}
                </span>
              </div>

              {/* Volume + Album Badge */}
              <div className="hidden md:flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={player.toggleMute}
                    className="text-[#b8b2a8] hover:text-[#f4efe6] cursor-pointer"
                    aria-label="Silenciar"
                  >
                    {player.isMuted || player.volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.02}
                    value={player.isMuted ? 0 : player.volume}
                    onChange={(e) => player.setVolume(Number(e.target.value))}
                    className="lion-scrubber w-20"
                    aria-label="Volumen"
                  />
                </div>
                {player.activeAlbum && (
                  <span className="lion-badge lion-badge-subtle truncate max-w-[160px]">
                    {player.activeAlbum.title}
                  </span>
                )}
              </div>
            </div>
            {player.error && (
              <div className="mt-2.5 px-4 py-2 rounded-xl bg-[#b91d1d]/20 border border-[#b91d1d]/45 text-xs text-[#f4efe6]">
                {player.error}
              </div>
            )}
          </div>

          {/* HERO EDITORIAL LOCKUP */}
          <div className="relative z-10 max-w-[1360px] mx-auto w-full px-5 sm:px-8 lg:px-12 py-12 lg:py-16 flex flex-col gap-12">
            <motion.div
              initial={{ opacity: 0.92, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, ease: EASE_EDITORIAL }}
              className="max-w-4xl"
            >
              {/* Airy Light-weight Eyebrow (echoing Toontrack's light subtitle above condensed display) */}
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <span className="lion-badge">OFICIAL</span>
                <span className="text-xs sm:text-sm font-light uppercase tracking-[0.2em] text-[#ebe6dc]/85">
                  {profile.hero_eyebrow}
                </span>
              </div>

              <h1 className="lion-display-xl text-[#f4efe6] drop-shadow-[0_14px_40px_rgba(0,0,0,0.6)]">
                {renderSplitHeading(profile.hero_title)}
              </h1>

              <p className="lion-lead max-w-[54ch] mt-6">
                {profile.hero_subtitle}
              </p>
            </motion.div>

            {/* Bottom Row: Featured Release + Next Show Countdown */}
            <motion.div
              initial={{ opacity: 0.92, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.05, ease: EASE_EDITORIAL }}
              className="flex flex-col lg:flex-row lg:items-end justify-between gap-10 pt-2"
            >
              {/* Release Block */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
                <button
                  type="button"
                  onClick={() => {
                    if (featuredAlbum && featuredAlbum.tracks.length > 0) {
                      player.playTrack(featuredAlbum, 0);
                    } else {
                      document.getElementById('musica')?.scrollIntoView({ behavior: 'smooth' });
                    }
                  }}
                  className="w-28 h-28 sm:w-36 sm:h-36 shrink-0 rounded-2xl border border-[rgba(244,239,230,0.16)] overflow-hidden bg-[#18181b] shadow-[0_24px_48px_rgba(0,0,0,0.78)] group relative cursor-pointer"
                  aria-label="Reproducir lanzamiento destacado"
                >
                  <img
                    src={activeCover}
                    alt={featuredAlbum?.title || profile.band_name}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  <span className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <span className="w-12 h-12 rounded-full bg-[#d43822] text-[#f4efe6] flex items-center justify-center shadow-lg">
                      <Play size={19} fill="currentColor" className="ml-0.5" />
                    </span>
                  </span>
                </button>

                <div className="space-y-4">
                  <div>
                    <div className="lion-display-bold text-xs tracking-[0.14em] text-[#e6522e]">
                      {featuredAlbum
                        ? `ÁLBUM DESTACADO ${featuredAlbum.release_date ? `· ${featuredAlbum.release_date}` : ''}`
                        : 'CATÁLOGO OFICIAL'}
                    </div>
                    <div className="lion-title text-2xl sm:text-3xl text-[#f4efe6] mt-1">
                      {featuredAlbum ? featuredAlbum.title : 'Discografía en vivo'}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        if (player.activeTrack) {
                          player.togglePlay();
                        } else if (featuredAlbum && featuredAlbum.tracks.length > 0) {
                          player.playTrack(featuredAlbum, 0);
                        } else {
                          document.getElementById('musica')?.scrollIntoView({ behavior: 'smooth' });
                        }
                      }}
                      className="lion-btn-ember"
                    >
                      {player.isPlaying ? (
                        <Pause size={15} fill="currentColor" />
                      ) : (
                        <Play size={15} fill="currentColor" />
                      )}
                      <span>{player.isPlaying ? 'Pausar música' : 'Escuchar ahora'}</span>
                    </button>
                    <a href="#musica" className="lion-btn-wire">
                      <span>Ver discografía</span>
                    </a>
                  </div>
                </div>
              </div>

              {/* Next Show Countdown */}
              {nextShow ? (
                <div className="bg-[#16161a]/78 backdrop-blur-xl border border-[rgba(244,239,230,0.1)] rounded-2xl px-6 py-5 space-y-3">
                  <div className="flex items-center gap-2.5">
                    <span className="lion-badge">PRÓXIMO SHOW</span>
                    <span className="text-xs font-light text-[#b8b2a8]">{nextShow.venue}</span>
                  </div>
                  <a
                    href={nextShow.ticket_url || '#gira'}
                    target={nextShow.ticket_url ? '_blank' : undefined}
                    rel={nextShow.ticket_url ? 'noreferrer' : undefined}
                    className="flex flex-wrap items-baseline gap-3 group"
                  >
                    <span className="lion-display-bold text-3xl text-[#e6522e]">
                      {parseDateParts(nextShow.event_date).day} {parseDateParts(nextShow.event_date).month}
                    </span>
                    <span className="lion-display text-3xl text-[#f4efe6] group-hover:text-[#e6522e] transition-colors">
                      {nextShow.city}
                    </span>
                  </a>
                  {countdown && (
                    <div className="flex items-center gap-2.5 pt-1 tnum">
                      {[
                        { val: countdown.days, unit: 'DÍAS', highlight: false },
                        { val: countdown.hours, unit: 'HRS', highlight: false },
                        { val: countdown.mins, unit: 'MIN', highlight: false },
                        { val: countdown.secs, unit: 'SEG', highlight: true },
                      ].map((slot) => (
                        <div
                          key={slot.unit}
                          className="px-2.5 py-1.5 rounded-lg bg-[#09090b]/70 border border-[rgba(244,239,230,0.08)] text-center min-w-[50px]"
                        >
                          <div
                            className={`lion-display-bold text-lg leading-none ${
                              slot.highlight ? 'text-[#e6522e]' : 'text-[#f4efe6]'
                            }`}
                          >
                            {slot.val}
                          </div>
                          <div className="text-[9px] font-medium tracking-[0.14em] text-[#8c867e] mt-1">
                            {slot.unit}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-[#16161a]/75 backdrop-blur-xl border border-[rgba(244,239,230,0.1)] rounded-2xl px-6 py-5 space-y-2">
                  <div className="lion-display-bold text-xs tracking-[0.14em] text-[#e6522e]">
                    CONTRATACIONES &amp; GIRA
                  </div>
                  <a
                    href={`mailto:${profile.booking_email}`}
                    className="lion-display text-2xl sm:text-3xl text-[#f4efe6] hover:text-[#e6522e] transition-colors inline-flex items-center gap-2"
                  >
                    <span>
                      FECHAS DISPONIBLES <strong>2026</strong>
                    </span>
                    <ArrowUpRight size={20} className="text-[#e6522e]" />
                  </a>
                </div>
              )}
            </motion.div>
          </div>

          {/* REFINED STUDIO TOUR TICKER RIBBON */}
          <div className="relative z-10 h-12 bg-[#121215] text-[#ebe6dc] flex items-center overflow-hidden border-y border-[rgba(244,239,230,0.09)]">
            <div className="bg-[#b91d1d] text-[#f4efe6] lion-display-bold text-xs tracking-[0.14em] px-5 sm:px-7 h-full flex items-center shrink-0 z-10 whitespace-nowrap">
              EN GIRA
            </div>
            <div className="lion-ticker-wrap flex-1 min-w-0 overflow-hidden flex items-center h-full">
              <div className="lion-ticker-track text-[17px] sm:text-[19px]">
                {[...tickerItems, ...tickerItems].map((text, idx) => (
                  <span key={idx} className="lion-ticker-item">
                    <span className="px-6 whitespace-nowrap font-light text-[#f4efe6]/90">{text}</span>
                    <span className="text-[#d43822] shrink-0 text-xs">◆</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* =====================================================================
            3. DISCOGRAFÍA Y REPRODUCTOR EDITORIAL (Toontrack Matte Rounded Container)
           ===================================================================== */}
        <section id="musica" className="py-20 lg:py-28 px-5 sm:px-8 lg:px-12 bg-[#09090b]">
          <div className="max-w-[1360px] mx-auto">
            {/* Section Header floating cleanly above the matte container */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-10">
              <div>
                <div className="lion-display-bold text-xs tracking-[0.16em] text-[#e6522e] mb-2">
                  DISCOGRAFÍA OFICIAL · AUDIO DIRECTO
                </div>
                <h2 className="lion-display-l text-[#f4efe6]">
                  {renderSplitHeading('ESCUCHA A LA MANADA')}
                </h2>
              </div>

              {albums.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {albums.map((album) => {
                    const isSelected = player.activeAlbum?.id === album.id;
                    return (
                      <button
                        key={album.id}
                        type="button"
                        onClick={() => player.selectAlbum(album, false)}
                        className={`relative px-5 py-2.5 rounded-full lion-label text-[11px] transition-colors cursor-pointer ${
                          isSelected
                            ? 'text-[#f4efe6]'
                            : 'border border-[rgba(244,239,230,0.14)] bg-[#161619] text-[#b8b2a8] hover:text-[#f4efe6] hover:border-[rgba(244,239,230,0.3)]'
                        }`}
                      >
                        {isSelected && (
                          <motion.span
                            layoutId="active-album-pill"
                            transition={SPRING_UI}
                            className="absolute inset-0 rounded-full bg-[#b91d1d]"
                          />
                        )}
                        <span className="relative z-10">
                          {album.release_date ? `${album.release_date} · ` : ''}
                          {album.title}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="lion-panel p-6 sm:p-10 lg:p-14">
              {loading ? (
                <div className="py-20 flex items-center justify-center gap-3 text-[#b8b2a8] lion-label text-xs">
                  <Loader2 size={18} className="animate-spin text-[#e6522e]" />
                  <span>Cargando discografía...</span>
                </div>
              ) : !player.activeAlbum ? (
                <div className="py-16 rounded-2xl border border-dashed border-[rgba(244,239,230,0.14)] px-6 text-center space-y-5 bg-[#121215]/50">
                  <Disc3 size={38} className="mx-auto text-[#e6522e]/75" />
                  <div className="space-y-2">
                    <h3 className="lion-display text-3xl text-[#f4efe6]">
                      {renderSplitHeading('AÚN NO HAY ÁLBUMES PUBLICADOS')}
                    </h3>
                    <p className="lion-body max-w-md mx-auto">
                      Sube tus álbumes reales, portadas y archivos de audio (MP3 / WAV / FLAC) desde el gestor de contenido exclusivo.
                    </p>
                  </div>
                  <Link to={session ? '/nacion-cms' : '/login'} className="lion-btn-ember">
                    <span>Ir al gestor de contenido</span>
                    <ArrowUpRight size={15} />
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-start">
                  {/* Left Column: Vinyl Sleeve + Metadata */}
                  <div className="lg:col-span-5 space-y-8">
                    <div
                      className="lion-vinyl-wrap w-56 h-56 sm:w-68 sm:h-68 lg:w-76 lg:h-76"
                      data-playing={player.isPlaying ? 'true' : 'false'}
                    >
                      {/* Protruding Spinning Vinyl Record */}
                      <div className="lion-vinyl-disc flex items-center justify-center">
                        <div className="lion-vinyl-rotor w-full h-full rounded-full flex items-center justify-center relative">
                          <div
                            className="w-[34%] h-[34%] rounded-full border-4 border-[#09090b] bg-cover bg-center overflow-hidden shadow-inner"
                            style={{
                              backgroundImage: `url(${player.activeAlbum.cover_url || DEFAULT_ALBUM_COVER})`,
                            }}
                          />
                          <div className="w-3 h-3 rounded-full bg-[#09090b] border border-[#e6522e]/60 absolute" />
                        </div>
                      </div>

                      {/* Album Cover Sleeve */}
                      <div className="relative z-10 w-full h-full rounded-2xl bg-[#111114] border border-[rgba(244,239,230,0.12)] shadow-[0_28px_60px_rgba(0,0,0,0.85)] overflow-hidden">
                        <img
                          src={player.activeAlbum.cover_url || DEFAULT_ALBUM_COVER}
                          alt={player.activeAlbum.title}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <div className="lion-display-bold text-xs tracking-[0.14em] text-[#e6522e]">
                          {player.activeAlbum.artist}
                          {player.activeAlbum.release_date ? ` · ${player.activeAlbum.release_date}` : ''}
                        </div>
                        <h3 className="lion-title text-2xl sm:text-3xl text-[#f4efe6] mt-1.5">
                          {player.activeAlbum.title}
                        </h3>
                      </div>

                      {player.activeAlbum.description && (
                        <p className="lion-body max-w-md">{player.activeAlbum.description}</p>
                      )}

                      {player.activeAlbum.credits && (
                        <div className="border-l-2 border-[#b91d1d] pl-4 text-sm font-light text-[#b8b2a8]">
                          {player.activeAlbum.credits}
                        </div>
                      )}

                      <div className="flex flex-wrap gap-3 pt-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (player.activeAlbum && player.activeAlbum.tracks.length > 0) {
                              player.playTrack(player.activeAlbum, player.activeTrackIndex);
                            }
                          }}
                          disabled={player.activeAlbum.tracks.length === 0}
                          className="lion-btn-ember"
                        >
                          {player.isPlaying ? (
                            <Pause size={15} fill="currentColor" />
                          ) : (
                            <Play size={15} fill="currentColor" />
                          )}
                          <span>{player.isPlaying ? 'Pausar' : 'Reproducir álbum'}</span>
                        </button>
                        {player.activeAlbum.buy_link && (
                          <a
                            href={player.activeAlbum.buy_link}
                            target="_blank"
                            rel="noreferrer"
                            className="lion-btn-wire"
                          >
                            <span>Stream / Comprar</span>
                            <ArrowUpRight size={15} />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Editorial Master Scrubber + Tracklist */}
                  <div className="lg:col-span-7">
                    {/* Active Track Console Header */}
                    <div className="pb-6 border-b border-[rgba(244,239,230,0.1)] space-y-5">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div className="min-w-0">
                          <div className="lion-display-bold text-xs tracking-[0.14em] text-[#e6522e]">
                            PISTA ACTIVA · {player.activeAlbum.tracks.length} CANCIÓN(ES)
                          </div>
                          <div className="lion-title text-xl sm:text-2xl text-[#f4efe6] truncate mt-1">
                            {player.activeTrack
                              ? `${String(player.activeTrackIndex + 1).padStart(2, '0')}. ${player.activeTrack.title}`
                              : 'Sin pistas cargadas'}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={player.prevTrack}
                            disabled={!player.activeTrack}
                            className="w-10 h-10 rounded-full border border-[rgba(244,239,230,0.16)] hover:border-[#f4efe6] text-[#f4efe6] flex items-center justify-center transition-colors cursor-pointer disabled:opacity-30"
                            aria-label="Anterior"
                          >
                            <SkipBack size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={player.togglePlay}
                            disabled={!player.activeTrack}
                            className="w-12 h-12 rounded-full bg-[#d43822] hover:bg-[#e6522e] text-[#f4efe6] flex items-center justify-center transition-colors cursor-pointer disabled:opacity-30 shadow-[0_8px_22px_-6px_rgba(212,56,34,0.65)]"
                            aria-label={player.isPlaying ? 'Pausar' : 'Reproducir'}
                          >
                            {player.isBuffering ? (
                              <Loader2 size={18} className="animate-spin" />
                            ) : player.isPlaying ? (
                              <Pause size={18} fill="currentColor" />
                            ) : (
                              <Play size={18} fill="currentColor" className="ml-0.5" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={player.nextTrack}
                            disabled={!player.activeTrack}
                            className="w-10 h-10 rounded-full border border-[rgba(244,239,230,0.16)] hover:border-[#f4efe6] text-[#f4efe6] flex items-center justify-center transition-colors cursor-pointer disabled:opacity-30"
                            aria-label="Siguiente"
                          >
                            <SkipForward size={15} />
                          </button>
                        </div>
                      </div>

                      {/* Interactive Progress Rail */}
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-light text-[#b8b2a8] tnum w-10">
                          {formatSecondsToMMSS(player.currentTime)}
                        </span>
                        <div
                          role="slider"
                          tabIndex={0}
                          aria-label="Progreso de reproducción"
                          aria-valuemin={0}
                          aria-valuemax={Math.round(player.duration || 100)}
                          aria-valuenow={Math.round(player.currentTime)}
                          onClick={(e) => {
                            if (player.duration <= 0) return;
                            const rect = e.currentTarget.getBoundingClientRect();
                            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                            player.seek(ratio * player.duration);
                          }}
                          className="flex-1 h-1.5 rounded-full bg-[rgba(244,239,230,0.12)] cursor-pointer relative overflow-hidden group"
                        >
                          <div
                            className="h-full rounded-full bg-[#d43822] group-hover:bg-[#e6522e] transition-[width] duration-150"
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                        <span className="text-xs font-light text-[#b8b2a8] tnum w-10 text-right">
                          {player.duration > 0
                            ? formatSecondsToMMSS(player.duration)
                            : player.activeTrack?.duration || '0:00'}
                        </span>
                      </div>
                    </div>

                    {/* Numbered Tracklist */}
                    {player.activeAlbum.tracks.length === 0 ? (
                      <div className="py-10 text-sm font-light text-[#7c7770]">
                        Este álbum aún no tiene pistas cargadas. Agrégalas en el módulo CMS.
                      </div>
                    ) : (
                      <div className="mt-2 space-y-1">
                        {player.activeAlbum.tracks.map((track, idx) => {
                          const isCurrent = player.activeTrack?.id === track.id;
                          return (
                            <button
                              key={track.id}
                              type="button"
                              onClick={() => player.playTrack(player.activeAlbum!, idx)}
                              className={`w-full text-left py-3.5 px-4 rounded-xl flex items-center justify-between gap-4 transition-colors cursor-pointer group ${
                                isCurrent
                                  ? 'bg-[#b91d1d]/18 border border-[#b91d1d]/35 text-[#f4efe6]'
                                  : 'border border-transparent hover:bg-[rgba(244,239,230,0.045)] text-[#b8b2a8] hover:text-[#f4efe6]'
                              }`}
                            >
                              <div className="flex items-center gap-4 min-w-0">
                                <span
                                  className={`lion-display text-2xl w-8 shrink-0 ${
                                    isCurrent ? 'text-[#e6522e] font-bold' : 'text-[#7c7770] group-hover:text-[#f4efe6]'
                                  }`}
                                >
                                  {String(idx + 1).padStart(2, '0')}
                                </span>
                                <div className="min-w-0">
                                  <div className="font-semibold text-[15px] tracking-[-0.01em] truncate text-inherit">
                                    {track.title}
                                  </div>
                                  {!track.audio_url && (
                                    <div className="text-[11px] font-light text-[#7c7770]">
                                      Sin archivo de audio vinculado
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-4 shrink-0">
                                {isCurrent && player.isPlaying ? (
                                  <EqBars active={true} className="text-[#e6522e]" />
                                ) : (
                                  <Play
                                    size={14}
                                    className="opacity-0 group-hover:opacity-100 text-[#e6522e] transition-opacity"
                                  />
                                )}
                                <span
                                  className={`text-xs tnum ${
                                    isCurrent ? 'text-[#f4efe6] font-semibold' : 'text-[#7c7770] font-light'
                                  }`}
                                >
                                  {track.duration || '0:00'}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* =====================================================================
            4. VIDEOS Y SESIONES EN VIVO (Cinema Poster + Elevated Media Grid)
           ===================================================================== */}
        <section id="videos" className="py-20 lg:py-28 px-5 sm:px-8 lg:px-12 bg-[#09090b]">
          <div className="max-w-[1360px] mx-auto">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
              <div>
                <div className="lion-display-bold text-xs tracking-[0.16em] text-[#e6522e] mb-2">
                  ARCHIVO AUDIOVISUAL · DIRECTOS
                </div>
                <h2 className="lion-display-l text-[#f4efe6]">
                  {renderSplitHeading('VIDEOS Y SESIONES')}
                </h2>
              </div>
              <p className="lion-body max-w-md">
                Videoclips oficiales, sesiones en vivo y tomas en el cuarto de ensayo en máxima calidad.
              </p>
            </div>

            <div className="lion-panel p-6 sm:p-8 lg:p-12">
              {!featuredVideo ? (
                <div className="py-14 rounded-2xl border border-dashed border-[rgba(244,239,230,0.14)] px-6 text-center space-y-4 bg-[#121215]/50">
                  <Film size={34} className="mx-auto text-[#e6522e]/75" />
                  <div className="lion-display text-2xl text-[#f4efe6]">
                    {renderSplitHeading('SIN VIDEOS PUBLICADOS AÚN')}
                  </div>
                  <p className="lion-body text-sm max-w-md mx-auto">
                    Sube archivos MP4/WebM o vincula videoclips de YouTube/Vimeo desde el módulo CMS.
                  </p>
                </div>
              ) : (
                <div className="space-y-8">
                  {/* Featured 16:9 Cinema Poster */}
                  <button
                    type="button"
                    onClick={() => openVideoModal(featuredVideo)}
                    className="relative w-full aspect-video max-h-[640px] rounded-[20px] bg-[#111114] border border-[rgba(244,239,230,0.1)] hover:border-[rgba(244,239,230,0.24)] overflow-hidden group text-left block cursor-pointer shadow-[0_32px_72px_-28px_rgba(0,0,0,0.88)] transition-colors"
                  >
                    <img
                      src={featuredVideo.thumbnail_url || getAutoVideoThumbnail(featuredVideo.video_url, heroImage)}
                      alt={featuredVideo.title}
                      className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
                    />
                    <div
                      className="absolute inset-0 transition-opacity duration-300"
                      style={{
                        background:
                          'linear-gradient(180deg, rgba(9,9,11,0.2) 0%, rgba(9,9,11,0.38) 54%, rgba(9,9,11,0.92) 100%)',
                      }}
                    />
                    <div className="absolute top-5 left-5 sm:top-7 sm:left-7 flex items-center gap-2.5">
                      <span className="lion-badge">{featuredVideo.category || 'DESTACADO'}</span>
                      {featuredVideo.duration && (
                        <span className="lion-badge lion-badge-subtle tnum">
                          {featuredVideo.duration}
                        </span>
                      )}
                    </div>

                    {/* Centered Play Emblem */}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-20 h-20 rounded-full border border-[#f4efe6]/40 bg-[#09090b]/65 backdrop-blur-md group-hover:bg-[#d43822] group-hover:border-[#d43822] text-[#f4efe6] flex items-center justify-center transition-all duration-200 group-hover:scale-105 shadow-2xl">
                        <Play size={28} fill="currentColor" className="ml-1" />
                      </div>
                    </div>

                    <div className="absolute bottom-5 inset-x-5 sm:bottom-8 sm:inset-x-8 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                      <div>
                        <h3 className="lion-title text-2xl sm:text-4xl text-[#f4efe6]">
                          {featuredVideo.title}
                        </h3>
                        {featuredVideo.description && (
                          <p className="text-sm font-light text-[#d5cfc5] mt-1.5 max-w-2xl line-clamp-2">
                            {featuredVideo.description}
                          </p>
                        )}
                      </div>
                      <span className="lion-label text-[11px] text-[#f4efe6]/85 group-hover:text-[#e6522e] transition-colors shrink-0">
                        Ver en pantalla completa →
                      </span>
                    </div>
                  </button>

                  {/* Secondary Videos Grid */}
                  {secondaryVideos.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {secondaryVideos.map((vid) => (
                        <button
                          key={vid.id}
                          type="button"
                          onClick={() => openVideoModal(vid)}
                          className="lion-card group text-left flex flex-col overflow-hidden cursor-pointer p-3.5 gap-3.5"
                        >
                          <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-[#111114]">
                            <img
                              src={vid.thumbnail_url || getAutoVideoThumbnail(vid.video_url, heroImage)}
                              alt={vid.title}
                              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                            />
                            <div className="absolute inset-0 bg-black/30 group-hover:bg-black/15 transition-colors flex items-center justify-center">
                              <span className="w-11 h-11 rounded-full border border-[#f4efe6]/70 bg-[#09090b]/70 group-hover:bg-[#d43822] group-hover:border-[#d43822] text-[#f4efe6] flex items-center justify-center transition-colors">
                                <Play size={17} fill="currentColor" className="ml-0.5" />
                              </span>
                            </div>
                            {vid.duration && (
                              <span className="absolute bottom-2.5 right-2.5 px-2 py-0.5 rounded bg-[#09090b]/85 text-[#f4efe6] lion-display-bold text-[11px] tnum">
                                {vid.duration}
                              </span>
                            )}
                          </div>
                          <div className="px-1 pb-1 space-y-1.5">
                            <span className="lion-badge lion-badge-ember text-[11px]">
                              {vid.category || 'VIDEO'}
                            </span>
                            <h4 className="lion-title text-lg text-[#f4efe6] group-hover:text-[#e6522e] transition-colors">
                              {vid.title}
                            </h4>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* =====================================================================
            5. GALERÍA FOTOGRÁFICA EDITORIAL + LIGHTBOX
           ===================================================================== */}
        <section id="fotos" className="py-20 lg:py-28 px-5 sm:px-8 lg:px-12 bg-[#09090b]">
          <div className="max-w-[1360px] mx-auto">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
              <div>
                <div className="lion-display-bold text-xs tracking-[0.16em] text-[#e6522e] mb-2">
                  EN ESCENARIO · ESTUDIO · BACKSTAGE
                </div>
                <h2 className="lion-display-l text-[#f4efe6]">
                  {renderSplitHeading('GALERÍA FOTOGRÁFICA')}
                </h2>
              </div>

              {photos.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {photoCategories.map((cat) => {
                    const active = photoFilter === cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setPhotoFilter(cat)}
                        className={`px-4 py-2 rounded-full lion-label text-[11px] transition-colors cursor-pointer ${
                          active
                            ? 'bg-[#b91d1d] text-[#f4efe6]'
                            : 'border border-[rgba(244,239,230,0.14)] bg-[#161619] text-[#b8b2a8] hover:text-[#f4efe6] hover:border-[rgba(244,239,230,0.3)]'
                        }`}
                      >
                        {cat}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="lion-panel p-6 sm:p-8 lg:p-10">
              {filteredPhotos.length === 0 ? (
                <div className="py-14 rounded-2xl border border-dashed border-[rgba(244,239,230,0.14)] px-6 text-center space-y-4 bg-[#121215]/50">
                  <Camera size={34} className="mx-auto text-[#e6522e]/75" />
                  <div className="lion-display text-2xl text-[#f4efe6]">
                    {renderSplitHeading('GALERÍA LISTA PARA TUS FOTOS')}
                  </div>
                  <p className="lion-body text-sm max-w-md mx-auto">
                    Carga fotos de conciertos, sesiones y backstage desde el módulo CMS y aparecerán aquí con visor de pantalla completa.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
                  {filteredPhotos.map((photo, idx) => (
                    <button
                      key={photo.id}
                      type="button"
                      onClick={() => setLightboxIndex(idx)}
                      className={`group relative rounded-2xl overflow-hidden bg-[#111114] border border-[rgba(244,239,230,0.08)] hover:border-[rgba(244,239,230,0.28)] transition-colors text-left cursor-pointer ${
                        idx === 0 && filteredPhotos.length >= 4 ? 'sm:col-span-2 aspect-[16/10]' : 'aspect-[4/3]'
                      }`}
                    >
                      <img
                        src={photo.image_url}
                        alt={photo.title || 'Fotografía de La Nación del León'}
                        loading="lazy"
                        className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#09090b]/92 via-[#09090b]/25 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-250 flex flex-col justify-end p-5 gap-1.5">
                        <span className="lion-badge w-fit text-[11px]">{photo.category}</span>
                        {photo.title && (
                          <span className="lion-title text-xl text-[#f4efe6]">{photo.title}</span>
                        )}
                        {photo.caption && (
                          <span className="text-xs font-light text-[#d5cfc5] line-clamp-2">
                            {photo.caption}
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* =====================================================================
            6. FECHAS DE GIRA (TOUR DATES)
           ===================================================================== */}
        <section id="gira" className="py-20 lg:py-28 px-5 sm:px-8 lg:px-12 bg-[#09090b]">
          <div className="max-w-[1360px] mx-auto">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
              <div>
                <div className="lion-display-bold text-xs tracking-[0.16em] text-[#e6522e] mb-2">
                  CONCIERTOS Y FESTIVALES
                </div>
                <h2 className="lion-display-l text-[#f4efe6]">
                  {renderSplitHeading('EN LA RUTA')}
                </h2>
              </div>
              <a
                href={`mailto:${profile.booking_email}?subject=Booking%20La%20Naci%C3%B3n%20del%20Le%C3%B3n`}
                className="lion-btn-wire"
              >
                <span>Solicitar fecha / Booking</span>
                <ArrowUpRight size={15} />
              </a>
            </div>

            <div className="lion-panel p-6 sm:p-8 lg:p-10">
              {events.length === 0 ? (
                <div className="py-12 rounded-2xl border border-dashed border-[rgba(244,239,230,0.14)] px-6 text-center space-y-3 bg-[#121215]/50">
                  <Calendar size={30} className="mx-auto text-[#e6522e]/75" />
                  <div className="lion-display text-2xl text-[#f4efe6]">
                    {renderSplitHeading('PRÓXIMAS FECHAS POR ANUNCIAR')}
                  </div>
                  <p className="lion-body text-sm max-w-md mx-auto">
                    Agrega conciertos desde el CMS para activar automáticamente el calendario, el ticker superior y la cuenta regresiva.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-[rgba(244,239,230,0.08)]">
                  {events.map((ev) => {
                    const dp = parseDateParts(ev.event_date);
                    const isSoldOut = ev.status.toUpperCase().includes('AGOTADO');
                    return (
                      <div
                        key={ev.id}
                        className="py-5 px-3 sm:px-5 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-5 hover:bg-[rgba(244,239,230,0.03)] transition-colors"
                      >
                        <div className="flex items-center gap-6">
                          <div className="w-20 shrink-0 rounded-xl bg-[#111114] border border-[rgba(244,239,230,0.08)] py-3 px-2 text-center">
                            <div className="lion-display-bold text-3xl text-[#e6522e] leading-none">
                              {dp.day}
                            </div>
                            <div className="lion-display text-xs tracking-[0.12em] text-[#b8b2a8] mt-1">
                              {dp.month} {dp.year}
                            </div>
                          </div>
                          <div>
                            <div className="lion-title text-xl sm:text-2xl text-[#f4efe6]">
                              {ev.venue}
                            </div>
                            <div className="flex flex-wrap items-center gap-2.5 mt-1.5 text-sm font-light text-[#b8b2a8]">
                              <span>{ev.city}</span>
                              <span className="text-[#5e5a54]">·</span>
                              <span
                                className={`lion-badge text-[11px] ${
                                  isSoldOut ? 'lion-badge-subtle !text-[#7c7770]' : ''
                                }`}
                              >
                                {ev.status}
                              </span>
                              {ev.notes && <span className="text-xs text-[#7c7770]">({ev.notes})</span>}
                            </div>
                          </div>
                        </div>

                        <div className="shrink-0">
                          {isSoldOut ? (
                            <span className="lion-label text-xs text-[#7c7770] px-6 py-3 rounded-full border border-[rgba(244,239,230,0.1)] inline-block">
                              Agotado
                            </span>
                          ) : ev.ticket_url ? (
                            <a
                              href={ev.ticket_url}
                              target="_blank"
                              rel="noreferrer"
                              className="lion-btn-wire"
                            >
                              <span>Entradas</span>
                              <ArrowUpRight size={15} />
                            </a>
                          ) : (
                            <a
                              href={`mailto:${profile.booking_email}?subject=Entradas%20${encodeURIComponent(ev.city)}`}
                              className="lion-btn-wire"
                            >
                              <span>Info show</span>
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* =====================================================================
            7. LA BANDA & MANIFIESTO
           ===================================================================== */}
        <section id="banda" className="py-20 lg:py-28 px-5 sm:px-8 lg:px-12 bg-[#09090b]">
          <div className="max-w-[1360px] mx-auto space-y-12">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-end">
              <div className="lg:col-span-7">
                <div className="lion-display-bold text-xs tracking-[0.16em] text-[#e6522e] mb-2">
                  IDENTIDAD Y SONIDO
                </div>
                <h2 className="lion-display-l text-[#f4efe6]">
                  {renderSplitHeading(profile.manifesto_title)}
                </h2>
              </div>
              <div className="lg:col-span-5">
                <p className="lion-lead">{profile.manifesto_body}</p>
              </div>
            </div>

            <div className="lion-panel p-6 sm:p-8 lg:p-10">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                {profile.members.map((member, idx) => (
                  <article
                    key={member.id || idx}
                    className="lion-card p-6 flex flex-col justify-between gap-4 relative overflow-hidden"
                  >
                    <div
                      className={`h-[2px] w-10 rounded-full ${
                        idx === 0 ? 'bg-[#d43822]' : 'bg-[rgba(244,239,230,0.2)]'
                      }`}
                    />
                    <div className="space-y-2">
                      <div className="lion-display-bold text-xs tracking-[0.14em] text-[#e6522e]">
                        {member.role}
                      </div>
                      <h3 className="lion-title text-xl text-[#f4efe6]">{member.name}</h3>
                      <p className="text-sm font-light text-[#b8b2a8] leading-relaxed pt-1">
                        {member.bio}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* =====================================================================
          8. BOOKING, NEWSLETTER & FOOTER
         ===================================================================== */}
      <footer id="contacto" className="pt-8 pb-20 px-5 sm:px-8 lg:px-12 bg-[#09090b]">
        <div className="max-w-[1360px] mx-auto space-y-16">
          {/* Elevated Newsletter Banner */}
          <div className="lion-panel p-8 sm:p-10 lg:p-12 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-6 space-y-2.5">
              <div className="lion-display-bold text-xs tracking-[0.16em] text-[#e6522e]">
                COMUNIDAD OFICIAL
              </div>
              <h2 className="lion-display-l text-[#f4efe6]">
                {renderSplitHeading('ÚNETE A LA MANADA')}
              </h2>
              <p className="lion-body max-w-md">
                Recibe estrenos antes que nadie, fechas secretas y accesos exclusivos a lanzamientos.
              </p>
            </div>
            <div className="lg:col-span-6">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newsletterEmail.trim()) return;
                  setNewsletterDone(true);
                  setNewsletterEmail('');
                }}
                className="w-full space-y-3"
              >
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    type="email"
                    required
                    value={newsletterEmail}
                    onChange={(e) => {
                      setNewsletterEmail(e.target.value);
                      setNewsletterDone(false);
                    }}
                    placeholder="tu@correo.com"
                    className="flex-1 rounded-full bg-[#101013] border border-[rgba(244,239,230,0.16)] focus:border-[#d43822] px-5 py-3.5 text-sm font-light text-[#f4efe6] placeholder:text-[#7c7770] outline-none transition-colors"
                  />
                  <button type="submit" className="lion-btn-ember shrink-0">
                    Suscribirse
                  </button>
                </div>
                {newsletterDone && (
                  <p className="text-xs font-normal tracking-[0.04em] text-[#e28b3b] pl-2">
                    Registro confirmado. Bienvenido a La Nación del León.
                  </p>
                )}
              </form>
            </div>
          </div>

          {/* Clean Studio Footer Columns */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-10 pt-2">
            <div className="col-span-2 md:col-span-1 space-y-4">
              <div className="flex items-center gap-3">
                <LionCrestMark className="w-9 h-9" />
                <span className="lion-display text-2xl text-[#f4efe6]">
                  {renderSplitHeading(profile.band_name)}
                </span>
              </div>
              <p className="text-sm font-light text-[#8b857c] leading-relaxed">
                Web oficial conectada en tiempo real a nuestro catálogo de estudio y plataforma de escenario.
              </p>
            </div>

            <div>
              <div className="lion-display-bold text-xs tracking-[0.16em] text-[#e6522e] mb-4">
                EXPLORAR
              </div>
              <ul className="space-y-2.5 text-sm font-light text-[#b8b2a8]">
                {NAV_ITEMS.map((n) => (
                  <li key={n.href}>
                    <a href={n.href} className="hover:text-[#f4efe6] transition-colors">
                      {n.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <div className="lion-display-bold text-xs tracking-[0.16em] text-[#e6522e] mb-4">
                ESCUCHAR &amp; SEGUIR
              </div>
              <ul className="space-y-2.5 text-sm font-light text-[#b8b2a8]">
                {profile.spotify_url && (
                  <li>
                    <a
                      href={profile.spotify_url}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-[#f4efe6] inline-flex items-center gap-1 transition-colors"
                    >
                      Spotify <ArrowUpRight size={13} />
                    </a>
                  </li>
                )}
                {profile.apple_music_url && (
                  <li>
                    <a
                      href={profile.apple_music_url}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-[#f4efe6] inline-flex items-center gap-1 transition-colors"
                    >
                      Apple Music <ArrowUpRight size={13} />
                    </a>
                  </li>
                )}
                {profile.youtube_url && (
                  <li>
                    <a
                      href={profile.youtube_url}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-[#f4efe6] inline-flex items-center gap-1 transition-colors"
                    >
                      YouTube <ArrowUpRight size={13} />
                    </a>
                  </li>
                )}
                {profile.instagram_url && (
                  <li>
                    <a
                      href={profile.instagram_url}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-[#f4efe6] inline-flex items-center gap-1 transition-colors"
                    >
                      Instagram <ArrowUpRight size={13} />
                    </a>
                  </li>
                )}
                {profile.tiktok_url && (
                  <li>
                    <a
                      href={profile.tiktok_url}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-[#f4efe6] inline-flex items-center gap-1 transition-colors"
                    >
                      TikTok <ArrowUpRight size={13} />
                    </a>
                  </li>
                )}
                {!profile.spotify_url &&
                  !profile.apple_music_url &&
                  !profile.youtube_url &&
                  !profile.instagram_url &&
                  !profile.tiktok_url && (
                    <li className="text-[#7c7770] text-xs">
                      Configura tus enlaces oficiales en el módulo CMS.
                    </li>
                  )}
              </ul>
            </div>

            <div>
              <div className="lion-display-bold text-xs tracking-[0.16em] text-[#e6522e] mb-4">
                BOOKING &amp; GESTIÓN
              </div>
              <a
                href={`mailto:${profile.booking_email}`}
                className="inline-flex items-center gap-2 text-sm font-light text-[#f4efe6] hover:text-[#e6522e] transition-colors break-all"
              >
                <Mail size={15} className="shrink-0 text-[#e6522e]" />
                <span>{profile.booking_email}</span>
              </a>
              <div className="mt-5">
                <Link
                  to={session ? '/nacion-cms' : '/login'}
                  className="lion-label text-[11px] text-[#b8b2a8] hover:text-[#f4efe6] inline-flex items-center gap-1.5 transition-colors"
                >
                  <Settings2 size={14} />
                  <span>Panel de contenido CMS</span>
                </Link>
              </div>
            </div>
          </div>

          <div className="pt-8 border-t border-[rgba(244,239,230,0.09)] flex flex-wrap items-center justify-between gap-4 text-xs font-light text-[#7c7770]">
            <span>
              {profile.band_name.toUpperCase()} © {new Date().getFullYear()} · Todos los derechos reservados
            </span>
            <a
              href="#top"
              className="lion-label text-[11px] text-[#f4efe6] hover:text-[#e6522e] inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-[rgba(244,239,230,0.12)] hover:border-[rgba(244,239,230,0.28)] transition-colors"
            >
              <span>Volver arriba</span>
              <ArrowUp size={13} />
            </a>
          </div>
        </div>
      </footer>

      {/* =====================================================================
          PERSISTENT FLOATING MINI-PLAYER (When scrolling past Hero with audio)
         ===================================================================== */}
      <AnimatePresence>
        {showFloatingPlayer && player.activeTrack && (player.isPlaying || player.currentTime > 0) && (
          <motion.div
            initial={{ y: 96, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 96, opacity: 0 }}
            transition={SPRING_UI}
            className="fixed bottom-4 inset-x-4 sm:inset-x-8 z-40 max-w-[1360px] mx-auto rounded-2xl bg-[#16161a]/95 backdrop-blur-2xl border border-[rgba(244,239,230,0.14)] px-4 sm:px-6 py-3 shadow-[0_20px_50px_rgba(0,0,0,0.85)]"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src={player.activeAlbum?.cover_url || DEFAULT_ALBUM_COVER}
                  alt={player.activeAlbum?.title || ''}
                  className="w-11 h-11 rounded-lg object-cover border border-[rgba(244,239,230,0.14)] shrink-0"
                />
                <div className="min-w-0">
                  <div className="lion-title text-sm sm:text-[15px] text-[#f4efe6] truncate">
                    {player.activeTrack.title}
                  </div>
                  <div className="lion-display-bold text-[11px] tracking-[0.12em] text-[#e6522e] truncate">
                    {player.activeAlbum?.title}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                <button
                  type="button"
                  onClick={player.prevTrack}
                  className="text-[#b8b2a8] hover:text-[#f4efe6] p-1.5 rounded-full cursor-pointer"
                  aria-label="Anterior"
                >
                  <SkipBack size={15} />
                </button>
                <button
                  type="button"
                  onClick={player.togglePlay}
                  className="w-10 h-10 rounded-full bg-[#d43822] hover:bg-[#e6522e] text-[#f4efe6] flex items-center justify-center cursor-pointer"
                  aria-label={player.isPlaying ? 'Pausar' : 'Reproducir'}
                >
                  {player.isPlaying ? (
                    <Pause size={16} fill="currentColor" />
                  ) : (
                    <Play size={16} fill="currentColor" className="ml-0.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={player.nextTrack}
                  className="text-[#b8b2a8] hover:text-[#f4efe6] p-1.5 rounded-full cursor-pointer"
                  aria-label="Siguiente"
                >
                  <SkipForward size={15} />
                </button>
              </div>

              <div className="hidden md:flex items-center gap-3 flex-1 max-w-md">
                <span className="text-xs font-light text-[#b8b2a8] tnum w-10 text-right">
                  {formatSecondsToMMSS(player.currentTime)}
                </span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(player.duration, 1)}
                  step={0.5}
                  value={Math.min(player.currentTime, Math.max(player.duration, 1))}
                  onChange={(e) => player.seek(Number(e.target.value))}
                  className="lion-scrubber flex-1"
                  aria-label="Barra de progreso"
                />
                <span className="text-xs font-light text-[#b8b2a8] tnum w-10">
                  {player.duration > 0 ? formatSecondsToMMSS(player.duration) : player.activeTrack.duration}
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* =====================================================================
          CINEMA VIDEO MODAL (Supports uploaded MP4/WebM + YouTube + Vimeo)
         ===================================================================== */}
      <AnimatePresence>
        {selectedVideoModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setSelectedVideoModal(null)}
            className="fixed inset-0 z-[80] bg-[#09090b]/95 backdrop-blur-2xl flex items-center justify-center p-4 sm:p-8"
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={SPRING_UI}
              onClick={(e) => e.stopPropagation()}
              className="lion-panel w-full max-w-5xl p-5 sm:p-7 space-y-5"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <span className="lion-badge">{selectedVideoModal.category}</span>
                  <h3 className="lion-title text-xl sm:text-3xl text-[#f4efe6]">
                    {selectedVideoModal.title}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedVideoModal(null)}
                  className="w-10 h-10 rounded-full border border-[rgba(244,239,230,0.18)] hover:border-[#d43822] text-[#f4efe6] flex items-center justify-center cursor-pointer shrink-0 transition-colors"
                  aria-label="Cerrar video"
                >
                  <X size={19} />
                </button>
              </div>

              <div className="aspect-video w-full rounded-2xl bg-black border border-[rgba(244,239,230,0.1)] overflow-hidden">
                {getEmbedVideoUrl(selectedVideoModal) ? (
                  <iframe
                    src={getEmbedVideoUrl(selectedVideoModal)!}
                    title={selectedVideoModal.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                    allowFullScreen
                    className="w-full h-full border-0"
                  />
                ) : (
                  <video
                    src={selectedVideoModal.video_url}
                    poster={selectedVideoModal.thumbnail_url || undefined}
                    controls
                    autoPlay
                    playsInline
                    className="w-full h-full object-contain"
                  />
                )}
              </div>

              {selectedVideoModal.description && (
                <p className="lion-body text-sm max-w-3xl">{selectedVideoModal.description}</p>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* =====================================================================
          FULLSCREEN PHOTO LIGHTBOX
         ===================================================================== */}
      <AnimatePresence>
        {lightboxIndex !== null && filteredPhotos[lightboxIndex] && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setLightboxIndex(null)}
            className="fixed inset-0 z-[80] bg-[#09090b]/96 backdrop-blur-2xl flex flex-col justify-between p-4 sm:p-8"
          >
            <div className="flex items-center justify-between gap-4 max-w-6xl w-full mx-auto">
              <div className="flex items-center gap-2.5">
                <span className="lion-badge tnum">
                  {String(lightboxIndex + 1).padStart(2, '0')} / {String(filteredPhotos.length).padStart(2, '0')}
                </span>
                <span className="lion-label text-xs text-[#b8b2a8]">
                  {filteredPhotos[lightboxIndex].category}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setLightboxIndex(null)}
                className="w-10 h-10 rounded-full border border-[rgba(244,239,230,0.18)] hover:border-[#d43822] text-[#f4efe6] flex items-center justify-center cursor-pointer transition-colors"
                aria-label="Cerrar visor"
              >
                <X size={19} />
              </button>
            </div>

            <div
              className="relative flex-1 flex items-center justify-center my-4 max-w-6xl w-full mx-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {filteredPhotos.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    setLightboxIndex((prev) =>
                      prev === null ? 0 : (prev - 1 + filteredPhotos.length) % filteredPhotos.length
                    )
                  }
                  className="absolute left-0 sm:left-2 z-10 w-12 h-12 rounded-full bg-[#16161a]/85 border border-[rgba(244,239,230,0.18)] hover:border-[#d43822] text-[#f4efe6] flex items-center justify-center cursor-pointer transition-colors"
                  aria-label="Foto anterior"
                >
                  <ChevronLeft size={21} />
                </button>
              )}

              <motion.img
                key={filteredPhotos[lightboxIndex].id}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.22, ease: EASE_EDITORIAL }}
                src={filteredPhotos[lightboxIndex].image_url}
                alt={filteredPhotos[lightboxIndex].title || ''}
                className="max-h-[74vh] max-w-full rounded-2xl object-contain border border-[rgba(244,239,230,0.12)]"
              />

              {filteredPhotos.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    setLightboxIndex((prev) => (prev === null ? 0 : (prev + 1) % filteredPhotos.length))
                  }
                  className="absolute right-0 sm:right-2 z-10 w-12 h-12 rounded-full bg-[#16161a]/85 border border-[rgba(244,239,230,0.18)] hover:border-[#d43822] text-[#f4efe6] flex items-center justify-center cursor-pointer transition-colors"
                  aria-label="Siguiente foto"
                >
                  <ChevronRight size={21} />
                </button>
              )}
            </div>

            <div className="max-w-6xl w-full mx-auto text-center space-y-1">
              {filteredPhotos[lightboxIndex].title && (
                <div className="lion-title text-xl text-[#f4efe6]">
                  {filteredPhotos[lightboxIndex].title}
                </div>
              )}
              {filteredPhotos[lightboxIndex].caption && (
                <p className="text-sm font-light text-[#b8b2a8]">
                  {filteredPhotos[lightboxIndex].caption}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
