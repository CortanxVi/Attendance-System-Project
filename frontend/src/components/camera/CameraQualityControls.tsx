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
  className = '',
}: CameraQualityControlsProps) {
  const hasAdjustments = Boolean(sharpnessRange && sharpness !== null)
    || Boolean(zoomRange && zoom !== null);

  return (
    <section
      aria-label="ตั้งค่าคุณภาพกล้อง"
      className={`rounded-2xl border border-white/20 bg-slate-950/80 p-3 text-white shadow-xl backdrop-blur ${className}`}
    >
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/75">
        <span className="inline-flex items-center gap-1.5 font-bold text-white"><SlidersHorizontal size={14} aria-hidden="true" />ตั้งค่ากล้อง</span>
        {resolution && <span className="rounded-md bg-white/10 px-2 py-1 font-mono">{resolution}</span>}
        {continuousFocus && <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-1 text-emerald-200"><Focus size={12} aria-hidden="true" />โฟกัสต่อเนื่อง</span>}
      </div>

      {cameras.length > 1 && (
        <label className="mt-2 grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2 text-xs font-semibold">
          <span className="inline-flex items-center gap-1"><Camera size={14} aria-hidden="true" />เลนส์</span>
          <select
            value={selectedCameraId}
            onChange={(event) => onCameraChange(event.target.value)}
            className="min-h-10 w-full cursor-pointer rounded-xl border border-white/20 bg-slate-900 px-3 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
          >
            <option value="">{defaultCameraLabel}</option>
            {cameras.map((camera, index) => (
              <option key={camera.deviceId} value={camera.deviceId}>{cameraLabel(camera, index)}</option>
            ))}
          </select>
        </label>
      )}

      {hasAdjustments && (
        <div className="mt-2 space-y-1 border-t border-white/10 pt-2">
          {sharpnessRange && sharpness !== null && (
            <RangeControl label="ความคม" range={sharpnessRange} value={sharpness} onChange={onSharpnessChange} />
          )}
          {zoomRange && zoom !== null && (
            <RangeControl label="ซูม" range={zoomRange} value={zoom} onChange={onZoomChange} />
          )}
        </div>
      )}

      {!hasAdjustments && cameras.length <= 1 && (
        <p className="mt-2 text-[11px] leading-4 text-white/60">ระบบเลือกความละเอียดสูงและโฟกัสที่เหมาะสมให้อัตโนมัติ</p>
      )}
    </section>
  );
}
