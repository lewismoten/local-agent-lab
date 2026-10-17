import type { CSSProperties } from 'react';

type Props = { bytes: number; total: number; label: string; action?: 'pause' | 'resume'; onAction?: () => void; disabled?: boolean };

export default function DownloadRing({ bytes, total, label, action, onAction, disabled = false }: Props) {
  const percent = total > 0 ? Math.max(0, Math.min(100, bytes / total * 100)) : 0;
  const display = percent > 0 && percent < 1 ? percent.toFixed(1) : String(Math.floor(percent));
  const style = { '--download-progress': `${percent}%` } as CSSProperties;
  const content = <><span className="download-ring-percent">{display}%</span>{action && <span className="download-ring-action" aria-hidden="true">{action === 'pause' ? '⏸' : '▶'}</span>}</>;
  const actionLabel = `${action === 'pause' ? 'Pause' : 'Resume'} ${label.replace(/ download progress$/, '')} download`;
  const className = `download-ring${action === 'pause' ? ' active' : ' paused'}${action && onAction ? ' interactive' : ''}`;
  if (action && onAction) return <button
    className={className}
    type="button"
    aria-label={`${actionLabel} (${display}% complete)`}
    data-tooltip={actionLabel}
    disabled={disabled}
    onClick={onAction}
    style={style}
  >{content}</button>;
  return <div className={className} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent * 10) / 10} style={style}>{content}</div>;
}
