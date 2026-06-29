import { useState } from 'react';

interface LogoProps {
  variant?: 'color' | 'white';
  className?: string;
  showApprova?: boolean;
}

/**
 * Logo Gol Plus + wordmark APROVA.
 * Tenta carregar o PNG oficial em /logo-golplus.png (ou branco). Caso o arquivo
 * ainda não exista (onError), exibe um wordmark de fallback com as cores da marca:
 * "gol" + pin-com-"+" + "plus", e abaixo o nome do produto "APROVA".
 */
export default function Logo({ variant = 'color', className = '', showApprova = true }: LogoProps) {
  const [imgError, setImgError] = useState(false);
  const src = variant === 'white' ? '/logo-golplus-branco.png' : '/logo-golplus.png';
  const isWhite = variant === 'white';

  if (!imgError) {
    return (
      <div className={`flex items-center gap-3 ${className}`}>
        <img
          src={src}
          alt="Gol Plus"
          onError={() => setImgError(true)}
          className="h-10 w-auto object-contain"
        />
        {showApprova && (
          <span className={`font-bold tracking-wide text-sm ${isWhite ? 'text-white' : 'text-golplus-blue'}`}>
            APROVA
          </span>
        )}
      </div>
    );
  }

  // Fallback wordmark (provisório, até o PNG oficial estar em /public).
  // Sem símbolos: apenas o wordmark proporcional nas cores da marca.
  const golColor = isWhite ? 'text-white' : 'text-golplus-blue';
  const plusColor = isWhite ? 'text-white' : 'text-golplus-orange';

  return (
    <div className={`flex items-center gap-2 ${className}`}>
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
