import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { ImagePlus, Sparkles, Loader2, Wand2, Download, AlertCircle, X, SlidersHorizontal } from 'lucide-react';

export default function DesignTools() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  
  const [mode, setMode] = useState<'portrait' | 'fotorrealismo'>('fotorrealismo');
  const [creativity, setCreativity] = useState<number>(0.4);
  const [prompt, setPrompt] = useState<string>('high quality, 8k, photorealistic, professional photography, cinematic lighting');
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    
    if (!selected.type.startsWith('image/')) {
      setError('Por favor selecciona una imagen válida (JPG, PNG).');
      return;
    }
    
    setFile(selected);
    setError(null);
    setResultUrl(null);
    
    const url = URL.createObjectURL(selected);
    setPreviewUrl(url);
  };

  const sanitizeFileName = (name: string) =>
    name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '_');

  const processImage = async () => {
    if (!file) return;
    
    setIsProcessing(true);
    setError(null);
    setProgressText('Subiendo imagen original...');
    
    let storagePath = '';
    
    try {
      const cleanName = sanitizeFileName(file.name);
      storagePath = `design/temp/${Date.now()}_${cleanName}`;
      
      const { error: uploadError } = await supabase.storage
        .from('audios')
        .upload(storagePath, file, { contentType: file.type });
        
      if (uploadError) throw new Error(`Error subiendo imagen: ${uploadError.message}`);
      
      const imageUrl = supabase.storage.from('audios').getPublicUrl(storagePath).data.publicUrl;
      
      setProgressText(`Iniciando IA (${mode === 'portrait' ? 'Crystal' : 'Clarity Pro'})...`);
      
      const res = await fetch('/api/ai/upscale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          imageUrl, 
          mode, 
          creativity,
          prompt
        })
      });
      
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Error iniciando IA');
      
      const predictionId = data.predictionId;
      
      setProgressText('Reconstruyendo detalles e iluminación...');
      
      let done = false;
      let finalOutput = null;
      let attempts = 0;
      
      while (!done && attempts < 120) {
        attempts++;
        await new Promise(r => setTimeout(r, 2000));
        
        const statusRes = await fetch('/api/ai/upscale-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ predictionId })
        });
        
        const statusData = await statusRes.json();
        if (statusData.error) throw new Error(statusData.error);
        
        if (statusData.done) {
          done = true;
          if (statusData.failed) throw new Error(statusData.error || 'La IA falló al procesar la imagen');
          finalOutput = statusData.output;
        } else {
          // Si el estado es procesando, animar el texto un poco
          setProgressText(`Reconstruyendo detalles e iluminación${'.'.repeat(attempts % 4)}`);
        }
      }
      
      if (!finalOutput) throw new Error('Tiempo de espera agotado');
      
      setResultUrl(finalOutput);
      setProgressText('');
      
    } catch (err: any) {
      console.error(err);
      setError(err.message);
    } finally {
      setIsProcessing(false);
      // Limpiar archivo temporal en segundo plano
      if (storagePath) {
        supabase.storage.from('audios').remove([storagePath]).catch(console.error);
      }
    }
  };

  const springConfig = { type: "spring" as const, stiffness: 300, damping: 25 };

  return (
    <div className="h-full overflow-y-auto p-8 custom-scrollbar">
      <div className="max-w-5xl mx-auto space-y-8">
        
        <div className="flex items-center space-x-4 mb-8">
          <div className="p-3 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl shadow-lg shadow-indigo-500/20">
            <Wand2 size={28} className="text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">Herramientas de Diseño</h1>
            <p className="text-gray-400 mt-1">Transforma fotos caseras en calidad de estudio profesional (8K)</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Columna Izquierda: Controles y Upload */}
          <div className="space-y-6">
            
            {/* Modo Selection */}
            <div className="bg-[#111111] border border-white/5 p-6 rounded-3xl shadow-xl">
              <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-4 flex items-center">
                <SlidersHorizontal size={16} className="mr-2" />
                Configuración de IA
              </h2>
              
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-white mb-3">Modo de Mejora</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setMode('fotorrealismo')}
                      className={`py-3 px-4 rounded-xl border text-sm font-medium transition-all duration-200 ${
                        mode === 'fotorrealismo' 
                          ? 'bg-white text-black border-white shadow-lg' 
                          : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      Fotorrealismo
                    </button>
                    <button
                      onClick={() => setMode('portrait')}
                      className={`py-3 px-4 rounded-xl border text-sm font-medium transition-all duration-200 ${
                        mode === 'portrait' 
                          ? 'bg-white text-black border-white shadow-lg' 
                          : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      Retrato (Rostros)
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-3">
                    {mode === 'fotorrealismo' 
                      ? 'Clarity Pro: Añade textura, iluminación de estudio y reconstruye detalles. Ideal para fotos generales.' 
                      : 'Crystal: Preserva la identidad de la persona al 100% mejorando la calidad. Ideal para selfies o primeros planos.'}
                  </p>
                </div>

                <AnimatePresence>
                  {mode === 'fotorrealismo' && (
                    <motion.div 
                      initial={{ opacity: 0, height: 0 }} 
                      animate={{ opacity: 1, height: 'auto' }} 
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="pt-2">
                        <label className="flex justify-between text-sm font-medium text-white mb-3">
                          <span>Creatividad</span>
                          <span className="text-indigo-400">{creativity}</span>
                        </label>
                        <input 
                          type="range" 
                          min="0" max="1" step="0.1" 
                          value={creativity}
                          onChange={(e) => setCreativity(parseFloat(e.target.value))}
                          className="w-full accent-indigo-500"
                        />
                        <p className="text-xs text-gray-500 mt-2">
                          0 = Estricta fidelidad al original. 1 = Reimagina texturas e iluminación libremente.
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                
                <div className="pt-2">
                  <label className="block text-sm font-medium text-white mb-3">Prompt de Ayuda (Opcional)</label>
                  <textarea 
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all resize-none"
                    rows={3}
                    placeholder="Describe la foto para guiar a la IA..."
                  />
                </div>
              </div>
            </div>

            {/* Error Banner */}
            <AnimatePresence>
              {error && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                  className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 flex items-start space-x-3 text-red-400"
                >
                  <AlertCircle size={20} className="shrink-0 mt-0.5" />
                  <p className="text-sm flex-1">{error}</p>
                  <button onClick={() => setError(null)} className="opacity-50 hover:opacity-100">
                    <X size={16} />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
            
          </div>

          {/* Columna Derecha: Preview y Resultados */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Upload Zone */}
            <div 
              onClick={() => !isProcessing && fileInputRef.current?.click()}
              className={`relative bg-[#111111] border-2 border-dashed ${file ? 'border-white/10' : 'border-indigo-500/30 hover:border-indigo-500/60'} rounded-3xl h-[400px] flex items-center justify-center overflow-hidden transition-all duration-300 cursor-pointer group`}
            >
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
                accept="image/jpeg, image/png, image/webp" 
                className="hidden" 
              />
              
              <AnimatePresence mode="wait">
                {previewUrl ? (
                  <motion.div 
                    key="preview"
                    initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.05 }}
                    transition={springConfig}
                    className="w-full h-full relative"
                  >
                    <img src={previewUrl} alt="Preview" className="w-full h-full object-contain p-4" />
                    
                    {/* Overlay de Procesamiento */}
                    <AnimatePresence>
                      {isProcessing && (
                        <motion.div 
                          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                          className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-8"
                        >
                          <Loader2 size={48} className="text-indigo-500 animate-spin mb-6" />
                          <p className="text-lg font-medium text-white">{progressText}</p>
                          <p className="text-sm text-gray-400 mt-2 text-center">
                            Esto puede tomar unos 30-60 segundos dependiendo de la resolución de la foto original y la cola de la GPU.
                          </p>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                ) : (
                  <motion.div 
                    key="empty"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="text-center p-8"
                  >
                    <div className="w-20 h-20 bg-indigo-500/10 rounded-full flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform duration-300">
                      <ImagePlus size={32} className="text-indigo-400" />
                    </div>
                    <h3 className="text-xl font-medium text-white mb-2">Sube una foto casera</h3>
                    <p className="text-gray-400 text-sm max-w-sm mx-auto">
                      Arrastra una imagen o haz clic para buscar. JPG o PNG.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Action Button */}
            {file && !resultUrl && (
              <motion.button
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                whileTap={{ scale: 0.98 }}
                onClick={processImage}
                disabled={isProcessing}
                className="w-full bg-white text-black py-4 rounded-2xl font-bold text-lg hover:bg-gray-100 transition-colors flex items-center justify-center space-x-2 shadow-[0_0_40px_-10px_rgba(255,255,255,0.3)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Sparkles size={24} />
                <span>Transformar a Calidad de Estudio</span>
              </motion.button>
            )}

            {/* Resultado Final */}
            <AnimatePresence>
              {resultUrl && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                  transition={springConfig}
                  className="bg-[#111111] border border-white/10 rounded-3xl overflow-hidden shadow-2xl"
                >
                  <div className="p-6 border-b border-white/5 flex justify-between items-center">
                    <div>
                      <h3 className="text-xl font-bold text-white flex items-center">
                        <Sparkles size={20} className="text-yellow-400 mr-2" />
                        Resultado Profesional
                      </h3>
                      <p className="text-sm text-gray-400 mt-1">
                        Imagen generada en resolución 8K
                      </p>
                    </div>
                    <a 
                      href={resultUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="bg-white/10 hover:bg-white/20 text-white p-3 rounded-xl transition-colors flex items-center space-x-2"
                    >
                      <Download size={20} />
                      <span className="text-sm font-medium">Descargar</span>
                    </a>
                  </div>
                  
                  <div className="relative bg-black h-[500px] flex items-center justify-center p-4">
                    <img src={resultUrl} alt="Resultado Final" className="max-w-full max-h-full object-contain shadow-2xl rounded-lg" />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

          </div>
        </div>
      </div>
    </div>
  );
}
