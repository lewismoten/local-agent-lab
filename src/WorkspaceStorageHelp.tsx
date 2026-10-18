import { useRef } from 'react';
import { Info } from 'lucide-react';
import './workspaceStorageHelp.css';

export default function WorkspaceStorageHelp({ portable }: { portable: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return <>
    <button className="harness-storage-info" type="button" title="Where workspace files are stored" aria-label="Where workspace files are stored" onClick={() => dialog.current?.showModal()}><Info size={14}/></button>
    <dialog ref={dialog} className="harness-dialog harness-storage-dialog" aria-label="Workspace storage">
      <h2>Workspace storage</h2>
      <p>{portable ? 'This workspace is in the folder you connected. Keep the folder together when moving it to another computer.' : 'This workspace is saved in this browser profile. It will not travel with a USB drive.'}</p>
      <ul>
        <li>A USB folder travels with the drive. Another computer must reconnect it and grant access.</li>
        <li>Browser storage stays on this computer and can be removed by browser cleanup or clearing site data.</li>
        <li>The offline website cache is separate from workspace files and models.</li>
      </ul>
      <form method="dialog"><button className="harness-primary" type="submit">Close</button></form>
    </dialog>
  </>;
}
