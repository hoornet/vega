import { useEffect, useCallback } from "react";

interface ImageLightboxProps {
  images: string[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

export function ImageLightbox({ images, index, onClose, onNavigate }: ImageLightboxProps) {
  const hasPrev = index > 0;
  const hasNext = index < images.length - 1;

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    if (e.key === "ArrowLeft" && hasPrev) onNavigate(index - 1);
    if (e.key === "ArrowRight" && hasNext) onNavigate(index + 1);
  }, [onClose, onNavigate, index, hasPrev, hasNext]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white/70 hover:text-white text-[20px] w-8 h-8 flex items-center justify-center transition-colors z-10"
      >
        ✕
      </button>

      {/* Counter */}
      {images.length > 1 && (
        <div className="absolute top-4 left-4 text-white/50 text-[12px] z-10">
          {index + 1} / {images.length}
        </div>
      )}

      {/* Prev arrow */}
      {hasPrev && (
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate(index - 1); }}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-white/50 hover:text-white text-[28px] w-10 h-10 flex items-center justify-center transition-colors z-10"
        >
          ‹
        </button>
      )}

      {/* Image */}
      <img
        src={images[index]}
        alt=""
        className="max-w-[90vw] max-h-[90vh] object-contain select-none"
        onClick={(e) => e.stopPropagation()}
        draggable={false}
      />

      {/* Next arrow */}
      {hasNext && (
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate(index + 1); }}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-white/50 hover:text-white text-[28px] w-10 h-10 flex items-center justify-center transition-colors z-10"
        >
          ›
        </button>
      )}
    </div>
  );
}
