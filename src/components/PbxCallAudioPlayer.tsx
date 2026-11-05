import { useEffect, useRef, useState } from 'react';

type PbxCallAudioPlayerProps = {
  src: string;
  filename: string;
  onError?: () => void;
};

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const totalSeconds = Math.floor(value);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export default function PbxCallAudioPlayer({
  src,
  filename,
  onError,
}: PbxCallAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setPlaybackRate(1);
    setVolume(1);
    setMuted(false);
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.playbackRate = 1;
      audio.volume = 1;
      audio.muted = false;
      audio.load();
    }
  }, [src]);

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        onError?.();
      }
    } else {
      audio.pause();
    }
  };

  const seekBy = (seconds: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + seconds));
  };

  const updateRate = (value: string) => {
    const nextRate = Number(value);
    if (!Number.isFinite(nextRate)) return;
    setPlaybackRate(nextRate);
    if (audioRef.current) audioRef.current.playbackRate = nextRate;
  };

  const updateVolume = (value: string) => {
    const nextVolume = Number(value);
    if (!Number.isFinite(nextVolume)) return;
    setVolume(nextVolume);
    setMuted(nextVolume === 0);
    if (audioRef.current) {
      audioRef.current.volume = nextVolume;
      audioRef.current.muted = nextVolume === 0;
    }
  };

  const toggleMute = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const nextMuted = !audio.muted;
    audio.muted = nextMuted;
    setMuted(nextMuted);
    if (!nextMuted && volume === 0) {
      audio.volume = 0.7;
      setVolume(0.7);
    }
  };

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-950/70 p-3 space-y-3">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        className="hidden"
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
        onDurationChange={(event) => setDuration(event.currentTarget.duration || 0)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime || 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => {
          setPlaying(false);
          onError?.();
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={togglePlayback}
          className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-500"
          aria-label={playing ? 'Pausar grabación' : 'Reproducir grabación'}
        >
          {playing ? 'Pausar' : 'Reproducir'}
        </button>
        <button
          type="button"
          onClick={() => seekBy(-5)}
          className="rounded-lg border border-slate-700 px-2.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800"
          aria-label="Retroceder 5 segundos"
        >
          −5 s
        </button>
        <button
          type="button"
          onClick={() => seekBy(5)}
          className="rounded-lg border border-slate-700 px-2.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800"
          aria-label="Avanzar 5 segundos"
        >
          +5 s
        </button>
        <span className="min-w-[88px] text-center font-mono text-[11px] text-slate-300" aria-live="off">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
        <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
          Velocidad
          <select
            value={playbackRate}
            onChange={(event) => updateRate(event.target.value)}
            className="rounded-md border border-slate-700 bg-slate-900 px-1.5 py-1 text-slate-100"
            aria-label="Velocidad de reproducción"
          >
            <option value={0.75}>0.75×</option>
            <option value={1}>1×</option>
            <option value={1.25}>1.25×</option>
            <option value={1.5}>1.5×</option>
            <option value={2}>2×</option>
          </select>
        </label>
        <a
          href={src}
          download={filename || 'grabacion-pbx.wav'}
          className="ml-auto rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800"
        >
          Descargar audio
        </a>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={Math.max(duration, 0)}
          step={0.25}
          value={Math.min(currentTime, duration || 0)}
          onChange={(event) => {
            const nextTime = Number(event.target.value);
            if (audioRef.current && Number.isFinite(nextTime)) {
              audioRef.current.currentTime = nextTime;
              setCurrentTime(nextTime);
            }
          }}
          className="min-w-0 flex-1 accent-blue-500"
          aria-label="Posición de la grabación"
        />
        <button
          type="button"
          onClick={toggleMute}
          className="rounded-md px-1.5 py-1 text-[11px] text-slate-300 hover:bg-slate-800"
          aria-label={muted ? 'Activar sonido' : 'Silenciar'}
        >
          {muted ? 'Silenciado' : 'Volumen'}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          onChange={(event) => updateVolume(event.target.value)}
          className="w-20 accent-blue-500"
          aria-label="Volumen"
        />
      </div>
    </div>
  );
}
