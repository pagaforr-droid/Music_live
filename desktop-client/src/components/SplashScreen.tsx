import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { TanduMusicosLogo } from './TanduMusicosLogo';

export { TanduMusicosLogo };

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

// Bar loader style animation for /STAGE (White color per user specification)
export const OneLoader = ({ skipAnimation = false }: { skipAnimation?: boolean }) => {
  const text = '/STAGE';
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
      transition={{ staggerChildren: skipAnimation ? 0 : 0.1, delayChildren: skipAnimation ? 0 : 0.45 }}
      initial="initial"
      animate="animate"
      className="flex items-center text-white font-light text-3xl md:text-4xl tracking-tight ml-2.5"
    >
      {text.split('').map((char, index) => (
        <motion.span key={index} variants={variants} className="inline-block origin-bottom text-white">
          {char}
        </motion.span>
      ))}
    </motion.div>
  );
};

export const StageLoader = OneLoader;

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
        {/* Glow de fondo rojo escénico para profundidad cinemática */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.2, ease: HYPER_EASE }}
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
        >
          <div className="w-80 sm:w-96 h-80 sm:h-96 bg-[#ef4444] rounded-full opacity-[0.07] blur-[85px]" />
          <div className="w-64 h-64 bg-red-700 rounded-full opacity-[0.04] blur-[70px] -translate-y-10" />
        </motion.div>

        <div className="relative z-10 flex flex-col items-center w-full max-w-lg">
          {/* Animated SVG Logo Container: Escala proporcional según dispositivo */}
          <div className="relative w-40 h-40 sm:w-48 sm:h-48 md:w-52 md:h-52 mb-6 sm:mb-8 mt-2 flex items-center justify-center">
            {/* Outer Subtle Ring */}
            <div className="absolute inset-2 rounded-full border border-gray-600/20" />
            {/* Spinning Tandu Stage Red Ring */}
            <div className="absolute inset-2 rounded-full border-2 border-transparent border-t-[#ef4444] border-r-[#ef4444] opacity-85 animate-spin-slow" />

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
              <FlipText skipAnimation={!isInitialLoad} baseDelay={0.35} className="text-[#ef4444]">
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

              {/* Nivel 2: MUSICOS + /STAGE (BLANCO) */}
              <div className="flex items-center justify-center gap-2">
                <div className="text-xl sm:text-2xl text-[#ef4444] font-black tracking-wider uppercase">
                  <FlipText skipAnimation={!isInitialLoad} baseDelay={0.35} className="text-[#ef4444]">
                    MUSICOS
                  </FlipText>
                </div>
                <span className="text-white text-xs font-semibold tracking-wider font-mono">
                  /STAGE
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

            {/* Barras de ecualizador / progreso animadas en Rojo Escénico */}
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
                className="h-4 w-1 bg-[#ef4444] rounded-full origin-bottom"
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
                className="h-4 w-1 bg-[#ef4444] rounded-full origin-bottom"
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
                className="h-4 w-1 bg-white rounded-full origin-bottom"
              />
            </motion.div>
          </motion.div>
        </div>
      </div>
    </>
  );
};
