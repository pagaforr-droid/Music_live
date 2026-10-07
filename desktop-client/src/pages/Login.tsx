import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { LogIn, Command, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function Login() {
  const [email, setEmail] = useState('admin@tandu.com');
  const [password, setPassword] = useState('123456');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        } else {
          const { error: retryError } = await supabase.auth.signInWithPassword({
            email,
            password,
          });
          if (retryError) setError(retryError.message);
        }
      } else {
        setError(signInError.message);
      }
    }
    
    setLoading(false);
  };

  // Emil Kowalski inspired spring transitions
  const springConfig = { type: "spring", stiffness: 400, damping: 30 };
  const staggerVariants = {
    hidden: { opacity: 0, y: 10 },
    visible: { opacity: 1, y: 0, transition: { staggerChildren: 0.1, ...springConfig } }
  };
  const itemVariants = {
    hidden: { opacity: 0, y: 10 },
    visible: { opacity: 1, y: 0, transition: springConfig }
  };

  return (
    <div className="min-h-screen w-full bg-black text-white flex items-center justify-center p-6 relative overflow-hidden font-sans selection:bg-white/30">
      
      {/* Impeccable Design: Subtle atmospheric lighting instead of generic blobs */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-white/[0.03] rounded-full blur-[120px] pointer-events-none" />

      <motion.div 
        initial="hidden"
        animate="visible"
        variants={staggerVariants}
        className="w-full max-w-[400px] relative z-10"
      >
        <div className="flex flex-col items-center mb-12">
          <motion.div 
            variants={itemVariants}
            className="w-14 h-14 bg-gradient-to-br from-white/10 to-white/5 border border-white/10 rounded-2xl flex items-center justify-center mb-6 shadow-2xl"
          >
            <Command size={24} className="text-white" />
          </motion.div>
          <motion.h1 variants={itemVariants} className="text-3xl font-medium tracking-tight mb-2">
            Tandu Live Hub
          </motion.h1>
          <motion.p variants={itemVariants} className="text-sm text-[#888888]">
            Plataforma de Autenticación
          </motion.p>
        </div>

        <motion.div 
          variants={itemVariants}
          className="bg-[#0A0A0A] border border-white/[0.08] p-8 rounded-[24px] shadow-2xl"
        >
          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-[#888888] ml-1">Email</label>
              <input 
                type="email" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-white/[0.03] border border-white/[0.08] rounded-2xl px-4 py-3.5 text-sm text-white placeholder-[#444444] focus:outline-none focus:border-white/20 focus:bg-white/[0.05] transition-colors duration-200"
                placeholder="admin@tandu.com"
                required
              />
            </div>
            
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-[#888888] ml-1">Password</label>
              <input 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white/[0.03] border border-white/[0.08] rounded-2xl px-4 py-3.5 text-sm text-white placeholder-[#444444] focus:outline-none focus:border-white/20 focus:bg-white/[0.05] transition-colors duration-200"
                placeholder="••••••"
                required
              />
            </div>

            <AnimatePresence>
              {error && (
                <motion.div 
                  initial={{ opacity: 0, height: 0, marginTop: 0 }}
                  animate={{ opacity: 1, height: 'auto', marginTop: 16 }}
                  exit={{ opacity: 0, height: 0, marginTop: 0 }}
                  className="overflow-hidden"
                >
                  <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-[13px]">
                    {error}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <motion.button 
              whileTap={{ scale: 0.98 }}
              type="submit" 
              disabled={loading}
              className="w-full bg-white hover:bg-[#EAEAEA] text-black font-medium py-3.5 rounded-2xl transition-colors duration-200 flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed mt-2"
            >
              {loading ? (
                <Loader2 size={18} className="animate-spin text-black/50" />
              ) : (
                <LogIn size={18} />
              )}
              <span>{loading ? 'Autenticando...' : 'Iniciar Sesión'}</span>
            </motion.button>
          </form>
        </motion.div>

        <motion.p 
          variants={itemVariants}
          className="text-center text-[#555555] text-xs mt-8 px-4"
        >
          Cuenta de pruebas preconfigurada. Si no existe, se creará automáticamente.
        </motion.p>
      </motion.div>
    </div>
  );
}
