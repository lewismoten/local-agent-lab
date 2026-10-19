import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Search, X } from 'lucide-react';
import type { OptionalNotice } from './optionalNotices.ts';
import { CODE_ASSISTANCE } from './codeAssistance.ts';
import './third-party-notices.css';

type Notice = { name: string; text: string; source?: string };
type PackageNotice = {
  name: string;
  purpose: string;
  version: string;
  author: string;
  authorWebsite: string;
  relationship: 'direct' | 'transitive';
  requiredBy: string[];
  license: string;
  website: string;
  repository: string;
  documentation: string;
  notices: Notice[];
};
type NoticeIndex = { version: number; packages: PackageNotice[]; development: { name: string; range: string; purpose: string }[] };
type Section = 'included' | 'optional' | 'build' | 'assistance';

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

function OptionalTable({ items, loading }: { items: OptionalNotice[]; loading: boolean }) {
  return <div className="harness-notices-table-wrap"><table className="harness-notices-table"><thead><tr><th scope="col">Download</th><th scope="col">Kind</th><th scope="col">Type</th><th scope="col">Developer</th><th scope="col">Source & license</th></tr></thead><tbody>{items.map(item => <tr key={item.id}><th scope="row">{item.name}</th><td>{item.kind}</td><td>{item.type}</td><td>{item.developer}</td><td><div className="harness-notices-actions"><ExternalLinkCell href={item.source}>Source</ExternalLinkCell>{item.licenses.map((license, index) => <ExternalLinkCell key={`${license.label}:${index}`} href={license.url}>{license.label}</ExternalLinkCell>)}</div></td></tr>)}</tbody></table>{loading && <p className="harness-muted" role="status">Loading optional downloads…</p>}{!loading && !items.length && <p className="harness-muted">No downloads matched.</p>}</div>;
}

function BuildTable({ items, loading }: { items: NoticeIndex['development']; loading: boolean }) {
  return <div className="harness-notices-table-wrap"><table className="harness-notices-table"><thead><tr><th scope="col">Build tool</th><th scope="col">Version range</th></tr></thead><tbody>{items.map(item => <tr key={item.name}><th scope="row">{item.name}<small className="harness-notices-purpose">{item.purpose}</small></th><td>{item.range}</td></tr>)}</tbody></table>{loading && <p className="harness-muted" role="status">Loading build tools…</p>}{!loading && !items.length && <p className="harness-muted">No build tools matched.</p>}</div>;
}

function CodeAssistanceTable({ items }: { items: typeof CODE_ASSISTANCE[number][] }) {
  return <div className="harness-notices-table-wrap"><table className="harness-notices-table"><thead><tr><th scope="col">Model</th><th scope="col">Tool</th><th scope="col">Use</th></tr></thead><tbody>{items.map(item => <tr key={`${item.model}:${item.tool}`}><th scope="row">{item.model}</th><td>{item.tool}</td><td>{item.purpose}</td></tr>)}</tbody></table>{!items.length && <p className="harness-muted">No models matched.</p>}</div>;
}

export default function ThirdPartyNotices() {
  const [packages, setPackages] = useState<PackageNotice[]>([]);
  const [development, setDevelopment] = useState<NoticeIndex['development']>([]);
  const [optional, setOptional] = useState<OptionalNotice[] | null>(null);
  const [section, setSection] = useState<Section>('included');
  const [relationship, setRelationship] = useState<'all' | 'direct' | 'transitive'>('all');
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
        if (index.version !== 3 || !Array.isArray(index.packages) || !Array.isArray(index.development) || index.packages.some(item => !item.purpose) || index.development.some(item => !item.purpose)) throw new Error('Notices index is invalid.');
        setPackages(index.packages);
        setDevelopment(index.development);
      })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (section !== 'optional' || optional) return;
    let active = true;
    import('./optionalNotices.ts').then(module => { if (active) setOptional(module.OPTIONAL_NOTICES); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [section, optional]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return packages.filter(item => (relationship === 'all' || item.relationship === relationship) &&
      (!needle || [item.name, item.purpose, item.version, item.author, item.license, ...item.requiredBy].some(value => value.toLocaleLowerCase().includes(needle))));
  }, [packages, query, relationship]);
  const optionalFiltered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (optional || []).filter(item => !needle || [item.name, item.kind, item.type, item.developer, ...item.licenses.map(license => license.label)].some(value => value.toLocaleLowerCase().includes(needle)));
  }, [optional, query]);
  const developmentFiltered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return development.filter(item => !needle || [item.name, item.range, item.purpose].some(value => value.toLocaleLowerCase().includes(needle)));
  }, [development, query]);
  const assistanceFiltered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return CODE_ASSISTANCE.filter(item => !needle || [item.model, item.tool, item.purpose].some(value => value.toLocaleLowerCase().includes(needle)));
  }, [query]);
  function openNotice(item: PackageNotice, notice: Notice) {
    setActive({ packageName: `${item.name} ${item.version}`, notice });
    dialog.current?.showModal();
  }
  return <section className="harness-page harness-notices-page">
    <div className="harness-heading"><span className="harness-overline">OPEN SOURCE</span><h1>Third-party notices</h1><p>Website dependencies, optional downloads, build tools, and code assistance.</p></div>
    <div className="harness-notices-sections" aria-label="Notice categories">{([['included', 'Website dependencies'], ['optional', 'Optional downloads'], ['build', 'Build tools'], ['assistance', 'Code assistance']] as const).map(([id, label]) => <button type="button" key={id} aria-pressed={section === id} onClick={() => { setSection(id); setQuery(''); }}>{label}</button>)}</div>
    <div className="harness-notices-toolbar"><label><Search size={16} aria-hidden="true"/><input type="search" aria-label="Search notices" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search notices…"/></label>{section === 'included' && <select aria-label="Dependency type" value={relationship} onChange={event => setRelationship(event.target.value as typeof relationship)}><option value="all">All dependencies</option><option value="direct">Direct</option><option value="transitive">Transitive</option></select>}<span>{error && section !== 'assistance' ? 'Unavailable' : section === 'included' ? `${filtered.length} packages` : section === 'optional' ? `${optionalFiltered.length} downloads` : section === 'build' ? `${developmentFiltered.length} build tools` : `${assistanceFiltered.length} models`}</span></div>
    {section === 'assistance' ? <CodeAssistanceTable items={assistanceFiltered}/> : error ? <div className="harness-card" role="alert">{error}</div> : section === 'optional' ? <OptionalTable items={optionalFiltered} loading={!optional}/> : section === 'build' ? <BuildTable items={developmentFiltered} loading={!packages.length}/> : <div className="harness-notices-table-wrap"><table className="harness-notices-table"><thead><tr><th scope="col">Package</th><th scope="col">Version</th><th scope="col">Author</th><th scope="col">License & notices</th><th scope="col">Included through</th><th scope="col">Links</th></tr></thead><tbody>{filtered.map(item => <tr key={`${item.name}@${item.version}`}><th scope="row">{item.name}<small className="harness-notices-purpose">{item.purpose}</small></th><td>{item.version}</td><td>{item.authorWebsite ? <ExternalLinkCell href={item.authorWebsite}>{item.author || 'Author'}</ExternalLinkCell> : item.author || '—'}</td><td><div className="harness-notices-actions">{item.notices.map((notice, index) => <button key={`${notice.name}:${index}`} type="button" onClick={() => openNotice(item, notice)} title={`Read ${notice.name} for ${item.name}`}>{item.notices.length === 1 ? item.license : notice.name}</button>)}</div></td><td>{item.relationship === 'direct' ? 'Direct' : <details><summary>{item.requiredBy.length} {item.requiredBy.length === 1 ? 'package' : 'packages'}</summary>{item.requiredBy.join(', ')}</details>}</td><td><div className="harness-notices-actions">{item.website && <ExternalLinkCell href={item.website}>Website</ExternalLinkCell>}{item.repository && <ExternalLinkCell href={item.repository}>Repository</ExternalLinkCell>}{item.documentation && <ExternalLinkCell href={item.documentation}>Docs</ExternalLinkCell>}</div></td></tr>)}</tbody></table>{!packages.length && <p className="harness-muted" role="status">Loading notices…</p>}{packages.length > 0 && !filtered.length && <p className="harness-muted">No packages matched.</p>}</div>}
    <p className="harness-notices-raw">{section === 'included' ? <>Production dependency tree. The build can remove unused code. <a href={`${import.meta.env.BASE_URL}licenses/third-party-notices.txt`} target="_blank" rel="noreferrer">Open raw third-party notices <ExternalLink size={13} aria-hidden="true"/></a></> : section === 'optional' ? 'Models and engines are downloaded only when selected. License files are saved beside them.' : section === 'build' ? 'Direct development dependencies are excluded from runtime notices.' : 'Development assistance is listed separately from website dependencies and optional models.'}</p>
    <dialog ref={dialog} className="harness-dialog harness-notice-dialog" onClose={() => setActive(null)}><header><div><span className="harness-overline">PACKAGE NOTICE</span><h2>{active?.packageName}</h2><p>{active?.notice.name}</p></div><button type="button" className="harness-icon" onClick={() => dialog.current?.close()} aria-label="Close notice"><X size={18}/></button></header>{active?.notice.source && <p className="harness-notice-source">Text source: {active.notice.source}</p>}<pre>{active?.notice.text}</pre></dialog>
  </section>;
}
