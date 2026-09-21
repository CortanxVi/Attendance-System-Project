import { useCallback, useRef, useState } from 'react';

export interface CameraNumericCapability {
  min: number;
  max: number;
  step: number;
}

interface ExtendedTrackCapabilities extends MediaTrackCapabilities {
  focusMode?: string[];
  sharpness?: CameraNumericCapability;
  zoom?: CameraNumericCapability;
}

interface ExtendedTrackSettings extends MediaTrackSettings {
  focusMode?: string;
  sharpness?: number;
  zoom?: number;
}

type CameraNumericConstraint = 'sharpness' | 'zoom';

function readCapabilities(track: MediaStreamTrack): ExtendedTrackCapabilities {
  try {
    return typeof track.getCapabilities === 'function'
      ? track.getCapabilities() as ExtendedTrackCapabilities
      : {} as ExtendedTrackCapabilities;
  } catch {
    return {} as ExtendedTrackCapabilities;
  }
}

function validRange(value: unknown): CameraNumericCapability | null {
  if (!value || typeof value !== 'object') return null;
  const range = value as Partial<CameraNumericCapability>;
  if (
    typeof range.min !== 'number'
    || typeof range.max !== 'number'
    || !Number.isFinite(range.min)
    || !Number.isFinite(range.max)
    || range.max <= range.min
  ) return null;
  return {
    min: range.min,
    max: range.max,
    step: typeof range.step === 'number' && range.step > 0 ? range.step : 0.1,
  };
}

function clampToRange(value: number, range: CameraNumericCapability): number {
  return Math.min(range.max, Math.max(range.min, value));
}

export function useCameraQuality() {
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const [resolution, setResolution] = useState('');
  const [continuousFocus, setContinuousFocus] = useState(false);
  const [sharpnessRange, setSharpnessRange] = useState<CameraNumericCapability | null>(null);
  const [sharpness, setSharpness] = useState<number | null>(null);
  const [zoomRange, setZoomRange] = useState<CameraNumericCapability | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);

  const clear = useCallback(() => {
    trackRef.current = null;
    setResolution('');
    setContinuousFocus(false);
    setSharpnessRange(null);
    setSharpness(null);
    setZoomRange(null);
    setZoom(null);
  }, []);

  const readTrackState = useCallback((track: MediaStreamTrack) => {
    const settings = track.getSettings() as ExtendedTrackSettings;
    const capabilities = readCapabilities(track);
    const nextSharpnessRange = validRange(capabilities.sharpness);
    const nextZoomRange = validRange(capabilities.zoom);

    setResolution(settings.width && settings.height ? `${settings.width}×${settings.height}` : '');
    setContinuousFocus(settings.focusMode === 'continuous');
    setSharpnessRange(nextSharpnessRange);
    setSharpness(nextSharpnessRange
      ? clampToRange(
        typeof settings.sharpness === 'number'
          ? settings.sharpness
          : (nextSharpnessRange.min + nextSharpnessRange.max) / 2,
        nextSharpnessRange,
      )
      : null);
    setZoomRange(nextZoomRange);
    setZoom(nextZoomRange
      ? clampToRange(
        typeof settings.zoom === 'number' ? settings.zoom : nextZoomRange.min,
        nextZoomRange,
      )
      : null);
  }, []);

  const inspectStream = useCallback(async (stream: MediaStream | null) => {
    const track = stream?.getVideoTracks()[0] ?? null;
    if (!track || track.readyState !== 'live') {
      clear();
      return;
    }
    trackRef.current = track;

    try {
      const capabilities = readCapabilities(track);
      if (capabilities.focusMode?.includes('continuous')) {
        await track.applyConstraints({
          advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
        });
      }
    } catch {
      // Browsers may advertise a constraint but reject it for a specific lens.
      // The stream remains usable with its native automatic focus behavior.
    }
    readTrackState(track);
  }, [clear, readTrackState]);

  const applyNumericConstraint = useCallback(async (
    name: CameraNumericConstraint,
    requestedValue: number,
  ) => {
    const track = trackRef.current;
    const range = name === 'sharpness' ? sharpnessRange : zoomRange;
    if (!track || track.readyState !== 'live' || !range) return false;
    const value = clampToRange(requestedValue, range);
    try {
      await track.applyConstraints({
        advanced: [{ [name]: value } as MediaTrackConstraintSet],
      });
      if (name === 'sharpness') setSharpness(value);
      else setZoom(value);
      readTrackState(track);
      return true;
    } catch {
      return false;
    }
  }, [readTrackState, sharpnessRange, zoomRange]);

  const applySharpness = useCallback(
    (value: number) => applyNumericConstraint('sharpness', value),
    [applyNumericConstraint],
  );
  const applyZoom = useCallback(
    (value: number) => applyNumericConstraint('zoom', value),
    [applyNumericConstraint],
  );

  return {
    resolution,
    continuousFocus,
    sharpnessRange,
    sharpness,
    zoomRange,
    zoom,
    inspectStream,
    applySharpness,
    applyZoom,
    clear,
  };
}
