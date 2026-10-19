/** Run Vite and a disposable Chrome page on CDP port 9273. */
import assert from 'node:assert/strict';

const port = Number(process.env.CHROME_DEBUG_PORT || 9273);
const base = process.env.APP_URL || 'http://127.0.0.1:5173/';
const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(item => item.type === 'page' && item.url.startsWith(base));
if (!page) throw new Error(`Open ${base} in Chrome first.`);
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let id = 0;
const pending = new Map();
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  const waiter = pending.get(message.id);
  if (waiter) { pending.delete(message.id); message.error ? waiter.reject(message.error) : waiter.resolve(message.result); }
};
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const next = ++id;
  pending.set(next, { resolve, reject });
  socket.send(JSON.stringify({ id: next, method, params }));
});
try {
  await call('Runtime.enable');
  const response = await call('Runtime.evaluate', {
    awaitPromise: true, returnByValue: true,
    expression: `(async () => {
      const {measureWebmTiming}=await import('/src/webmTiming.ts');
      const canvas=document.createElement('canvas');canvas.width=canvas.height=64;
      const context=canvas.getContext('2d');
      const stream=canvas.captureStream(12);
      const recorder=new MediaRecorder(stream,{mimeType:'video/webm'});
      const chunks=[];recorder.ondataavailable=event=>chunks.push(event.data);
      const done=new Promise(resolve=>{recorder.onstop=resolve});
      recorder.start();
      for(let frame=0;frame<9;frame++){
        context.fillStyle=frame%2?'#f59e9e':'#1dc7cc';context.fillRect(0,0,64,64);
        await new Promise(resolve=>setTimeout(resolve,85));
      }
      recorder.stop();await done;stream.getTracks().forEach(track=>track.stop());
      const blob=new Blob(chunks,{type:'video/webm'});
      const timing=await measureWebmTiming(blob);
      return {size:blob.size,frames:timing.encodedFrames,duration:timing.durationSeconds};
    })()`,
  });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  const result = response.result.value;
  assert.ok(result.size > 0 && result.frames >= 2 && result.duration > 0, JSON.stringify(result));
  console.log(`Real MediaRecorder WebM timing passed: ${result.frames} frames, ${result.duration}s.`);
} finally { socket.close(); }
