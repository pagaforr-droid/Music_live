import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { LogIn, Loader2, Lock, Mail, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { SplashScreen, FlipText, OneLoader, TanduMusicosLogo } from '../components/SplashScreen';

// Shared Emil Kowalski spring physics config
const springTransition: any = { type: 'spring', stiffness: 300, damping: 25 };

export default function Login() {
  const [email, setEmail] = useState('admin@tandu.com');
  const [password, setPassword] = useState('123456');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [replayingIntro, setReplayingIntro] = useState(false);

  const triggerReplayIntro = () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('tandu_musicos_intro_played');
    }
    setReplayingIntro(true);
    setTimeout(() => {
      setReplayingIntro(false);
    }, 3000);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      if (signInError.message.includes('Invalid login credentials')) {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
        });

        if (signUpError) {
          setError('Error: ' + signUpError.message);
          setShake(true);
          setTimeout(() => setShake(false), 500);
        } else {
          const { error: retryError } = await supabase.auth.signInWithPassword({
            email,
            password,
          });
          if (retryError) {
            setError(retryError.message);
            setShake(true);
            setTimeout(() => setShake(false), 500);
          }
        }
      } else {
        setError(signInError.message);
        setShake(true);
        setTimeout(() => setShake(false), 500);
      }
    }

    setLoading(false);
  };

  if (replayingIntro) {
    return <SplashScreen message="Preparando el entorno de trabajo..." />;
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#1e293b_0%,_#0f172a_100%)] flex flex-col items-center justify-center p-4 sm:p-8 relative overflow-hidden select-none">
      {/* Background ambient light */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-blue-500/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-red-500/10 blur-[120px] pointer-events-none" />

      <style>{`
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
          animation-delay: 0s;
        }
        .glass-ring {
          background: rgba(255, 255, 255, 0.025);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: inset 0 0 24px rgba(255, 255, 255, 0.025);
        }
      `}</style>

      {/* Header with Tandu Musicos Animated Emblem */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springTransition}
        className="mb-8 text-center z-10"
      >
        <div className="flex flex-col items-center gap-2 mb-2">
          {/* Animated SVG Logo Ring */}
          <motion.div
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.97 }}
            onClick={triggerReplayIntro}
            title="Haz clic para reproducir la intro de 3 segundos"
            className="relative w-32 h-32 sm:w-36 sm:h-36 mb-3 mt-1 flex items-center justify-center cursor-pointer group"
          >
            {/* Spinning Ring */}
            <div className="absolute inset-1 rounded-full border border-gray-600/20" />
            <div className="absolute inset-1 rounded-full border-2 border-transparent border-t-[#ef4444] border-r-[#ef4444] opacity-85 animate-spin-slow group-hover:opacity-100 transition-opacity" />

            {/* Glass Background */}
            <div className="absolute inset-3 rounded-full glass-ring" />

            {/* LOGO SVG ANIMADO (Guitarra + Musicos + Tandu) */}
            <TanduMusicosLogo
              animateEntrance={false}
              className="w-24 h-24 sm:w-28 sm:h-28"
            />
          </motion.div>

          {/* Desktop Brand Lockup */}
          <h1 className="hidden sm:flex text-2xl md:text-3xl tracking-[0.1em] items-center justify-center gap-2">
            <FlipText skipAnimation={true} className="font-black text-white">
              TANDU
            </FlipText>
            <FlipText skipAnimation={true} className="font-medium text-[#ef4444]">
              MUSICOS
            </FlipText>
            <OneLoader skipAnimation={true} />
          </h1>

          {/* Mobile Brand Lockup */}
          <h1 className="flex sm:hidden flex-col items-center leading-tight">
            <span className="text-xl font-black text-white tracking-[0.2em]">TANDU</span>
            <span className="flex items-center gap-1.5 text-lg font-black text-[#ef4444] tracking-wider">
              MUSICOS
              <span className="text-white text-xs font-semibold font-mono">/STAGE</span>
            </span>
          </h1>
        </div>
        <p className="text-slate-400 text-sm md:text-base tracking-wide font-light">
          Ingrese sus credenciales para acceder al estudio en vivo
        </p>
      </motion.div>

      {/* Glassmorphic Login Card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ ...springTransition, delay: 0.08 }}
        className="w-full max-w-md z-10"
      >
        <motion.div
          animate={shake ? { x: [-10, 10, -10, 10, 0] } : {}}
          transition={{ duration: 0.4 }}
          className="bg-white/[0.03] backdrop-blur-2xl border border-white/10 rounded-3xl shadow-2xl overflow-hidden"
        >
          {/* Card Header Bar */}
          <div className="px-8 pt-6 pb-4 border-b border-white/5 bg-gradient-to-b from-white/[0.04] to-transparent flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-2 h-2 rounded-full bg-[#ef4444] shadow-[0_0_8px_#ef4444]" />
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-300">
                Acceso Seguro
              </span>
            </div>
            <button
              type="button"
              onClick={triggerReplayIntro}
              className="text-[11px] text-slate-400 hover:text-[#ef4444] transition-colors flex items-center gap-1 font-medium cursor-pointer"
            >
              <Sparkles size={12} className="text-[#ef4444]" />
              <span>Intro 3s</span>
            </button>
          </div>

          <form onSubmit={handleLogin} className="p-8 space-y-5">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 ml-1 block">
                Correo Electrónico
              </label>
              <div className="relative">
                <Mail
                  size={16}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
                />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-white/[0.03] border border-white/10 rounded-2xl pl-11 pr-4 py-3.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[#ef4444]/60 focus:bg-white/[0.06] transition-all duration-200"
                  placeholder="admin@tandu.com"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 ml-1 block">
                Código / Contraseña
              </label>
              <div className="relative">
                <Lock
                  size={16}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
                />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-white/[0.03] border border-white/10 rounded-2xl pl-11 pr-4 py-3.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[#ef4444]/60 focus:bg-white/[0.06] transition-all duration-200"
                  placeholder="••••••"
                  required
                />
              </div>
            </div>

            <AnimatePresence mode="wait">
              {error && (
                <motion.div
                  key="error"
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="p-3.5 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-xs font-medium text-center"
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            <motion.button
              whileHover={{ scale: 1.015 }}
              whileTap={{ scale: 0.98 }}
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-[#ef4444] to-[#dc2626] hover:from-[#dc2626] hover:to-[#b91c1c] text-white font-bold py-4 rounded-2xl shadow-lg shadow-[#ef4444]/25 transition-all duration-200 flex items-center justify-center gap-2.5 disabled:opacity-50 disabled:cursor-not-allowed mt-2 cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="animate-spin text-white" />
                  <span className="tracking-wide text-sm">Autenticando...</span>
                </>
              ) : (
                <>
                  <LogIn size={18} />
                  <span className="tracking-wide text-sm">Ingresar al Estudio</span>
                </>
              )}
            </motion.button>
          </form>
        </motion.div>

        <p className="text-center text-slate-500 text-xs mt-6 px-4 font-light">
          Cuenta de pruebas preconfigurada. Si no existe, se creará automáticamente.
        </p>
      </motion.div>

      <div className="mt-10 sm:mt-0 sm:absolute sm:bottom-6 text-slate-500 text-[10px] uppercase tracking-widest font-bold">
        TANDU Systems © {new Date().getFullYear()}
      </div>
    </div>
  );
}
