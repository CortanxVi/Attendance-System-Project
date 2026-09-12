export default function PullToRefreshIndicator({
  distance,
  refreshing,
  threshold,
}: {
  distance: number;
  refreshing: boolean;
  threshold: number;
}) {
  if (distance <= 0 && !refreshing) return null;
  const ready = distance >= threshold;
  return (
    <div role="status" aria-live="polite" className="flex shrink-0 items-end justify-center overflow-hidden bg-slate-50 text-xs font-semibold text-slate-600 transition-[height] duration-150" style={{ height: refreshing ? threshold : distance }}>
      <span className="mb-2 inline-flex items-center gap-2">
        <span className={`size-4 rounded-full border-2 border-slate-300 border-t-orange-500 ${refreshing ? 'animate-spin motion-reduce:animate-none' : ''}`} />
        {refreshing ? 'กำลังรีเฟรช…' : ready ? 'ปล่อยเพื่อรีเฟรช' : 'ดึงลงเพื่อรีเฟรช'}
      </span>
    </div>
  );
}
