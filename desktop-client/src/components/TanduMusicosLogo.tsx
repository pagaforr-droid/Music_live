import React from 'react';

/**
 * TanduMusicosLogo — HyperFrames-choreographed SVG Logo
 * Lightweight pure-SVG component (kept separate from Framer Motion SplashScreen
 * so shell routes like Layout do not eagerly bundle motion primitives).
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

        {/* Dynamic Stage Red gradient for Tandu script */}
        <linearGradient id="tandu-red-grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#ff4d6d" />
          <stop offset="50%" stopColor="#ef4444" />
          <stop offset="100%" stopColor="#dc2626" />
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

      {/* 3. HORIZONTAL GUITAR NECK / ACOUSTIC NEEDLE (Rightward tapered spike with Red accent) */}
      <g className={animateEntrance ? 'hf-whip-needle' : ''}>
        <path
          d="M 192 98 L 292 88 C 294 88, 294 90, 292 90.5 L 190 107 Z"
          fill="#ffffff"
        />
        {/* Stage Red energy highlight along the needle edge */}
        <path
          d="M 196 101.5 L 286 89.5 L 195 104.5 Z"
          fill="#ef4444"
          opacity="0.9"
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

      {/* 5. SUB-SCRIPT WORDMARK: "Tandu" (replaces "company" in Stage Red) */}
      <g
        className={animateEntrance ? 'hf-pop-tandu' : ''}
        transform="translate(88, 158) rotate(-5)"
      >
        <text
          x="0"
          y="0"
          fill="url(#tandu-red-grad)"
          stroke="#ef4444"
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
