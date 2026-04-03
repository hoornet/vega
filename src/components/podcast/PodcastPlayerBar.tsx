import { useRef, useEffect, useCallback, useState } from "react";
import type { PodcastEpisode } from "../../types/podcast";
import { usePodcastStore } from "../../stores/podcast";
import { publishNote } from "../../lib/nostr";
import { V4VIndicator } from "./V4VIndicator";

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function ShareButton({ episode }: { episode: PodcastEpisode | null }) {
  const [state, setState] = useState<"idle" | "confirm" | "shared">("idle");

  const handleClick = useCallback(() => {
    if (!episode) return;
    if (state === "idle") {
      setState("confirm");
    } else if (state === "confirm") {
      const text = `Listening to ${episode.title} from ${episode.showTitle}\n\n${episode.enclosureUrl}`;
      publishNote(text).then(() => {
        setState("shared");
        setTimeout(() => setState("idle"), 3000);
      }).catch(() => setState("idle"));
    }
  }, [episode, state]);

  const handleCancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setState("idle");
  }, []);

  return (
    <span className="shrink-0 flex items-center gap-1">
      <button
        onClick={handleClick}
        className={`text-[11px] transition-colors ${
          state === "shared" ? "text-success"
            : state === "confirm" ? "text-accent"
            : "text-text-dim hover:text-text"
        }`}
        title="Share what you're listening to"
      >
        {state === "shared" ? "shared" : state === "confirm" ? "publish?" : "share"}
      </button>
      {state === "confirm" && (
        <button onClick={handleCancel} className="text-[10px] text-text-dim hover:text-text">x</button>
      )}
    </span>
  );
}

const RATES = [1, 1.5, 2];

export function PodcastPlayerBar() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const saveTimerRef = useRef<number | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);

  const episode = usePodcastStore((s) => s.currentEpisode);
  const playbackState = usePodcastStore((s) => s.playbackState);
  const currentTime = usePodcastStore((s) => s.currentTime);
  const duration = usePodcastStore((s) => s.duration);
  const playbackRate = usePodcastStore((s) => s.playbackRate);
  const volume = usePodcastStore((s) => s.volume);
  const playCounter = usePodcastStore((s) => s.playCounter);

  const {
    pause, resume, seek, setRate, setVolume,
    setPlaybackState, setCurrentTime, setDuration,
    saveProgress, stop,
  } = usePodcastStore.getState();

  // Drive audio element when episode changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !episode) return;

    setAudioError(null);
    setPlaybackState("loading");

    // Reset and set source — explicit load() is needed to clear error state
    // from a previous failed episode, otherwise WebView won't attempt the new URL
    audio.src = episode.enclosureUrl;
    audio.load();
    audio.playbackRate = playbackRate;
    audio.volume = volume;

    let loaded = false;

    // Wait for the audio to be ready, then seek + play
    const onCanPlay = () => {
      loaded = true;
      audio.removeEventListener("canplaythrough", onCanPlay);
      const savedPosition = usePodcastStore.getState().loadProgress(episode.guid);
      if (savedPosition > 0) {
        try { audio.currentTime = savedPosition; } catch { /* ignore */ }
      }
      audio.play().catch(() => setPlaybackState("paused"));
    };
    audio.addEventListener("canplaythrough", onCanPlay);

    // Timeout: if audio doesn't load within 15s, show helpful error
    const timeout = setTimeout(() => {
      if (!loaded) {
        audio.removeEventListener("canplaythrough", onCanPlay);
        setAudioError("Audio file not available — the podcast host may be down or the episode URL is broken.");
        setPlaybackState("paused");
      }
    }, 15000);

    return () => {
      clearTimeout(timeout);
      audio.removeEventListener("canplaythrough", onCanPlay);
    };
  }, [episode, playCounter]);

  // Sync playback rate
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  // Sync volume
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  // Handle play/pause state changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !episode) return;

    if (playbackState === "playing" && audio.paused) {
      audio.play().catch(() => {});
    } else if (playbackState === "paused" && !audio.paused) {
      audio.pause();
    }
  }, [playbackState]);

  // Auto-save progress every 15s
  useEffect(() => {
    if (!episode) return;
    saveTimerRef.current = window.setInterval(() => {
      saveProgress();
    }, 15000);
    return () => {
      if (saveTimerRef.current) clearInterval(saveTimerRef.current);
    };
  }, [episode, playCounter]);

  // Space key to toggle play/pause — use audio element state, not store state
  useEffect(() => {
    if (!episode) return;
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable) return;
      if (e.code === "Space") {
        e.preventDefault();
        const audio = audioRef.current;
        if (!audio) return;
        if (audio.paused) {
          audio.play().catch(() => {});
        } else {
          audio.pause();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [episode]);

  const handleTimeUpdate = useCallback(() => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  }, []);

  const saveAndStop = useCallback(() => {
    // Sync current time from audio element before saving (store value may be stale)
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
    }
    saveProgress();
    stop();
  }, []);

  const handleEnded = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.removeAttribute("src");
    }
    stop();
  }, []);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const t = parseFloat(e.target.value);
    seek(t);
    if (audioRef.current) {
      audioRef.current.currentTime = t;
      // Always resume after seeking — clicking the slider can trigger a pause event
      // before onChange fires, so checking state here is unreliable
      setPlaybackState("loading");
      audioRef.current.play().catch(() => {});
    }
  }, []);

  const cycleRate = useCallback(() => {
    const idx = RATES.indexOf(playbackRate);
    setRate(RATES[(idx + 1) % RATES.length]);
  }, [playbackRate]);

  const artwork = episode?.artworkUrl || episode?.showArtworkUrl;
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <>
      <audio
        ref={audioRef}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        onPlay={() => setPlaybackState("playing")}
        onPlaying={() => setPlaybackState("playing")}
        onPause={() => {
          const s = usePodcastStore.getState().playbackState;
          // Only mark paused if we were actually playing — ignore pause events from src changes
          if (s === "playing") setPlaybackState("paused");
        }}
        onWaiting={() => {
          const s = usePodcastStore.getState().playbackState;
          if (s === "playing") setPlaybackState("loading");
        }}
        onError={() => {
          const code = audioRef.current?.error?.code;
          const msg = audioRef.current?.error?.message;
          setAudioError(`Audio error ${code}: ${msg || "failed to load"}`);
          setPlaybackState("paused");
        }}
      />
      {!episode ? null : (
      <div className="shrink-0 h-14 border-t border-border bg-bg flex items-center gap-3 px-3">
        {/* Artwork */}
        {artwork && (
          <img
            src={artwork}
            alt="Now playing artwork"
            className="w-10 h-10 rounded-sm object-cover shrink-0 bg-bg-raised"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        )}

        {/* Title + show */}
        <div className="min-w-0 w-40 shrink-0">
          {audioError && <div className="text-[10px] text-danger truncate">{audioError}</div>}
          <div className="text-[12px] text-text truncate">{episode.title}</div>
          <div className="text-[10px] text-text-dim truncate">{episode.showTitle}</div>
        </div>

        {/* Play/Pause */}
        <button
          onClick={() => playbackState === "playing" ? pause() : resume()}
          className="w-8 h-8 rounded-full border border-border flex items-center justify-center hover:bg-bg-hover transition-colors shrink-0"
          title={playbackState === "playing" ? "Pause" : "Play"}
        >
          {playbackState === "playing" ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="text-text">
              <rect x="2" y="1" width="3" height="10" rx="0.5" />
              <rect x="7" y="1" width="3" height="10" rx="0.5" />
            </svg>
          ) : playbackState === "loading" ? (
            <span className="text-[10px] text-text-dim animate-pulse">...</span>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="text-text ml-0.5">
              <polygon points="2,1 11,6 2,11" />
            </svg>
          )}
        </button>

        {/* Seek bar */}
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <span className="text-[10px] text-text-dim w-12 text-right shrink-0">{formatTime(currentTime)}</span>
          <div className="flex-1 relative h-4 flex items-center">
            <div className="absolute inset-x-0 h-1 bg-border rounded-full">
              <div
                className="h-full bg-accent rounded-full transition-[width] duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={1}
              value={currentTime}
              onChange={handleSeek}
              className="absolute inset-0 w-full opacity-0 cursor-pointer"
            />
          </div>
          <span className="text-[10px] text-text-dim w-12 shrink-0">{formatTime(duration)}</span>
        </div>

        {/* Speed */}
        <button
          onClick={cycleRate}
          className="text-[11px] text-text-muted hover:text-accent transition-colors px-1 shrink-0"
          title="Playback speed"
        >
          {playbackRate}x
        </button>

        {/* Volume */}
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[11px] text-text-dim">vol</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            className="w-16 accent-accent h-1 cursor-pointer"
          />
        </div>

        {/* V4V */}
        <V4VIndicator />

        {/* Share */}
        <ShareButton episode={episode} />

        {/* Close */}
        <button
          onClick={saveAndStop}
          className="text-text-dim hover:text-text transition-colors shrink-0 text-[14px]"
          title="Stop"
        >
          x
        </button>
      </div>
      )}
    </>
  );
}
