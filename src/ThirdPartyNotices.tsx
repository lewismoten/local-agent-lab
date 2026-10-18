import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Search, X } from 'lucide-react';
import './third-party-notices.css';

type Notice = { name: string; text: string; source?: string };
type PackageNotice = {
  name: string;
  version: string;
  owner: string;
  license: string;
  website: string;
  repository: string;
  documentation: string;
  notices: Notice[];
};
type NoticeIndex = { version: number; packages: PackageNotice[] };

function externalUrl(value: string): string | null {
  const normalized = value.replace(/^(?:git\+|git:)/, '').replace(/\.git$/, '');
  try {
    const url = new URL(normalized);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch { return null; }
}

function ExternalLinkCell({ href, children }: { href: string; children: string }) {
  const safe = externalUrl(href);
  return safe ? <a href={safe} target="_blank" rel="noreferrer">{children}<ExternalLink size={12} aria-hidden="true"/></a> : null;
}

export default function ThirdPartyNotices() {
  const [packages, setPackages] = useState<PackageNotice[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [active, setActive] = useState<{ packageName: string; notice: Notice } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}licenses/third-party-index.json`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`Notices could not be opened (${response.status}).`);
        const index = await response.json() as NoticeIndex;
        if (index.version !== 1 || !Array.isArray(index.packages)) throw new Error('Notices index is invalid.');
        setPackages(index.packages);
      })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => controller.abort();
  }, []);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? packages.filter(item => [item.name, item.version, item.owner, item.license].some(value => value.toLocaleLowerCase().includes(needle))) : packages;
  }, [packages, query]);
  function openNotice(item: PackageNotice, notice: Notice) {
    setActive({ packageName: `${item.name} ${item.version}`, notice });
    dialog.current?.showModal();
  }
  return <section className="harness-page harness-notices-page">
    <div className="harness-heading"><span className="harness-overline">OPEN SOURCE</span><h1>Third-party notices</h1><p>Packages included in the website build. Optional model and engine licenses travel with their downloads.</p></div>
    <div className="harness-notices-toolbar"><label><Search size={16} aria-hidden="true"/><input type="search" aria-label="Search third-party packages" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search packages, owners, licenses…"/></label><span>{error ? 'Unavailable' : `${filtered.length} of ${packages.length} packages`}</span></div>
    {error ? <div className="harness-card" role="alert">{error}</div> : <div className="harness-notices-table-wrap"><table className="harness-notices-table"><thead><tr><th scope="col">Package</th><th scope="col">Version</th><th scope="col">Owner</th><th scope="col">License & notices</th><th scope="col">Links</th></tr></thead><tbody>{filtered.map(item => <tr key={`${item.name}@${item.version}`}><th scope="row">{item.name}</th><td>{item.version}</td><td>{item.owner || '—'}</td><td><div className="harness-notices-actions">{item.notices.map((notice, index) => <button key={`${notice.name}:${index}`} type="button" onClick={() => openNotice(item, notice)} title={`Read ${notice.name} for ${item.name}`}>{item.notices.length === 1 ? item.license : notice.name}</button>)}</div></td><td><div className="harness-notices-actions">{item.website && <ExternalLinkCell href={item.website}>Website</ExternalLinkCell>}{item.repository && <ExternalLinkCell href={item.repository}>Repository</ExternalLinkCell>}{item.documentation && <ExternalLinkCell href={item.documentation}>Docs</ExternalLinkCell>}</div></td></tr>)}</tbody></table>{!packages.length && <p className="harness-muted" role="status">Loading notices…</p>}{packages.length > 0 && !filtered.length && <p className="harness-muted">No packages matched.</p>}</div>}
    <p className="harness-notices-raw">Need the complete file? <a href={`${import.meta.env.BASE_URL}licenses/third-party-notices.txt`} target="_blank" rel="noreferrer">Open raw third-party notices <ExternalLink size={13} aria-hidden="true"/></a></p>
    <dialog ref={dialog} className="harness-dialog harness-notice-dialog" onClose={() => setActive(null)}><header><div><span className="harness-overline">PACKAGE NOTICE</span><h2>{active?.packageName}</h2><p>{active?.notice.name}</p></div><button type="button" className="harness-icon" onClick={() => dialog.current?.close()} aria-label="Close notice"><X size={18}/></button></header>{active?.notice.source && <p className="harness-notice-source">Text source: {active.notice.source}</p>}<pre>{active?.notice.text}</pre></dialog>
  </section>;
}
