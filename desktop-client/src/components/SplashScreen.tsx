import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

interface SplashScreenProps {
  loadingText?: string;
  message?: string;
}

const DURATION = 0.5;
const STAGGER = 0.045;

// Emil Kowalski & HyperFrames: Contextual decelerating cubic-bezier curve
const HYPER_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

// Intro flip animation for the main title
export const FlipText = ({
  children,
  className = '',
  skipAnimation = false,
  baseDelay = 0,
}: {
  children: string;
  className?: string;
  skipAnimation?: boolean;
  baseDelay?: number;
}) => {
  return (
    <motion.span
      initial="initial"
      animate="animate"
      className={`relative inline-block overflow-hidden whitespace-nowrap ${className}`}
    >
      <span className="flex">
        {children.split('').map((l, i) => (
          <motion.span
            variants={{
              initial: { y: skipAnimation ? 0 : '110%', rotateX: skipAnimation ? 0 : -40 },
              animate: { y: 0, rotateX: 0 },
            }}
            transition={{
              duration: DURATION,
              ease: HYPER_EASE,
              delay: skipAnimation ? 0 : baseDelay + STAGGER * i,
            }}
            className="inline-block will-change-transform"
            key={i}
          >
            {l === ' ' ? '\u00A0' : l}
          </motion.span>
        ))}
      </span>
    </motion.span>
  );
};

// Bar loader style animation for /ONE
export const OneLoader = ({ skipAnimation = false }: { skipAnimation?: boolean }) => {
  const text = '/ONE';
  const variants: any = {
    initial: {
      scaleY: skipAnimation ? 1 : 0.4,
      opacity: skipAnimation ? 1 : 0,
    },
    animate: {
      scaleY: 1,
      opacity: 1,
      transition: {
        duration: 0.7,
        ease: HYPER_EASE,
      },
    },
  };

  return (
    <motion.div
      transition={{ staggerChildren: skipAnimation ? 0 : 0.14, delayChildren: skipAnimation ? 0 : 0.45 }}
      initial="initial"
      animate="animate"
      className="flex items-center text-slate-400 font-light text-3xl md:text-4xl tracking-tight ml-2.5"
    >
      {text.split('').map((char, index) => (
        <motion.span key={index} variants={variants} className="inline-block origin-bottom">
          {char}
        </motion.span>
      ))}
    </motion.div>
  );
};

/**
 * TanduMusicosLogo — HyperFrames-choreographed SVG Logo
 * Recreates the iconic Guitar Silhouette + Brush Script Logo
 * replacing "Music" -> "Musicos" and "company" -> "Tandu"
 */
export const TanduMusicosLogo: React.FC<{
  animateEntrance?: boolean;
  className?: string;
}> = ({ animateEntrance = true, className = 'w-28 h-28 sm:w-32 sm:h-32 md:w-36 md:h-36' }) => {
  return (
    <svg
      className={`relative z-10 animate-heartbeat select-none ${className}`}
      viewBox="0 0 300 200"
      xmlns="http://www.w3.org/2000/svg"
      style={{
        filter: 'drop-shadow(0px 10px 20px rgba(0,0,0,0.55))',
        animationDelay: animateEntrance ? '1.5s' : '0s',
      }}
    >
      <defs>
        {/* HyperFrames svg-path-draw mask for variable-width guitar contour */}
        <mask id="hf-guitar-top-mask">
          <path
            className={animateEntrance ? 'hf-draw-guitar-top' : ''}
            d="M 38 76 C 56 36, 96 22, 122 44 C 138 58, 152 64, 172 54 C 194 43, 216 44, 222 66 C 225 76, 223 86, 222 93"
            fill="none"
            stroke="#ffffff"
            strokeWidth="26"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </mask>

        <mask id="hf-guitar-bottom-mask">
          <path
            className={animateEntrance ? 'hf-draw-guitar-bottom' : ''}
            d="M 218 110 C 213 132, 200 148, 182 158"
            fill="none"
            stroke="#ffffff"
            strokeWidth="18"
            strokeLinecap="round"
          />
        </mask>

        {/* Left-to-right brush reveal clip for "Musicos" */}
        <clipPath id="hf-musicos-clip">
          <rect
            className={animateEntrance ? 'hf-wipe-musicos' : ''}
            x="0"
            y="45"
            width="235"
            height="95"
          />
        </clipPath>

        {/* Subtle warm orange gradient for Tandu script */}
        <linearGradient id="tandu-orange-grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#ff7a33" />
          <stop offset="50%" stopColor="#f26722" />
          <stop offset="100%" stopColor="#ff944d" />
        </linearGradient>
      </defs>

      {/* 1. UPPER GUITAR BODY SILHOUETTE (Variable-width sculpted arch) */}
      <g mask="url(#hf-guitar-top-mask)">
        <path
          d="M 36 74
             C 52 34, 92 18, 122 39
             C 138 50, 150 56, 170 48
             C 194 38, 218 40, 225 62
             C 228 72, 227 83, 225 91
             L 215 91
             C 216 83, 216 73, 214 65
             C 209 50, 192 50, 173 58
             C 150 68, 134 62, 115 48
             C 90 30, 60 44, 47 72
             C 43 70, 39 71, 36 74 Z"
          fill="#ffffff"
        />
      </g>

      {/* 2. LOWER-RIGHT GUITAR CURVE (Sweeping down to embrace "Tandu") */}
      <g mask="url(#hf-guitar-bottom-mask)">
        <path
          d="M 213 109
             L 223 108
             C 218 131, 205 149, 184 160
             C 181 158, 181 155, 183 153
             C 199 143, 209 128, 213 109 Z"
          fill="#ffffff"
        />
      </g>

      {/* 3. HORIZONTAL GUITAR NECK / ACOUSTIC NEEDLE (Rightward tapered spike) */}
      <g className={animateEntrance ? 'hf-whip-needle' : ''}>
        <path
          d="M 192 98 L 292 88 C 294 88, 294 90, 292 90.5 L 190 107 Z"
          fill="#ffffff"
        />
        {/* Subtle Tandu Orange energy highlight along the needle edge */}
        <path
          d="M 196 101.5 L 286 89.5 L 195 104.5 Z"
          fill="#f26722"
          opacity="0.85"
        />
      </g>

      {/* 4. MAIN CALLIGRAPHIC SCRIPT: "Musicos" (replaces "Music") */}
      <g clipPath="url(#hf-musicos-clip)">
        <g
          className={animateEntrance ? 'hf-pop-musicos' : ''}
          transform="translate(14, 122) rotate(-6)"
        >
          <text
            x="8"
            y="0"
            fill="#ffffff"
            stroke="#ffffff"
            strokeWidth="1.4"
            paintOrder="stroke fill"
            style={{
              fontFamily: "'Kaushan Script', 'Yellowtail', cursive",
              fontSize: '51px',
              letterSpacing: '-0.5px',
            }}
          >
            Musicos
          </text>
        </g>
      </g>

      {/* 5. SUB-SCRIPT WORDMARK: "Tandu" (replaces "company") */}
      <g
        className={animateEntrance ? 'hf-pop-tandu' : ''}
        transform="translate(88, 158) rotate(-5)"
      >
        <text
          x="0"
          y="0"
          fill="url(#tandu-orange-grad)"
          stroke="#f26722"
          strokeWidth="0.6"
          paintOrder="stroke fill"
          style={{
            fontFamily: "'Kaushan Script', 'Yellowtail', cursive",
            fontSize: '33px',
            letterSpacing: '0.5px',
          }}
        >
          Tandu
        </text>
      </g>
    </svg>
  );
};

export const SplashScreen: React.FC<SplashScreenProps> = ({ loadingText, message }) => {
  const defaultMsg = 'Preparando el entorno de trabajo...';
  const displayMessage = message || loadingText || defaultMsg;

  // Detección Reactiva de Dispositivo (Móvil vs PC)
  const [, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768;
  });

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Inteligencia de Élite: Evitar que el Intro se repita en sub-montajes de la misma sesión
  const [isInitialLoad] = useState(() => {
    if (typeof window === 'undefined') return true;
    return !sessionStorage.getItem('tandu_musicos_intro_played');
  });

  useEffect(() => {
    if (isInitialLoad && typeof window !== 'undefined') {
      sessionStorage.setItem('tandu_musicos_intro_played', 'true');
    }
  }, [isInitialLoad]);

  return (
    <>
      <style>{`
        @keyframes shimmerText {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        .shimmer-text {
          background: linear-gradient(
            to right,
            rgba(148, 163, 184, 0.3) 20%,
            rgba(241, 245, 249, 0.95) 40%,
            rgba(241, 245, 249, 0.95) 60%,
            rgba(148, 163, 184, 0.3) 80%
          );
          background-size: 200% auto;
          color: transparent;
          -webkit-background-clip: text;
          background-clip: text;
          animation: shimmerText 3s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }

        /* ═══════════════════════════════════════════════════════════
           HYPERFRAMES 3.0s CHOREOGRAPHY (Seek-safe & Physics-driven)
           ═══════════════════════════════════════════════════════════ */
        @keyframes hfDrawGuitarTop {
          0% { stroke-dasharray: 320; stroke-dashoffset: 320; }
          100% { stroke-dasharray: 320; stroke-dashoffset: 0; }
        }
        @keyframes hfDrawGuitarBottom {
          0% { stroke-dasharray: 120; stroke-dashoffset: 120; }
          100% { stroke-dasharray: 120; stroke-dashoffset: 0; }
        }
        @keyframes hfWhipNeedle {
          0% { opacity: 0; transform: translateX(-36px) scaleX(0.15); }
          60% { opacity: 1; transform: translateX(4px) scaleX(1.04); }
          100% { opacity: 1; transform: translateX(0) scaleX(1); }
        }
        @keyframes hfWipeMusicos {
          0% { width: 0px; }
          100% { width: 235px; }
        }
        @keyframes hfPopMusicos {
          0% { opacity: 0; transform: translate(14px, 134px) rotate(-6deg) scale(0.92); }
          70% { opacity: 1; transform: translate(14px, 120px) rotate(-6deg) scale(1.02); }
          100% { opacity: 1; transform: translate(14px, 122px) rotate(-6deg) scale(1); }
        }
        @keyframes hfPopTandu {
          0% { opacity: 0; transform: translate(88px, 174px) rotate(-5deg) scale(0.75); }
          70% { opacity: 1; transform: translate(88px, 155px) rotate(-5deg) scale(1.06); }
          100% { opacity: 1; transform: translate(88px, 158px) rotate(-5deg) scale(1); }
        }

        .hf-draw-guitar-top {
          stroke-dasharray: 320;
          stroke-dashoffset: 320;
          animation: hfDrawGuitarTop 0.75s cubic-bezier(0.22, 1, 0.36, 1) 0.1s forwards;
        }
        .hf-draw-guitar-bottom {
          stroke-dasharray: 120;
          stroke-dashoffset: 120;
          animation: hfDrawGuitarBottom 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.7s forwards;
        }
        .hf-whip-needle {
          opacity: 0;
          transform-origin: 192px 102px;
          animation: hfWhipNeedle 0.55s cubic-bezier(0.16, 1, 0.3, 1) 0.45s forwards;
        }
        .hf-wipe-musicos {
          width: 0px;
          animation: hfWipeMusicos 0.65s cubic-bezier(0.22, 1, 0.36, 1) 0.35s forwards;
        }
        .hf-pop-musicos {
          opacity: 0;
          animation: hfPopMusicos 0.65s cubic-bezier(0.34, 1.56, 0.64, 1) 0.35s forwards;
        }
        .hf-pop-tandu {
          opacity: 0;
          animation: hfPopTandu 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.72s forwards;
        }

        @keyframes spin-slow {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .animate-spin-slow {
          animation: spin-slow 3s cubic-bezier(0.5, 0.1, 0.5, 0.9) infinite;
        }
        @keyframes heartbeat {
          0%, 100% { transform: scale(1); }
          15% { transform: scale(1.055); }
          30% { transform: scale(1); }
          45% { transform: scale(1.055); }
          60% { transform: scale(1); }
        }
        .animate-heartbeat {
          animation: heartbeat 2s ease-in-out infinite;
          animation-delay: 1.5s;
        }
        .glass-ring {
          background: rgba(255, 255, 255, 0.025);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: inset 0 0 24px rgba(255, 255, 255, 0.025);
        }
      `}</style>

      {/* Impeccable Design: Deep premium background matching Tandu Suite */}
      <div className="fixed inset-0 z-[9999] bg-[#1a202c] flex flex-col items-center justify-center overflow-hidden px-4 select-none">
        {/* Glow de fondo para profundidad cinemática (HyperFrames ambient-glow-bloom) */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.2, ease: HYPER_EASE }}
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
        >
          <div className="w-80 sm:w-96 h-80 sm:h-96 bg-[#f26722] rounded-full opacity-[0.06] blur-[85px]" />
          <div className="w-64 h-64 bg-blue-500 rounded-full opacity-[0.04] blur-[70px] -translate-y-10" />
        </motion.div>

        <div className="relative z-10 flex flex-col items-center w-full max-w-lg">
          {/* Animated SVG Logo Container: Escala proporcional según dispositivo */}
          <div className="relative w-40 h-40 sm:w-48 sm:h-48 md:w-52 md:h-52 mb-6 sm:mb-8 mt-2 flex items-center justify-center">
            {/* Outer Subtle Ring */}
            <div className="absolute inset-2 rounded-full border border-gray-600/20" />
            {/* Spinning Tandu Orange Ring */}
            <div className="absolute inset-2 rounded-full border-2 border-transparent border-t-[#f26722] border-r-[#f26722] opacity-85 animate-spin-slow" />

            {/* Glass Background */}
            <div className="absolute inset-4 sm:inset-6 rounded-full glass-ring" />

            {/* LOGO SVG ANIMADO (Guitarra + Musicos + Tandu) */}
            <TanduMusicosLogo
              animateEntrance={isInitialLoad}
              className="w-32 h-32 sm:w-36 sm:h-36 md:w-40 md:h-40"
            />
          </div>

          {/* ═══════════════════════════════════════════════════════════ */}
          {/* MODO 1: PC / ESCRITORIO (Disposición horizontal majestuosa) */}
          {/* ═══════════════════════════════════════════════════════════ */}
          <div className="hidden md:flex items-center mb-10 overflow-hidden px-4">
            <h1 className="text-4xl lg:text-5xl font-black tracking-tight flex items-center">
              <FlipText skipAnimation={!isInitialLoad} baseDelay={0.15} className="text-white mr-3">
                TANDU
              </FlipText>
              <FlipText skipAnimation={!isInitialLoad} baseDelay={0.35} className="text-[#f26722]">
                MUSICOS
              </FlipText>
            </h1>
            <OneLoader skipAnimation={!isInitialLoad} />
          </div>

          {/* ═══════════════════════════════════════════════════════════ */}
          {/* MODO 2: CELULAR / SMARTPHONE (Disposición vertical 100% visible) */}
          {/* ═══════════════════════════════════════════════════════════ */}
          <div className="flex md:hidden flex-col items-center justify-center mb-8 px-2 w-full max-w-[320px] text-center">
            <h1 className="font-black tracking-tight flex flex-col items-center leading-tight w-full">
              {/* Nivel 1: TANDU */}
              <div className="text-2xl sm:text-3xl text-white tracking-[0.2em] font-black uppercase mb-1">
                <FlipText skipAnimation={!isInitialLoad} baseDelay={0.15} className="text-white">
                  TANDU
                </FlipText>
              </div>

              {/* Nivel 2: MUSICOS + /ONE */}
              <div className="flex items-center justify-center gap-2">
                <div className="text-xl sm:text-2xl text-[#f26722] font-black tracking-wider uppercase">
                  <FlipText skipAnimation={!isInitialLoad} baseDelay={0.35} className="text-[#f26722]">
                    MUSICOS
                  </FlipText>
                </div>
                <span className="text-slate-400 text-xs font-light tracking-tight font-mono">
                  /ONE
                </span>
              </div>
            </h1>
          </div>

          {/* Indicador de carga minimalista y mensaje adaptativo */}
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4, ease: HYPER_EASE }}
            className="flex flex-col items-center text-center px-4"
          >
            <div className="text-[10px] sm:text-[11px] tracking-[0.25em] font-bold uppercase shimmer-text mb-4 max-w-xs leading-relaxed">
              {displayMessage}
            </div>

            {/* Barras de ecualizador / progreso animadas */}
            <motion.div
              transition={{ staggerChildren: 0.14 }}
              initial="initial"
              animate="animate"
              className="flex gap-1.5 items-end h-4"
            >
              <motion.div
                variants={{
                  initial: { scaleY: 0.45, opacity: 0.5 },
                  animate: {
                    scaleY: 1,
                    opacity: 1,
                    transition: {
                      repeat: Infinity,
                      repeatType: 'mirror',
                      duration: 0.55,
                      ease: 'easeInOut',
                    },
                  },
                } as any}
                className="h-4 w-1 bg-[#f26722] rounded-full origin-bottom"
              />
              <motion.div
                variants={{
                  initial: { scaleY: 0.45, opacity: 0.5 },
                  animate: {
                    scaleY: 1,
                    opacity: 1,
                    transition: {
                      repeat: Infinity,
                      repeatType: 'mirror',
                      duration: 0.55,
                      ease: 'easeInOut',
                    },
                  },
                } as any}
                className="h-4 w-1 bg-[#f26722] rounded-full origin-bottom"
              />
              <motion.div
                variants={{
                  initial: { scaleY: 0.45, opacity: 0.5 },
                  animate: {
                    scaleY: 1,
                    opacity: 1,
                    transition: {
                      repeat: Infinity,
                      repeatType: 'mirror',
                      duration: 0.55,
                      ease: 'easeInOut',
                    },
                  },
                } as any}
                className="h-4 w-1 bg-white/50 rounded-full origin-bottom"
              />
            </motion.div>
          </motion.div>
        </div>
      </div>
    </>
  );
};
