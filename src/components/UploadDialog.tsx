import { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { THIN_SCROLL } from '../utils/scroll';
import { Button } from 'primereact/button';
import { Dialog } from 'primereact/dialog';
import { Dropdown } from 'primereact/dropdown';
import { ProgressBar } from 'primereact/progressbar';
import { Toast } from 'primereact/toast';
import { tokenStore } from '../api/client';
import { useLibraries } from '../hooks/useApi';
import { SUPPORTED_UPLOAD_EXTENSIONS, extractBookInfo } from '../utils/extract';
import { formatFileSize } from '../utils/format';

type UploadStatus = 'queued' | 'extracting' | 'uploading' | 'done' | 'error';

interface UploadItem {
  id: number;
  file: File;
  status: UploadStatus;
  progress: number;
  message?: string;
}

// Directory pickers exist on desktop browsers; most mobile browsers lack them.
const FOLDER_PICKER_SUPPORTED =
  typeof document !== 'undefined' && 'webkitdirectory' in document.createElement('input');
const FOLDER_INPUT_PROPS = { webkitdirectory: '', directory: '' } as Record<string, string>;

/** Path shown for a file: its folder path when it came from a folder pick. */
const displayName = (file: File) => file.webkitRelativePath || file.name;

const extOf = (name: string) => (name.split('.').pop() ?? '').toLowerCase();

function uploadWithProgress(form: FormData, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/v1/files/upload');
    const token = tokenStore.access;
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        let message = `Upload failed (${xhr.status})`;
        try {
          const body = JSON.parse(xhr.responseText) as { message?: string };
          if (body.message) message = body.message;
        } catch {
          // keep default
        }
        reject(new Error(message));
      }
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(form);
  });
}

export default function UploadDialog({ visible, onHide }: { visible: boolean; onHide: () => void }) {
  const queryClient = useQueryClient();
  const toast = useRef<Toast>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const { data: libraries } = useLibraries();

  const [items, setItems] = useState<UploadItem[]>([]);
  const [libraryId, setLibraryId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);

  const selectedLibrary = libraryId ?? libraries?.[0]?.id ?? null;

  const libraryOptions = useMemo(
    () => (libraries ?? []).map(library => ({ label: library.name, value: library.id })),
    [libraries]
  );

  const updateItem = (id: number, patch: Partial<UploadItem>) =>
    setItems(current => current.map(item => (item.id === id ? { ...item, ...patch } : item)));

  const pickFiles = (fileList: FileList | null, fromFolder = false) => {
    if (!fileList) return;
    const accepted: UploadItem[] = [];
    const rejected: string[] = [];
    let nextId = Date.now();
    // Keep folder contents in path order so a series uploads in reading order.
    const files = Array.from(fileList);
    if (fromFolder) files.sort((a, b) => displayName(a).localeCompare(displayName(b), undefined, { numeric: true }));
    for (const file of files) {
      if (SUPPORTED_UPLOAD_EXTENSIONS.includes(extOf(file.name))) {
        accepted.push({ id: nextId++, file, status: 'queued', progress: 0 });
      } else {
        rejected.push(file.name);
      }
    }
    if (rejected.length > 0) {
      toast.current?.show({
        severity: 'warn',
        summary: fromFolder
          ? `${rejected.length} unsupported file${rejected.length === 1 ? '' : 's'} in the folder skipped`
          : 'Unsupported files skipped',
        detail: fromFolder ? undefined : rejected.join(', '),
        life: 4000
      });
    }
    if (fromFolder && accepted.length === 0 && rejected.length > 0) {
      toast.current?.show({
        severity: 'info',
        summary: 'No supported books in that folder',
        detail: `Supported: ${SUPPORTED_UPLOAD_EXTENSIONS.join(', ')}`,
        life: 4000
      });
    }
    setItems(current => [...current, ...accepted]);
  };

  const runUploads = async () => {
    if (!selectedLibrary) return;
    setUploading(true);
    let successCount = 0;
    let failureCount = 0;

    for (const item of items.filter(i => i.status === 'queued' || i.status === 'error')) {
      updateItem(item.id, { status: 'extracting', progress: 0, message: undefined });
      const { metadata, cover } = await extractBookInfo(item.file);

      const form = new FormData();
      form.set('file', item.file, item.file.name);
      form.set('libraryId', String(selectedLibrary));
      form.set('metadata', JSON.stringify(metadata));
      if (cover) form.set('cover', cover, 'cover.jpg');

      try {
        updateItem(item.id, { status: 'uploading' });
        await uploadWithProgress(form, percent => updateItem(item.id, { progress: percent }));
        updateItem(item.id, { status: 'done', progress: 100 });
        successCount++;
      } catch (error) {
        updateItem(item.id, {
          status: 'error',
          message: error instanceof Error ? error.message : 'Upload failed'
        });
        failureCount++;
      }
    }

    setUploading(false);
    // Await the refetches so book counts (libraries, shelves) are already
    // refreshed when the dialog closes and its success toast appears.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['books'] }),
      queryClient.invalidateQueries({ queryKey: ['libraries'] }),
      queryClient.invalidateQueries({ queryKey: ['shelves'] })
    ]);
    toast.current?.show({
      severity: failureCount === 0 ? 'success' : 'warn',
      summary: 'Upload finished',
      detail: `${successCount} uploaded${failureCount ? `, ${failureCount} failed` : ''}`,
      life: 3000
    });
  };

  const close = () => {
    if (uploading) return;
    setItems([]);
    onHide();
  };

  const statusIcon = (status: UploadStatus) => {
    switch (status) {
      case 'done':
        return <i className="pi pi-check-circle text-green-500 text-xl" />;
      case 'error':
        return <i className="pi pi-times-circle text-red-500 text-xl" />;
      case 'uploading':
      case 'extracting':
        return <i className="pi pi-spin pi-spinner text-primary text-xl" />;
      default:
        return <i className="pi pi-circle text-color-secondary text-xl" />;
    }
  };

  const footer =
    items.length > 0 ? (
      <div className="flex justify-content-end gap-2">
        <Button label="Close" text severity="secondary" onClick={close} disabled={uploading} />
        <Button
          label="Upload"
          icon="pi pi-upload"
          onClick={() => void runUploads()}
          loading={uploading}
          disabled={!selectedLibrary || items.every(i => i.status === 'done')}
        />
      </div>
    ) : undefined;

  return (
    <Dialog
      visible={visible}
      onHide={close}
      header="Upload Books"
      footer={footer}
      maximizable
      style={{ width: '34rem' }}
      breakpoints={{ '640px': '95vw' }}
    >
      <Toast ref={toast} />
      <div className="flex flex-wrap gap-2 mb-3">
        <Dropdown
          value={selectedLibrary}
          options={libraryOptions}
          onChange={event => setLibraryId(event.value as number)}
          placeholder="Select a library"
          className="flex-1 min-w-0"
        />
        <Button
          icon="pi pi-plus"
          label="Add Files"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        />
        {FOLDER_PICKER_SUPPORTED && (
          <Button
            icon="pi pi-folder-open"
            label="Add Folder"
            outlined
            onClick={() => folderInputRef.current?.click()}
            disabled={uploading}
          />
        )}
        <input
          ref={folderInputRef}
          type="file"
          multiple
          hidden
          {...FOLDER_INPUT_PROPS}
          onChange={event => {
            pickFiles(event.target.files, true);
            event.target.value = '';
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.epub,.cbz,.cbr,.zip,.fb2,.mobi,.azw3"
          hidden
          onChange={event => {
            pickFiles(event.target.files);
            event.target.value = '';
          }}
        />
      </div>

      {items.length === 0 ? (
        <div className="flex flex-column align-items-center gap-2 py-5 text-color-secondary border-1 border-dashed surface-border border-round">
          <i className="pi pi-cloud-upload text-4xl" />
          <span>Choose a library, then add books or a whole folder.</span>
        </div>
      ) : (
        <div className="flex flex-column overflow-y-auto" style={{ maxHeight: '20rem', ...THIN_SCROLL }}>
          {items.map(item => (
            <div key={item.id} className="flex align-items-center gap-3 py-2 border-bottom-1 surface-border">
              {statusIcon(item.status)}
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm white-space-nowrap overflow-hidden text-overflow-ellipsis">
                  {displayName(item.file)}
                </div>
                <div className="text-color-secondary text-xs">
                  {formatFileSize(Math.max(1, Math.round(item.file.size / 1024)))}
                  {item.status === 'extracting' && ' · reading metadata…'}
                  {item.message && <span className="text-red-500"> · {item.message}</span>}
                </div>
                {(item.status === 'uploading' || item.status === 'extracting') && (
                  <ProgressBar
                    value={item.status === 'extracting' ? 5 : item.progress}
                    showValue={false}
                    className="mt-2"
                    style={{ height: '0.4rem' }}
                  />
                )}
              </div>
              {!uploading && (item.status === 'queued' || item.status === 'error' || item.status === 'done') && (
                <Button
                  icon="pi pi-times"
                  text
                  severity="secondary"
                  aria-label={`Remove ${item.file.name}`}
                  onClick={() => setItems(current => current.filter(i => i.id !== item.id))}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}
