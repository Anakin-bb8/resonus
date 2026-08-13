/** Converts seconds to "m:ss" (or "h:mm:ss" if over an hour). */
export function formatDuration(totalSeconds: number | undefined): string {
  if (!totalSeconds || totalSeconds < 0 || !Number.isFinite(totalSeconds)) {
    return '0:00';
  }
  const s = Math.floor(totalSeconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

/**
 * Human-readable total duration for a list/album: "45 min", "1 h 30 min",
 * "2 h", "1 d 3 h 20 min". Shows hours from 60 min and days from
 * 24 h. Abbreviations (d/h/min) are conventional in both languages.
 */
export function formatTotalDuration(totalSeconds: number | undefined): string {
  const s = totalSeconds && Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} d`);
  if (hours > 0) parts.push(`${hours} h`);
  // Minutes: if present, or if nothing else (duration under 1 min).
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes} min`);
  return parts.join(' ');
}

export function formatGroupedDeviceLabel(names: string[]): string {
  const unique = Array.from(
    new Set(
      names
        .map((name) => name.trim())
        .filter((name) => !!name),
    ),
  );

  if (unique.length === 0) return '';
  if (unique.length <= 2) return unique.join(' + ');
  return `${unique.slice(0, 2).join(' + ')} + ${unique.length - 2}`;
}

export function normalizeOutputDisplayName(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}


/** Bytes in the appropriate unit ("1.2 GB", "340 MB"). */
export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${Math.round(n / 1024)} KB`;
}
