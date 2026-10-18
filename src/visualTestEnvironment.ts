export type VisualTestEnvironment = {
  browser: string;
  platform: string;
  deviceClass: 'desktop' | 'tablet' | 'mobile';
  viewport: { width: number; height: number };
  webgpuApi: boolean;
  wasmApi: boolean;
};

export function isVisualTestEnvironment(value: unknown): value is VisualTestEnvironment {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<VisualTestEnvironment>;
  return typeof item.browser === 'string'
    && typeof item.platform === 'string'
    && (item.deviceClass === 'desktop' || item.deviceClass === 'tablet' || item.deviceClass === 'mobile')
    && typeof item.viewport?.width === 'number'
    && typeof item.viewport?.height === 'number'
    && typeof item.webgpuApi === 'boolean'
    && typeof item.wasmApi === 'boolean';
}

export function captureVisualTestEnvironment(): VisualTestEnvironment {
  const agent = navigator.userAgent;
  const browser = agent.match(/Edg(?:e|A|iOS)?\/([\d.]+)/)
    || agent.match(/(?:Chrome|CriOS)\/([\d.]+)/)
    || agent.match(/(?:Firefox|FxiOS)\/([\d.]+)/)
    || agent.match(/Version\/([\d.]+).*Safari/);
  const browserName = browser?.[0].startsWith('Edg') ? 'Edge'
    : browser?.[0].startsWith('Chrome') || browser?.[0].startsWith('CriOS') ? 'Chrome'
      : browser?.[0].startsWith('Firefox') || browser?.[0].startsWith('FxiOS') ? 'Firefox'
        : browser ? 'Safari' : 'Unknown browser';
  const platform = /iPad|iPhone|iPod/.test(agent) ? 'iOS'
    : /Android/.test(agent) ? 'Android'
      : /Macintosh|Mac OS X/.test(agent) ? 'macOS'
        : /Windows/.test(agent) ? 'Windows'
          : /Linux/.test(agent) ? 'Linux' : 'Unknown platform';
  const deviceClass = /iPad|Tablet|Android(?!.*Mobile)/i.test(agent) ? 'tablet'
    : /Mobi|iPhone|iPod/i.test(agent) ? 'mobile' : 'desktop';
  return {
    browser: browser ? `${browserName} ${browser[1]}` : browserName,
    platform,
    deviceClass,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    webgpuApi: 'gpu' in navigator,
    wasmApi: typeof WebAssembly !== 'undefined',
  };
}

export function visualEnvironmentLabel(environment: VisualTestEnvironment): string {
  return `${environment.browser} · ${environment.platform} ${environment.deviceClass} · ${environment.viewport.width} × ${environment.viewport.height} viewport · WebGPU API ${environment.webgpuApi ? 'available' : 'unavailable'} · WebAssembly API ${environment.wasmApi ? 'available' : 'unavailable'}`;
}
