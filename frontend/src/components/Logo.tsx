import { useState } from 'react';

interface LogoProps {
  variant?: 'color' | 'white';
  orientation?: 'horizontal' | 'vertical';
  className?: string;
  /** classe da <img> (ex.: altura). Sobrepõe o padrão por orientação. */
  imgClassName?: string;
  showApprova?: boolean;
}

const SRC: Record<string, string> = {
  'horizontal-color': '/logo-golplus.png',
  'horizontal-white': '/logo-golplus-branco.png',
  'vertical-color': '/logo-golplus-vert.png',
  'vertical-white': '/logo-golplus-vert-branco.png',
};

/**
 * Logo oficial Gol Plus + nome do produto "APROVA".
 * Carrega o PNG oficial conforme variante (cor/branco) e orientação
 * (horizontal/vertical). Caso o arquivo falhe (onError), exibe um wordmark
 * de fallback proporcional nas cores da marca, sem quebrar a interface.
 */
export default function Logo({
  variant = 'color',
  orientation = 'horizontal',
  className = '',
  imgClassName,
  showApprova = true,
}: LogoProps) {
  const [imgError, setImgError] = useState(false);
  const isWhite = variant === 'white';
  const isVertical = orientation === 'vertical';
  const src = SRC[`${orientation}-${variant}`];
  const defaultImg = isVertical ? 'h-16 w-auto object-contain' : 'h-10 w-auto object-contain';

  if (!imgError) {
    return (
      <div
        className={`flex ${isVertical ? 'flex-col items-center gap-1.5' : 'items-center gap-3'} ${className}`}
      >
        <img src={src} alt="Gol Plus" onError={() => setImgError(true)} className={imgClassName || defaultImg} />
        {showApprova && (
          <span className={`font-bold tracking-wide text-sm ${isWhite ? 'text-white' : 'text-golplus-blue'}`}>
            APROVA
          </span>
        )}
      </div>
    );
  }

  // Fallback wordmark (provisório) — sem símbolos, nas cores da marca.
  const golColor = isWhite ? 'text-white' : 'text-golplus-blue';
  const plusColor = isWhite ? 'text-white' : 'text-golplus-orange';

  return (
    <div className={`flex ${isVertical ? 'flex-col items-center gap-1' : 'items-center gap-2'} ${className}`}>
      <div className="flex items-baseline font-extrabold text-2xl lowercase tracking-tight leading-none select-none">
        <span className={golColor}>gol</span>
        <span className={`ml-1 ${plusColor}`}>plus</span>
      </div>
      {showApprova && (
        <span className={`font-bold tracking-wide text-xs ${isWhite ? 'text-white/90' : 'text-golplus-orange'}`}>
          APROVA
        </span>
      )}
    </div>
  );
}
