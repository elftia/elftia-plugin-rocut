import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect } from './rocut-probe-source.mjs';

const hostRoot = resolve(process.env.ELFTIA_WORKTREE ?? '');
const sessionId = process.env.ELFTIA_TEST_SESSION;
assert(process.env.ELFTIA_WORKTREE && sessionId && process.env.ELFTIA_REUSE_TEST_PROJECT);
await import(pathToFileURL(join(hostRoot, 'packages/elftia-cli/src/proxy.ts')).href);
const { connect } = await import(pathToFileURL(join(hostRoot, 'packages/elftia-cli/src/connect.ts')).href);
const conn = await connect({mode:'attach',port:Number(process.env.ELFTIA_CLI_DEBUG_PORT ?? 9333)});
const work = mkdtempSync(join(hostRoot,'.tmp-rocut-e2e/close-failure-'));
const evidence = {kind:'real-elftia',acceptanceEligible:false,reason:'controlled 507 persistence failure',checks:[],passed:false};
const slot = '[data-testid="webpane-tab-slot"][data-tool-id="rocut"]';
const close = '[data-testid="chat-button-workspace-close"][data-workspace-id="rocut"]';
const seconds = text => {const [h,m,s,f]=text.trim().split(':').map(Number);return h*3600+m*60+s+f/30;};
let recordUrl;
let route;
try {
  const owner=await conn.page.evaluate(async id=>({active:document.querySelector('[data-session-active="true"]')?.getAttribute('data-session-id'),folder:(await window.native.sessions.chat.get(id)).projectPath}),sessionId);
  assert.equal(owner.active,sessionId);
  assert.equal(resolve(owner.folder),join(hostRoot,'.tmp-rocut-e2e/project'));
  const fixture=realpathSync(process.env.ELFTIA_REUSE_TEST_PROJECT);
  const nested=relative(realpathSync(owner.folder),fixture);
  assert(nested && !nested.startsWith('..') && !isAbsolute(nested));
  let frame;
  for(const candidate of conn.page.frames()) if((await candidate.title().catch(()=>'' )).startsWith('OpenCut editor'))frame=candidate;
  assert(frame);
  const readRecord=()=>frame.evaluate(async()=> (await(await fetch(new URL('api/record',location.href))).json()).record);
  const before=await readRecord();
  const diskBefore=readFileSync(join(fixture,'project.json'));
  assert.equal(before.data.metadata.id,JSON.parse(diskBefore.toString('utf8')).record.data.metadata.id);
  let failures=0;
  recordUrl=await frame.evaluate(()=>new URL('api/record',location.href).href);
  route=async request=>{
    if(request.request().method()!=='PUT')return request.continue();
    failures++;
    await request.fulfill({status:507,contentType:'application/json',body:JSON.stringify({error:'controlled E2E storage failure'})});
  };
  await conn.page.route(recordUrl,route);
  await frame.getByLabel('Play preview',{exact:true}).click();
  const start=seconds(await frame.getByLabel('Edit playhead time',{exact:true}).innerText());
  await expect.poll(async()=>seconds(await frame.getByLabel('Edit playhead time',{exact:true}).innerText()),{timeout:15000}).toBeGreaterThan(start+2);
  await conn.page.locator(close).click();
  await expect(conn.page.getByTestId('chat-panel-workspace-close-error')).toBeVisible({timeout:20000});
  const message=await conn.page.getByTestId('chat-panel-workspace-close-error').innerText();
  assert(message.length>10 && !message.includes('webPane.prepareCloseFailed'),'The retry error must be translated, not a raw locale key');
  assert(failures>0,'The actual save endpoint must have been hit');
  await expect(conn.page.locator(slot)).toHaveCount(1);
  const paused=seconds(await frame.getByLabel('Edit playhead time',{exact:true}).innerText());
  await expect(frame.getByLabel('Play preview',{exact:true})).toBeVisible();
  assert.deepEqual(readFileSync(join(fixture,'project.json')),diskBefore,'Failed save must not alter durable bytes');
  evidence.checks.push({name:'Actual 507 save failure retains live paused editor, shows retry error and preserves durable bytes',pass:true,failures,paused});
  await conn.page.screenshot({path:join(work,'retained-error.png')});
  await conn.page.unroute(recordUrl,route); route=undefined;
  await conn.page.locator(close).click();
  await expect(conn.page.locator(slot)).toHaveCount(0,{timeout:20000});
  const saved=JSON.parse(readFileSync(join(fixture,'project.json'),'utf8')).record.data.timelineViewState;
  assert(Math.abs(saved.playheadTime/120000-paused)<0.05);
  await conn.page.locator('[data-testid="chat-tab-workspace"][data-workspace-id="rocut"]').click();
  await expect.poll(async()=>{
    for(const candidate of conn.page.frames())if((await candidate.title().catch(()=>'' )).startsWith('OpenCut editor')){frame=candidate;return true;}
    return false;
  },{timeout:30000}).toBe(true);
  await expect.poll(async()=>seconds(await frame.getByLabel('Edit playhead time',{exact:true}).innerText()),{timeout:30000}).toBeCloseTo(paused,1);
  evidence.checks.push({name:'Removing storage fault and retrying durably closes and reopens at the retained position',pass:true,saved});
  await frame.getByLabel('Play preview',{exact:true}).click();
  await expect.poll(async()=>seconds(await frame.getByLabel('Edit playhead time',{exact:true}).innerText()),{timeout:15000}).toBeGreaterThan(paused+2);
  const beforeReload=seconds(await frame.getByLabel('Edit playhead time',{exact:true}).innerText());
  const oldFrame=frame;
  await conn.page.getByTestId('chat-button-tool-reload').click();
  await expect.poll(()=>oldFrame.isDetached(),{timeout:20000}).toBe(true);
  await expect.poll(async()=>{
    for(const candidate of conn.page.frames())if((await candidate.title().catch(()=>'' )).startsWith('OpenCut editor')){frame=candidate;return true;}
    return false;
  },{timeout:30000}).toBe(true);
  const reloaded=JSON.parse(readFileSync(join(fixture,'project.json'),'utf8')).record.data.timelineViewState;
  assert(reloaded.playheadTime/120000>=beforeReload-0.05 && reloaded.playheadTime/120000<=beforeReload+2);
  await expect.poll(async()=>seconds(await frame.getByLabel('Edit playhead time',{exact:true}).innerText()),{timeout:30000}).toBeCloseTo(reloaded.playheadTime/120000,1);
  evidence.checks.push({name:'Actual host toolbar reload during playback waits for durable state and restores the latest position',pass:true,beforeReload,reloaded});
  evidence.passed=true;
} catch(error){evidence.failure=String(error.message).replace(/https?:\/\/[^\s]+/g,'[redacted-url]');process.exitCode=1;}
finally{
  if(route)await conn.page.unroute(recordUrl,route);
  writeFileSync(join(work,'evidence.json'),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify({work,...evidence}));
  await conn.close();
}
