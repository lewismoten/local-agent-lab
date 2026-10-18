export type VideoEncodingSupport = {
  mediaRecorder: { available: boolean; webm: string[]; mp4: string[] };
  webCodecs: { available: boolean; codecs: string[]; testedAt: { width: number; height: number; bitrate: number; framerate: number } };
};

export const WEBM_RECORDER_FORMATS = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'] as const;
export const MP4_RECORDER_FORMATS = ['video/mp4;codecs=avc1.42E01E', 'video/mp4'] as const;
export type VideoExportFormat = 'auto' | 'webm' | 'mp4';

const recorderFormats = {
  webm: WEBM_RECORDER_FORMATS,
  mp4: MP4_RECORDER_FORMATS,
};

const encoderCodecs = [
  ['H.264', 'avc1.42001F'],
  ['VP8', 'vp8'],
  ['VP9', 'vp09.00.10.08'],
] as const;

export async function probeVideoEncodingSupport(): Promise<VideoEncodingSupport> {
  const recorder = typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function';
  const canRecord = (type: string) => {
    try { return recorder && MediaRecorder.isTypeSupported(type); }
    catch { return false; }
  };
  const encoder = (globalThis as typeof globalThis & { VideoEncoder?: { isConfigSupported(config: { codec: string; width: number; height: number; bitrate: number; framerate: number }): Promise<{ supported: boolean }> } }).VideoEncoder;
  const testedAt = { width: 256, height: 256, bitrate: 1_000_000, framerate: 12 };
  const codecs: string[] = [];
  if (typeof encoder?.isConfigSupported === 'function') {
    for (const [label, codec] of encoderCodecs) {
      try {
        const result = await encoder.isConfigSupported({ codec, ...testedAt });
        if (result.supported) codecs.push(label);
      } catch { /* Unsupported configurations may reject instead of returning false. */ }
    }
  }
  return {
    mediaRecorder: { available: recorder, webm: recorderFormats.webm.filter(canRecord), mp4: recorderFormats.mp4.filter(canRecord) },
    webCodecs: { available: typeof encoder?.isConfigSupported === 'function', codecs, testedAt },
  };
}
