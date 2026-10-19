/** Run Vite and a disposable Chrome page on CDP port 9274. Uses mock ONNX sessions. */
import assert from 'node:assert/strict';

const port = Number(process.env.CHROME_DEBUG_PORT || 9274);
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
  const result = await call('Runtime.evaluate', {
    awaitPromise: true, returnByValue: true,
    expression: `(async () => {
      const {createSupraPipeline}=await import('/src/supraPipeline.ts');
      const phases=[];let created=0,runs=0,releaseGpu,startGpu;
      const enteredGpu=new Promise(resolve=>{startGpu=resolve});
      const gpuWork=new Promise(resolve=>{releaseGpu=resolve});
      const ort={Tensor:class {constructor(type,data,shape){this.type=type;this.data=data;this.shape=shape}},InferenceSession:{create:async()=>{
        const index=created++;
        return {run:async()=>{
          if(index===0)return {output:{data:new Float32Array(128*768)}};
          if(index===1){runs++;startGpu();await gpuWork;return {output:{data:new Float32Array(4*32*32)}};}
          throw new Error('Decoder should not run after Stop');
        },release:async()=>{}};
      }}};
      const files=[0,1,2].map(index=>new File(['test'],index+'.onnx'));
      const tokenize=()=>({ids:new BigInt64Array(128),mask:new Float32Array(128)});
      const pipeline=createSupraPipeline(ort,files,tokenize,()=>{});
      await pipeline.loadModels();
      const controller=new AbortController();
      const generation=pipeline.generate('A leaf',{steps:12,signal:controller.signal,onActivity:phase=>phases.push(phase)});
      await enteredGpu;
      controller.abort(new DOMException('Stopped.','AbortError'));
      releaseGpu();
      let stopped=false;
      try { await generation; } catch(error) { stopped=error.name==='AbortError'; }
      await pipeline.release();
      return {phases,runs,stopped};
    })()`,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  assert.equal(result.result.value.stopped, true);
  assert.equal(result.result.value.runs, 1);
  assert.ok(result.result.value.phases.includes('Preparing first GPU pass…'));
  console.log('Supra first-step activity and Stop passed with mock ONNX sessions.');
} finally { socket.close(); }
