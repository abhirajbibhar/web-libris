import type { ReadStatus } from '../api/types';

export function formatFileSize(sizeKb?: number): string {
  if (!sizeKb || sizeKb <= 0) return '';
  if (sizeKb < 1024) return `${sizeKb} KB`;
  const mb = sizeKb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export function formatDate(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export const READ_STATUS_LABELS: Record<ReadStatus, string> = {
  UNSET: 'Unset',
  UNREAD: 'Unread',
  READING: 'Reading',
  RE_READING: 'Re-reading',
  READ: 'Read',
  PARTIALLY_READ: 'Partially Read',
  PAUSED: 'Paused',
  WONT_READ: "Won't Read",
  ABANDONED: 'Abandoned'
};

export const READ_STATUS_ICONS: Record<ReadStatus, string> = {
  UNSET: 'pi pi-circle',
  UNREAD: 'pi pi-circle',
  READING: 'pi pi-book',
  RE_READING: 'pi pi-refresh',
  READ: 'pi pi-check-circle',
  PARTIALLY_READ: 'pi pi-receipt',
  PAUSED: 'pi pi-pause-circle',
  WONT_READ: 'pi pi-times-circle',
  ABANDONED: 'pi pi-step-backward'
};

export const READ_STATUS_OPTIONS = Object.entries(READ_STATUS_LABELS).map(([value, label]) => ({ value, label }));
