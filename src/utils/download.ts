/** Save a Blob (or text) to the user's device with the given file name. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a tick to start the download before releasing the URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const saveText = (text: string, fileName: string, type = 'text/plain;charset=utf-8') =>
  saveBlob(new Blob([text], { type }), fileName);
