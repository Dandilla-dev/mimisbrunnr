// Фон из заготовок Мимира: узор «роза Селбу» и мягкое зелёное свечение.

/** Определение узора — один раз на всё приложение. */
export function NordicDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute' }}>
      <defs>
        <pattern id="selbu" width="64" height="64" patternUnits="userSpaceOnUse">
          <g stroke="#7FA08A" strokeWidth="1" fill="none">
            <path d="M32 6 L32 26 M32 38 L32 58 M6 32 L26 32 M38 32 L58 32 M14 14 L24 24 M40 24 L50 14 M14 50 L24 40 M40 40 L50 50" />
            <path d="M32 16 L38 24 L32 32 L26 24 Z" />
            <path d="M32 32 L38 40 L32 48 L26 40 Z" />
          </g>
        </pattern>
      </defs>
    </svg>
  );
}

export function NordicPatternLayer({ opacity = 0.07, className = '' }) {
  return (
    <svg className={`absolute inset-0 w-full h-full pointer-events-none z-0 ${className}`} style={{ opacity }} aria-hidden="true" focusable="false">
      <rect width="100%" height="100%" fill="url(#selbu)" />
    </svg>
  );
}

export function GreenGlow() {
  return (
    <div
      className="absolute inset-0 z-0 pointer-events-none"
      style={{ background: 'radial-gradient(ellipse 60% 50% at 15% 0%, rgba(87,138,102,0.10), transparent 60%), radial-gradient(ellipse 55% 45% at 100% 100%, rgba(87,138,102,0.07), transparent 65%)' }}
    />
  );
}

/**
 * Надпись MÍMISBRUNNR — в стиле знака MÍMIR: заглавные буквы Spectral
 * с широкой разрядкой, серый цвет, тонкая линия и подзаголовок разрядкой.
 */
export function Wordmark({ size = 40, subtitle = 'Code Review' }) {
  return (
    <div className="inline-flex flex-col items-stretch">
      <div
        className="font-display font-semibold text-stone leading-none"
        style={{ fontSize: size, letterSpacing: '0.14em', marginRight: '-0.14em' }}
        aria-label="Mímisbrunnr"
      >
        MÍMISBRUNNR
      </div>
      {subtitle && (
        <>
          <div className="h-px bg-mist-dim/70 mt-[0.45em]" style={{ fontSize: size }} />
          <div className="font-body font-medium text-mist uppercase text-left" style={{ fontSize: Math.max(10, size * 0.27), letterSpacing: '0.32em', marginTop: size * 0.32 }}>
            {subtitle}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Эмблема Mímisbrunnr: руна Ансуз (ᚨ — мудрость, знание) в кольце, бронзой.
 * Своя, не знак Мимира.
 */
export function Emblem({ size = 46, glow = true }) {
  return (
    <div
      className="rounded-full flex items-center justify-center bg-rail-bg flex-shrink-0"
      style={{
        width: size, height: size,
        border: '1px solid #2A332C',
        boxShadow: glow ? '0 0 0 3px #0D120F, 0 0 14px rgba(185,141,85,0.18)' : undefined,
      }}
    >
      <svg viewBox="0 0 48 48" width={size * 0.72} height={size * 0.72} fill="none" stroke="#B98D55" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="24" cy="24" r="20" strokeWidth="1.2" opacity="0.55" />
        <line x1="19" y1="11" x2="19" y2="37" strokeWidth="2.6" />
        <line x1="19" y1="13" x2="29" y2="20" strokeWidth="2.6" />
        <line x1="19" y1="21" x2="29" y2="28" strokeWidth="2.6" />
      </svg>
    </div>
  );
}
