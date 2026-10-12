import { useEffect, useCallback } from "react";
import { BodyPortal } from "./BodyPortal";
import { useModal } from "../../hooks/useModal";

interface ImageLightboxProps {
  images: string[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

export function ImageLightbox({ images, index, onClose, onNavigate }: ImageLightboxProps) {
  const hasPrev = index > 0;
  const hasNext = index < images.length - 1;

  // Escape, and focus in, kept in and returned, are the same as for a dialog.
  const { container } = useModal(onClose);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "ArrowLeft" && hasPrev) onNavigate(index - 1);
    if (e.key === "ArrowRight" && hasNext) onNavigate(index + 1);
  }, [onNavigate, index, hasPrev, hasNext]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <BodyPortal>
    <div
      ref={container}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm focus:outline-none"
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      onClick={onClose}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        aria-label="Close image viewer"
        className="absolute top-4 right-4 text-white/70 hover:text-white text-[20px] w-8 h-8 flex items-center justify-center transition-colors z-10"
      >
        ✕
      </button>

      {/* Counter */}
      {images.length > 1 && (
        <div className="absolute top-4 left-4 text-white/50 text-body z-10">
          {index + 1} / {images.length}
        </div>
      )}

      {/* Prev arrow */}
      {hasPrev && (
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate(index - 1); }}
          aria-label="Previous image"
          className="absolute left-4 top-1/2 -translate-y-1/2 text-white/50 hover:text-white text-[28px] w-10 h-10 flex items-center justify-center transition-colors z-10"
        >
          ‹
        </button>
      )}

      {/* A click on the picture closes too: it reaches the handler on the viewer itself. */}
      <img
        src={images[index]}
        alt={`Image ${index + 1} of ${images.length}`}
        // A share of the viewer, not of the viewport: inside the text-size zoom, 90vw was wider than the window.
        className="max-w-[90%] max-h-[90%] object-contain select-none cursor-zoom-out"
        draggable={false}
      />

      {/* Next arrow */}
      {hasNext && (
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate(index + 1); }}
          aria-label="Next image"
          className="absolute right-4 top-1/2 -translate-y-1/2 text-white/50 hover:text-white text-[28px] w-10 h-10 flex items-center justify-center transition-colors z-10"
        >
          ›
        </button>
      )}
    </div>
    </BodyPortal>
  );
}
