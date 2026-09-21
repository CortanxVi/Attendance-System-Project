import { useId, useState } from 'react';
import { Camera, Focus, SlidersHorizontal } from 'lucide-react';
import type { CameraNumericCapability } from '../../hooks/useCameraQuality';

interface CameraQualityControlsProps {
  cameras: MediaDeviceInfo[];
  selectedCameraId: string;
  defaultCameraLabel: string;
  resolution: string;
  continuousFocus: boolean;
  sharpnessRange: CameraNumericCapability | null;
  sharpness: number | null;
  zoomRange: CameraNumericCapability | null;
  zoom: number | null;
  onCameraChange: (deviceId: string) => void;
  onSharpnessChange: (value: number) => void;
  onZoomChange: (value: number) => void;
  compact?: boolean;
  className?: string;
}

function cameraLabel(camera: MediaDeviceInfo, index: number): string {
  return camera.label.trim() || `เลนส์กล้อง ${index + 1}`;
}

function RangeControl({
  label,
  value,
  range,
  onChange,
}: {
  label: string;
  value: number;
  range: CameraNumericCapability;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid min-w-0 grid-cols-[4.5rem_minmax(6rem,1fr)] items-center gap-2 text-xs font-semibold text-white">
      <span>{label}</span>
      <input
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-8 w-full cursor-pointer accent-orange-500"
        aria-label={`ปรับ${label}`}
      />
    </label>
  );
}

export default function CameraQualityControls({
  cameras,
  selectedCameraId,
  defaultCameraLabel,
  resolution,
  continuousFocus,
  sharpnessRange,
  sharpness,
  zoomRange,
  zoom,
  onCameraChange,
  onSharpnessChange,
  onZoomChange,
  compact = false,
  className = '',
}: CameraQualityControlsProps) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const hasAdjustments = Boolean(sharpnessRange && sharpness !== null)
    || Boolean(zoomRange && zoom !== null);

  const controls = (
    <>
      <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-white/70">
        <span className="inline-flex items-center gap-1 font-bold text-white"><SlidersHorizontal size={13} aria-hidden="true" />ตั้งค่ากล้อง</span>
        {resolution && <span className="rounded-md bg-white/10 px-1.5 py-0.5 font-mono">{resolution}</span>}
        {continuousFocus && <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-emerald-200"><Focus size={11} aria-hidden="true" />โฟกัสอัตโนมัติ</span>}
      </div>

      {cameras.length > 1 && (
        <label className="mt-2 grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-2 text-xs font-semibold">
          <span className="inline-flex items-center gap-1"><Camera size={14} aria-hidden="true" />เลนส์</span>
          <select
            value={selectedCameraId}
            onChange={(event) => onCameraChange(event.target.value)}
            className="min-h-9 w-full cursor-pointer rounded-lg border border-white/20 bg-slate-900 px-2 text-xs text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
          >
            <option value="">{defaultCameraLabel}</option>
            {cameras.map((camera, index) => (
              <option key={camera.deviceId} value={camera.deviceId}>{cameraLabel(camera, index)}</option>
            ))}
          </select>
        </label>
      )}

      {hasAdjustments && (
        <div className="mt-2 space-y-0.5 border-t border-white/10 pt-1.5">
          {sharpnessRange && sharpness !== null && (
            <RangeControl label="ความคม" range={sharpnessRange} value={sharpness} onChange={onSharpnessChange} />
          )}
          {zoomRange && zoom !== null && (
            <RangeControl label="ซูม" range={zoomRange} value={zoom} onChange={onZoomChange} />
          )}
        </div>
      )}

      {!hasAdjustments && cameras.length <= 1 && (
        <p className="mt-1.5 text-[10px] leading-4 text-white/60">ระบบเลือกความละเอียดและโฟกัสให้อัตโนมัติ</p>
      )}
    </>
  );

  if (compact) {
    return (
      <section aria-label="ตั้งค่าคุณภาพกล้อง" className={`relative flex flex-col items-end ${className}`}>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => setExpanded((value) => !value)}
          className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border border-white/20 bg-black/55 px-3 text-xs font-bold text-white shadow-lg backdrop-blur transition-colors hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
        >
          <SlidersHorizontal size={16} aria-hidden="true" />
          <span>กล้อง</span>
          {resolution && <span className="hidden rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-[10px] font-normal text-white/75 min-[360px]:inline">{resolution}</span>}
        </button>
        {expanded && (
          <div
            id={panelId}
            className="absolute right-0 top-[calc(100%+0.5rem)] w-[min(18rem,calc(100vw-1.5rem))] rounded-xl border border-white/20 bg-slate-950/92 p-2.5 text-white shadow-2xl backdrop-blur"
          >
            {controls}
          </div>
        )}
      </section>
    );
  }

  return (
    <section
      aria-label="ตั้งค่าคุณภาพกล้อง"
      className={`rounded-2xl border border-white/20 bg-slate-950/80 p-3 text-white shadow-xl backdrop-blur ${className}`}
    >
      {controls}
    </section>
  );
}
