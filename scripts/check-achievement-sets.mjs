/** Run Vite on 5173 and fresh Chrome on CDP 9259 at /#/achievements. */
import assert from 'node:assert/strict';

const port = Number(process.env.CHROME_DEBUG_PORT || 9259);
const base = process.env.APP_URL || 'http://127.0.0.1:5173/';
const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(
  (item) => item.type === 'page' && item.url.startsWith(base),
);
if (!page) throw new Error(`Open ${base} in Chrome first.`);
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});
let sequence = 0;
const pending = new Map();
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  const waiter = pending.get(message.id);
  if (waiter) {
    pending.delete(message.id);
    message.error ? waiter.reject(message.error) : waiter.resolve(message.result);
  }
};
const call = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, 20_000);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
const waitFor = async (expression, label) => {
  for (let count = 0; count < 120; count++) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
};
const clickText = (label) =>
  evaluate(
    `[...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(label)})?.click(); true`,
  );
const setInput = (selector, value) =>
  evaluate(
    `(() => { const input=document.querySelector(${JSON.stringify(selector)}); const setter=Object.getOwnPropertyDescriptor(input.tagName==='TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,'value').set; setter.call(input,${JSON.stringify(value)}); input.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`,
  );

try {
  await call('Runtime.enable');
  await waitFor("!!document.querySelector('.harness-achievements-page')", 'Achievements page');
  await clickText('Sets');
  await waitFor("document.querySelector('.harness-achievement-sets-dialog')?.open", 'set manager');
  await clickText('New set');
  await waitFor("!!document.querySelector('.harness-achievement-set-entries')", 'set editor');
  await setInput('.harness-achievement-set-form input', 'Test awards');
  await setInput(
    '.harness-achievement-set-entries fieldset:first-child label:first-of-type input',
    'First spark',
  );
  await clickText('Save and use set');
  await waitFor(
    "document.querySelector('.harness-achievement-sets-dialog select[aria-label=\"Current achievement set\"]')?.selectedOptions[0]?.textContent === 'Test awards'",
    'active set',
  );
  await waitFor(
    "[...document.querySelectorAll('.harness-achievement-card h2')].some(item => item.textContent === 'First spark')",
    'new title',
  );
  const saved = await evaluate(
    "(async()=>{ const {store}=await (await import('/src/harnessStore.ts')).openBrowserWorkspace(); const library=await store.achievementSets(); return {count:library.sets.length, active:library.activeId, title:library.sets[0].entries['first-conversation'].title, hidden:!!library.sets[0].entries['twenty-five-conversations']}; })()",
  );
  assert.equal(saved.count, 1);
  assert.equal(saved.title, 'First spark');
  assert.equal(saved.hidden, true);
  await evaluate(`(async()=>{ const {store}=await (await import('/src/harnessStore.ts')).openBrowserWorkspace(); const canvas=document.createElement('canvas'); canvas.width=canvas.height=64; const context=canvas.getContext('2d'); context.fillStyle='#65d9cf'; context.fillRect(0,0,64,64); const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png')); const asset=await store.saveAvatarAsset(blob,{title:'First spark icon',tags:['Achievement'],source:'generated'}); await store.saveSurfaceArtwork('achievement-set:${saved.active}:first-conversation',asset.id,'A first conversation begins.'); return true; })()`);
  await evaluate('location.reload(); true');
  await waitFor("!!document.querySelector('.harness-achievement-card .harness-achievement-symbol img')", 'set icon after reload');
  await clickText('Sets');
  await waitFor("document.querySelector('.harness-achievement-sets-dialog')?.open", 'set manager after reload');
  await evaluate(
    '(() => { const original=URL.createObjectURL.bind(URL); URL.createObjectURL=blob => { window.__achievementExport=blob; return original(blob); }; return true; })()',
  );
  await clickText('Export');
  await waitFor('!!window.__achievementExport', 'achievement pack export');
  const exported = await evaluate('(async () => JSON.parse(await window.__achievementExport.text()))()');
  assert.equal(exported.set.entries['first-conversation'].title, 'First spark');
  assert.equal(Object.keys(exported.set.entries).length, 23);
  assert.ok(exported.icons['first-conversation'].png.length > 100);
  await evaluate(
    `(() => { const input=document.querySelector('.harness-achievement-sets-dialog input[type=file]'); const transfer=new DataTransfer(); transfer.items.add(new File([${JSON.stringify(JSON.stringify(exported))}], 'awards.achievements.json', {type:'application/json'})); input.files=transfer.files; input.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`,
  );
  await waitFor("!!document.querySelector('.harness-achievement-set-entries')", 'imported set editor');
  await setInput('.harness-achievement-set-form input', 'Imported awards');
  await clickText('Save and use set');
  await waitFor(
    "document.querySelector('.harness-achievement-sets-dialog select[aria-label=\"Current achievement set\"]')?.selectedOptions[0]?.textContent === 'Imported awards'",
    'imported set saved',
  );
  const imported = await evaluate(
    "(async()=>{const {store}=await (await import('/src/harnessStore.ts')).openBrowserWorkspace(); const library=await store.achievementSets();return {count:library.sets.length,ids:library.sets.map(set=>set.id),active:library.activeId,icon:!!(await store.surfaceArtwork()).items[`achievement-set:${library.activeId}:first-conversation`]};})()",
  );
  assert.equal(imported.count, 2);
  assert.equal(new Set(imported.ids).size, 2);
  assert.equal(imported.icon, true);
  await waitFor("!!document.querySelector('.harness-achievement-card .harness-achievement-symbol img')", 'imported icon displayed');
  await evaluate("(()=>{const select=document.querySelector('.harness-achievement-sets-dialog select[aria-label=\"Current achievement set\"]'); select.value='';select.dispatchEvent(new Event('change',{bubbles:true}));return true;})()");
  await waitFor("!document.querySelector('.harness-achievement-card .harness-achievement-symbol img')", 'original artwork restored');
  await evaluate(`(()=>{const select=document.querySelector('.harness-achievement-sets-dialog select[aria-label="Current achievement set"]'); select.value=${JSON.stringify(imported.active)};select.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
  await waitFor("!!document.querySelector('.harness-achievement-card .harness-achievement-symbol img')", 'imported artwork restored');
  await evaluate('location.reload(); true');
  await waitFor(
    "[...document.querySelectorAll('.harness-achievement-card h2')].some(item => item.textContent === 'First spark')",
    'saved title after reload',
  );
  await call('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await clickText('Sets');
  await waitFor("document.querySelector('.harness-achievement-sets-dialog')?.open", 'mobile manager');
  const fit = await evaluate(
    "(()=>{const dialog=document.querySelector('.harness-achievement-sets-dialog');const rect=dialog.getBoundingClientRect();return {width:innerWidth,left:rect.left,right:rect.right,overflow:document.documentElement.scrollWidth-innerWidth};})()",
  );
  assert.ok(
    fit.left >= -1 && fit.right <= fit.width + 1 && fit.overflow <= 1,
    `Mobile overflow: ${JSON.stringify(fit)}`,
  );
  await clickText('Regenerate icons');
  await waitFor("!!document.querySelector('.harness-icon-studio')", 'achievement icon batch');
  const batch = await evaluate(
    "(()=>({checks:[...document.querySelectorAll('.harness-icon-studio-kinds input')].map(input=>input.checked),scope:document.querySelector('.harness-icon-studio-fields select').value,prompt:document.querySelector('.harness-icon-studio')?.textContent.includes('23 icons selected')}))()",
  );
  assert.deepEqual(batch.checks, [false, true, false]);
  assert.equal(batch.scope, 'all');
  assert.equal(batch.prompt, true);
  console.log(
    'Achievement sets passed: copy and icon export/import, set artwork switching, reload, batch handoff, and 390px fit.',
  );
} finally {
  socket.close();
}
