// Playback and step-through (spec 7B.9): play, pause, step to the previous or next event, speed, a scrubber, and a conflict replay.
import { SPEEDS, type ReplayStep, type Speed } from '../lib/playback';
import { PRESET_LABELS, type PresetName } from '../lib/viewport';

interface Props {
  playing: boolean;
  onPlay(): void;
  onPause(): void;
  onPrev(): void;
  onNext(): void;
  speed: Speed;
  onSpeed(s: Speed): void;
  windowUs: number;
  cursor: number | null;
  onScrub(t: number): void;
  onPreset(p: PresetName): void;
  onZoom(factor: number): void;
  replay: ReplayStep[] | null;
  replayStep: number | null;
  onReplay(): void;
  onReplayStep(n: number | null): void;
  canReplay: boolean;
}

export function PlaybackBar(p: Props) {
  const step = p.replay && p.replayStep ? p.replay[p.replayStep - 1] : null;
  return (
    <div className="playback" role="toolbar" aria-label="Playback and zoom" data-testid="playback-bar">
      <div className="group">
        <button type="button" onClick={p.onPrev} aria-label="Step to the previous event">⏮</button>
        {p.playing ? <button type="button" onClick={p.onPause} aria-label="Pause">⏸</button> : <button type="button" onClick={p.onPlay} aria-label="Play">▶</button>}
        <button type="button" onClick={p.onNext} aria-label="Step to the next event">⏭</button>
        <label>Speed <select value={p.speed} onChange={(e) => p.onSpeed(Number(e.target.value) as Speed)} aria-label="Playback speed">{SPEEDS.map((s) => (<option key={s} value={s}>{s}x</option>))}</select></label>
        <input type="range" min={0} max={p.windowUs} step={Math.max(1, Math.round(p.windowUs / 2000))} value={p.cursor ?? 0} onChange={(e) => p.onScrub(Number(e.target.value))} aria-label="Time scrubber" aria-valuetext={`${Math.round(p.cursor ?? 0)} microseconds`} />
      </div>
      <div className="group">
        <button type="button" onClick={() => p.onZoom(0.5)} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => p.onZoom(2)} aria-label="Zoom out">−</button>
        {(Object.keys(PRESET_LABELS) as PresetName[]).map((k) => (<button key={k} type="button" onClick={() => p.onPreset(k)}>{PRESET_LABELS[k]}</button>))}
      </div>
      <div className="group replay">
        <button type="button" onClick={p.onReplay} disabled={!p.canReplay}>Replay selected conflict</button>
        {step && (
          <div className="replay-steps" role="group" aria-label="Conflict replay steps">
            <button type="button" onClick={() => p.onReplayStep(Math.max(1, (p.replayStep ?? 1) - 1))} aria-label="Previous replay step">‹</button>
            <span data-testid="replay-caption"><strong>Step {step.n} of 4.</strong> {step.caption}</span>
            <button type="button" onClick={() => p.onReplayStep(Math.min(4, (p.replayStep ?? 1) + 1))} aria-label="Next replay step">›</button>
            <button type="button" onClick={() => p.onReplayStep(null)}>End replay</button>
          </div>
        )}
      </div>
    </div>
  );
}
