/** Open a generated image from a toast without relying on browser pop-up permission. */
export function openToastImagePreview(image: Blob, title: string): void {
  const url = URL.createObjectURL(image);
  const dialog = document.createElement('dialog');
  dialog.className = 'harness-dialog toast-image-preview';
  dialog.setAttribute('aria-label', title);
  const header = document.createElement('header');
  const heading = document.createElement('h2');
  heading.textContent = title;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'harness-secondary';
  close.textContent = 'Close';
  close.addEventListener('click', () => dialog.close());
  header.append(heading, close);
  const preview = document.createElement('img');
  preview.src = url;
  preview.alt = title;
  dialog.append(header, preview);
  dialog.addEventListener('close', () => { URL.revokeObjectURL(url); dialog.remove(); }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
}
