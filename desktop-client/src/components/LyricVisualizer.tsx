import React, { useEffect, useRef } from 'react';

interface LyricLine {
  id: string;
  text: string;
  startMs: number;
  durationMs: number;
  effect: 'smooth-blur' | 'kinetic' | 'double-exposure' | 'chromatic-glow' | 'gradient-wipe' | 'write-on' | 'glitch' | 'liquid';
  fontFamily: 'Montserrat' | 'Bebas Neue' | 'Playfair Display' | 'Roboto Slab' | 'Nexa Rust' | 'Northwell';
}

interface LyricVisualizerProps {
  currentTime: number;
  lyrics: LyricLine[];
  isPlaying: boolean;
}

export const LyricVisualizer: React.FC<LyricVisualizerProps> = ({ currentTime, lyrics, isPlaying }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  // We need to continuously render if isPlaying is true.
  // Because currentTime comes as a prop, it might be updated only every 100ms or 50ms depending on the parent.
  // To get smooth 60fps, we should interpolate or just run our own RAF that reads the latest currentTime.
  // We'll use a local time state that smooths it out, or just use the prop.
  
  useEffect(() => {
    let animationFrameId: number;
    let localTime = currentTime * 1000; // converting to ms? 
    // Wait, in LiveConcert.tsx, currentTime is in seconds!
    // Let's verify: formatTime(currentTime) -> mins = Math.floor(time/60). So currentTime is in seconds.
    // In LyricStudio.tsx, currentTime is in ms. We need to convert.

    const render = () => {
      if (!canvasRef.current) return;
      const ctx = canvasRef.current.getContext('2d');
      if (!ctx) return;

      const canvasW = canvasRef.current.width;
      const canvasH = canvasRef.current.height;

      // Ensure timeMs is accurate. We use the prop directly for sync, multiplied by 1000 to get ms.
      const timeMs = currentTime * 1000;

      // Dynamic Background
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#050505';
      ctx.fillRect(0, 0, canvasW, canvasH);
      const pulse = Math.sin(timeMs / 500) * 0.1 + 0.9;
      const grad = ctx.createRadialGradient(canvasW/2, canvasH/2, 0, canvasW/2, canvasH/2, canvasW/1.5);
      grad.addColorStop(0, `rgba(40, 10, 20, ${0.3 * pulse})`);
      grad.addColorStop(1, '#050505');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvasW, canvasH);

      // Draw Lyrics
      if (lyrics && lyrics.length > 0) {
        lyrics.forEach(line => {
          if (timeMs >= line.startMs && timeMs <= line.startMs + line.durationMs) {
            const progress = (timeMs - line.startMs) / line.durationMs;
            
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            let fontFace = '"Inter", sans-serif';
            if (line.fontFamily === 'Bebas Neue') fontFace = '"Bebas Neue", "Alternate Gothic", sans-serif';
            if (line.fontFamily === 'Playfair Display') fontFace = '"Playfair Display", serif';
            if (line.fontFamily === 'Montserrat') fontFace = '"Montserrat", sans-serif';
            if (line.fontFamily === 'Roboto Slab') fontFace = '"Roboto Slab", serif';
            
            ctx.font = `900 130px ${fontFace}`;

            const words = line.text.split(' ');
            const wordSpacing = 50;
            
            let totalWidth = 0;
            const wordWidths = words.map(w => {
              const wWidth = ctx.measureText(w).width;
              totalWidth += wWidth;
              return wWidth;
            });
            totalWidth += wordSpacing * (words.length - 1);
            
            let currentX = -(totalWidth / 2);
            
            words.forEach((word, wordIndex) => {
              const staggerDelay = wordIndex * (0.3 / words.length); 
              let wordProgress = 0;
              if (progress > staggerDelay) {
                  wordProgress = Math.min((progress - staggerDelay) * (1 / (1 - staggerDelay)), 1);
              }
              
              if (wordProgress > 0) {
                  ctx.save();
                  const wordCenterX = currentX + wordWidths[wordIndex] / 2;
                  
                  let scale = 1;
                  let yOffset = 0;
                  let opacity = 1;
                  
                  // 1. Smooth Blur Reveal
                  if (line.effect === 'smooth-blur') {
                    if (wordProgress < 0.2) {
                        const p = wordProgress / 0.2;
                        opacity = p;
                        scale = 0.9 + p * 0.1;
                        ctx.filter = `blur(${20 * (1-p)}px)`;
                    } else if (wordProgress > 0.8) {
                        const p = (wordProgress - 0.8) / 0.2;
                        opacity = 1 - p;
                        scale = 1 + p * 0.1;
                        ctx.filter = `blur(${20 * p}px)`;
                    }
                    ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
                  } 
                  // 2. Kinetic Typography
                  else if (line.effect === 'kinetic') {
                    if (wordProgress < 0.2) {
                        const p = wordProgress / 0.2;
                        scale = 0.2 + (Math.sin(p * Math.PI * 1.5) * p * 1.2); 
                        opacity = p;
                    } else if (wordProgress > 0.8) {
                        const p = (wordProgress - 0.8) / 0.2;
                        scale = 1 + Math.pow(p, 3);
                        opacity = 1 - p;
                    }
                    ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
                  }
                  // 3. Chromatic Glow
                  else if (line.effect === 'chromatic-glow') {
                    if (wordProgress < 0.15) opacity = wordProgress / 0.15;
                    else if (wordProgress > 0.85) opacity = 1 - ((wordProgress - 0.85) / 0.15);
                    
                    const aberration = (Math.sin(timeMs / 100) * 5) * (1 - opacity) + 2;
                    
                    ctx.globalCompositeOperation = 'screen';
                    ctx.fillStyle = `rgba(255, 0, 0, ${opacity})`;
                    ctx.fillText(word, -aberration, 0);
                    ctx.fillStyle = `rgba(0, 255, 0, ${opacity})`;
                    ctx.fillText(word, 0, 0);
                    ctx.fillStyle = `rgba(0, 0, 255, ${opacity})`;
                    ctx.fillText(word, aberration, 0);
                    ctx.globalCompositeOperation = 'source-over';
                    ctx.fillStyle = 'transparent'; 
                  }
                  // 4. Gradient Wipe
                  else if (line.effect === 'gradient-wipe') {
                    if (wordProgress < 0.1) opacity = wordProgress / 0.1;
                    else if (wordProgress > 0.9) opacity = 1 - ((wordProgress - 0.9) / 0.1);
                    
                    ctx.fillStyle = `rgba(50, 50, 50, ${opacity})`;
                    ctx.fillText(word, 0, 0);
                    
                    ctx.save();
                    ctx.beginPath();
                    const wipeX = -wordWidths[wordIndex]/2 + (wordWidths[wordIndex] * (wordProgress * 1.5));
                    ctx.rect(-wordWidths[wordIndex], -100, wipeX + wordWidths[wordIndex], 200);
                    ctx.clip();
                    const textGrad = ctx.createLinearGradient(-wordWidths[wordIndex]/2, 0, wordWidths[wordIndex]/2, 0);
                    textGrad.addColorStop(0, `rgba(255,255,255,${opacity})`);
                    textGrad.addColorStop(1, `rgba(255,255,255,${opacity*0.2})`);
                    ctx.fillStyle = textGrad;
                    ctx.fillText(word, 0, 0);
                    ctx.restore();
                    
                    ctx.fillStyle = 'transparent';
                  }
                  // 5. Glitch
                  else if (line.effect === 'glitch') {
                    if (wordProgress < 0.1) opacity = wordProgress / 0.1;
                    else if (wordProgress > 0.9) opacity = 1 - ((wordProgress - 0.9) / 0.1);
                    
                    ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
                    if (wordProgress > 0.3 && wordProgress < 0.7 && Math.random() > 0.8) {
                        ctx.transform(1, 0, (Math.random()-0.5)*0.5, 1, 0, 0);
                        ctx.fillText(word, (Math.random()-0.5)*20, (Math.random()-0.5)*10);
                    }
                  }
                  else {
                    if (wordProgress < 0.2) opacity = wordProgress / 0.2;
                    else if (wordProgress > 0.8) opacity = 1 - ((wordProgress - 0.8) / 0.2);
                    ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
                  }
                  
                  ctx.translate(canvasW/2 + wordCenterX, canvasH/2 + yOffset);
                  ctx.scale(scale, scale);
                  if (ctx.fillStyle !== 'transparent') {
                    ctx.fillText(word, 0, 0);
                  }
                  ctx.restore();
              }
              currentX += wordWidths[wordIndex] + wordSpacing;
            });
          }
        });
      }

      animationFrameId = requestAnimationFrame(render);
    };

    // Always run render loop so it updates smoothly even if currentTime prop is updated at 10hz.
    // If we only relied on the prop, it would look choppy. 
    // Actually, since we use requestAnimationFrame, it will read currentTime.
    // However, if currentTime is stale, it will stay in place.
    // That's fine because when playing, React re-renders frequently or we can just interpolate.
    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [currentTime, lyrics, isPlaying]);

  return (
    <canvas 
      ref={canvasRef} 
      width={1920} 
      height={1080} 
      className="w-full h-full object-cover" 
    />
  );
};
