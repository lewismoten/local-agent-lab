/** Live browser check: run Vite, Ollama llama3.2:3b, and Chrome CDP at port 9273. */
import assert from 'node:assert/strict';

const port = Number(process.env.CHROME_DEBUG_PORT || 9273);
const base = process.env.APP_URL || 'http://127.0.0.1:5173/';
const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(
  item => item.type === 'page' && item.url.startsWith(base),
);
if (!page) throw new Error(`Open ${base} in Chrome first.`);
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map();
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  const waiter = pending.get(message.id);
  if (waiter) { pending.delete(message.id); message.error ? waiter.reject(message.error) : waiter.resolve(message.result); }
};
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 20_000);
  pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};

try {
  await call('Runtime.enable');
  await evaluate(`(() => {
    const config={id:'ollama',label:'Local Ollama',provider:'ollama',model:'llama3.2:3b',endpoint:'http://127.0.0.1:11434',apiKey:'',effort:'default',thinkingTokens:0,maxOutputTokens:1024,contextWindow:8192};
    const controller=new AbortController();
    window.__achievementLive={progress:0,total:23,status:'running',controller};
    import('/src/harnessAchievementGeneration.ts').then(({generateAchievementSetDraft}) =>
      generateAchievementSetDraft(config,'Future awards','Optimistic near-future language, clear to new users.',controller.signal,(done,total)=>{window.__achievementLive.progress=done;window.__achievementLive.total=total;})
    ).then(set=>{window.__achievementLive.status='done';window.__achievementLive.set=set;})
      .catch(error=>{window.__achievementLive.status='failed';window.__achievementLive.error=String(error);});
    return true;
  })()`);
  let previous = -1;
  let result;
  for (let count = 0; count < 600; count++) {
    result = await evaluate(`(() => { const {status,progress,total,error,set}=window.__achievementLive;return {status,progress,total,error,set}; })()`);
    if (result.progress !== previous) { console.log(`Generated ${result.progress}/${result.total}`); previous = result.progress; }
    if (result.status !== 'running') break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.equal(result.status, 'done', result.error || 'Live generation timed out.');
  assert.equal(Object.keys(result.set.entries).length, 23);
  assert.match(result.set.entries['first-conversation'].title, /\S/);
  assert.match(result.set.entries['twenty-five-conversations'].imagePrompt, /\S/);
  console.log(JSON.stringify({ first: result.set.entries['first-conversation'], hidden: result.set.entries['twenty-five-conversations'] }, null, 2));
} finally { socket.close(); }
