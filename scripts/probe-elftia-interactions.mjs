import { loadRocutProbe } from "./rocut-probe-source.mjs";
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect } from './rocut-probe-source.mjs';
const { probeCoreInteractions } = await loadRocutProbe("probe-core-interactions.mjs");
const { probeMixedExport } = await loadRocutProbe("probe-mixed-export.mjs");
const { probeExportRecovery } = await loadRocutProbe("probe-export-recovery.mjs");
import { probeEmbeddedLayout } from './probe-embedded-layout.mjs';
import { probeEmbeddedToolbars } from './probe-embedded-toolbars.mjs';
const { probeFocusedMotion } = await loadRocutProbe("probe-focused-motion.mjs");
const { probeJizuraImport } = await loadRocutProbe("probe-jizura-import.mjs");
const { probeResponsiveMotion } = await loadRocutProbe("probe-responsive-motion.mjs");
const { reloadEditorFrame } = await loadRocutProbe("probe-reload-editor.mjs");
const { probeInstalledPreview } = await loadRocutProbe("probe-installed-preview.mjs");
const { probeVideoFreeze } = await loadRocutProbe("probe-video-freeze.mjs");
const { probeColorAdjustment } = await loadRocutProbe("probe-color-adjustment.mjs");
const { probeTransitionPersistence } = await loadRocutProbe("probe-transition-persistence.mjs");
const { probeVideoSourceLifetime } = await loadRocutProbe("probe-video-source-lifetime.mjs");
const { probeTransitionRender } = await loadRocutProbe("probe-transition-render.mjs");
const { probeMediaImport } = await loadRocutProbe("probe-media-import.mjs");
const { probeAudioFormats } = await loadRocutProbe("probe-audio-formats.mjs");
const { probeMediaMime } = await loadRocutProbe("probe-media-mime.mjs");
const { probeTimelineControls } = await loadRocutProbe("probe-timeline-controls.mjs");
const { probeMotionDuration } = await loadRocutProbe("probe-motion-duration.mjs");
const { probeMotionStress } = await loadRocutProbe("probe-motion-stress.mjs");
const { probeMotionStressMemory } = await loadRocutProbe("probe-motion-stress-memory.mjs");
const { probeFingerprintCompaction } = await loadRocutProbe("probe-fingerprint-compaction.mjs");
const { probeMotionFullExport } = await loadRocutProbe("probe-motion-full-export.mjs");
const { probeExportBackpressure } = await loadRocutProbe("probe-export-backpressure.mjs");
const { probeVideoProperties } = await loadRocutProbe("probe-video-properties.mjs");
const { probeGraphPresets } = await loadRocutProbe("probe-graph-presets.mjs");
const { probeMediaDrop } = await loadRocutProbe("probe-media-drop.mjs");
const { probePreviewPlayback } = await loadRocutProbe("probe-preview-playback.mjs");
const { probePlaybackViewState } = await loadRocutProbe("probe-playback-view-state.mjs");
const { probeEditorMenu } = await loadRocutProbe("probe-editor-menu.mjs");
import { probeAgentDrafts } from './probe-agent-drafts.mjs';
const { probeUiFormatExport } = await loadRocutProbe("probe-ui-format-export.mjs");
const { probeUiExportOptions } = await loadRocutProbe("probe-ui-export-options.mjs");
const { probeUiRangeExport } = await loadRocutProbe("probe-ui-range-export.mjs");
const { probeMaskControls } = await loadRocutProbe("probe-mask-controls.mjs");
const { probeFreeformMask } = await loadRocutProbe("probe-freeform-mask.mjs");
const { probeMaskShapes } = await loadRocutProbe("probe-mask-shapes.mjs");
const { probeMaskFeather } = await loadRocutProbe("probe-mask-feather.mjs");
const { probeMaskStroke } = await loadRocutProbe("probe-mask-stroke.mjs");
const { probeMultilingual } = await loadRocutProbe("probe-multilingual.mjs");
const { probeFontRecovery } = await loadRocutProbe("probe-font-recovery.mjs");
const { probeUnknownPreset } = await loadRocutProbe("probe-unknown-preset.mjs");
const { probeMotionClipContinuity } = await loadRocutProbe("probe-motion-clip-continuity.mjs");
const { probeCueLockWorkflow } = await loadRocutProbe("probe-cue-lock-workflow.mjs");
import { enterCreatorProject } from './probe-creator-entry.mjs';
import { probeLinkedWorkflow } from './probe-linked-workflow.mjs';
import { probeClipExport } from './probe-clip-export.mjs';
const { probePreviewMutation } = await loadRocutProbe("probe-preview-mutation.mjs");
import { probeMissingGlyph } from './probe-missing-glyph.mjs';
const { probeF02Languages } = await loadRocutProbe("probe-f02-languages.mjs");
import { probeF03Languages } from './probe-f03-languages.mjs';

// Run with the Elftia worktree's tsx loader. Never launch a substitute browser.
const hostRoot = resolve(process.env.ELFTIA_WORKTREE ?? '');
assert(process.env.ELFTIA_WORKTREE, 'Set ELFTIA_WORKTREE to the authorized dev worktree');
const sessionId = process.env.ELFTIA_TEST_SESSION;
assert(sessionId, 'Set ELFTIA_TEST_SESSION to an authorized dedicated test session');
if (['--linked-workflow-only', '--agent-drafts-only'].some(flag => process.argv.includes(flag))) {
  assert(process.env.ELFTIA_INSTALLED_ROCUT, 'Set the exact installed plugin root');
  realpathSync(process.env.ELFTIA_INSTALLED_ROCUT);
}
await import(pathToFileURL(join(hostRoot, 'packages/elftia-cli/src/proxy.ts')).href);
const { connect } = await import(pathToFileURL(join(hostRoot, 'packages/elftia-cli/src/connect.ts')).href);
const conn = await connect({mode:'attach', port:Number(process.env.ELFTIA_CLI_DEBUG_PORT ?? 9333)});
const evidenceRoot = join(hostRoot, '.tmp-rocut-e2e');
mkdirSync(evidenceRoot, {recursive:true});
const work = mkdtempSync(join(evidenceRoot, 'live-'));
const evidence = {kind:'real-elftia', fixtureSetup:'host preload API, not project-creation UI acceptance', acceptanceEligible:!process.env.ROCUT_DIAGNOSTIC_DECODER_HINT, checks:[], errors:[], requests:[]};
const scrub = value => String(value).replace(/(https?:\/\/(?:127\.0\.0\.1|localhost):\d+)\/[^\s/]+/g,'$1/[redacted]');
let phase = 'ownership';
let editor;
let nativeAudioCdp;
const previousViewport = conn.page.viewportSize();
try {
  const ownership = await conn.page.evaluate(async id => {
    const session = await window.native.sessions.chat.get(id);
    const active = document.querySelector('[data-session-active="true"]')?.getAttribute('data-session-id') ?? window.__ELFTIA__?.activeSessionId;
    return {active, folder:session.projectPath};
  },sessionId);
  assert.equal(ownership.active,sessionId);
  assert.equal(resolve(ownership.folder),join(evidenceRoot,'project'),'Only the dedicated test workspace may be mutated');
  // CDP metrics can stall Electron's realtime audio clock on this host.
  // Use native metrics for audio measurements; fixed metrics remain useful
  // for gesture/layout fixtures. Finally restores the previous host metrics.
  const nativeAudio = ['--audio-formats-only', '--media-mime-only', '--timeline-controls-only', '--motion-playback-only'].some(flag=>process.argv.includes(flag));
  if (nativeAudio) {
    nativeAudioCdp = await conn.context.newCDPSession(conn.page);
    await nativeAudioCdp.send('Emulation.clearDeviceMetricsOverride');
  } else await conn.page.setViewportSize(['--motion-edit-only','--motion-seek-only','--motion-stress-only','--motion-stress-memory-only','--motion-stress-full-export-only','--export-backpressure-only'].some(flag=>process.argv.includes(flag)) ? {width:1920,height:1080} : {width:1280,height:900});
  evidence.viewportMode = nativeAudio ? 'native-audio' : 'emulated-interactions';
  const frames = conn.page.frames();
  for (const frame of frames) if ((await frame.title().catch(()=>'' )).startsWith('OpenCut editor')) editor=frame;
  assert(editor,'Open Rocut in the authorized Elftia session before this probe');
  const fullMotionExport = process.argv.includes('--motion-stress-full-export-only');
  const backpressureOnly = process.argv.includes('--export-backpressure-only');
  const fingerprintCompaction = process.argv.includes('--fingerprint-compaction-only');
  const reuseStressFixture = fingerprintCompaction || process.argv.includes('--motion-stress-memory-only') || fullMotionExport || backpressureOnly;
  let reusePath;
  if (reuseStressFixture) {
    assert(process.env.ELFTIA_REUSE_TEST_PROJECT, 'Set the exact owned F05 project path');
    reusePath = realpathSync(process.env.ELFTIA_REUSE_TEST_PROJECT);
    const nested = relative(realpathSync(ownership.folder), reusePath);
    assert(nested && !nested.startsWith('..') && !isAbsolute(nested), 'Reused fixture must remain in the dedicated test folder');
  }
  // Finish the previous editor's durable close BEFORE opening a new fixture:
  // that final save updates recency, which the real launcher uses as default.
  await conn.page.locator('[data-testid="chat-button-workspace-close"][data-workspace-id="rocut"]').click();
  await expect(conn.page.locator('[data-testid="webpane-tab-slot"][data-tool-id="rocut"]')).toHaveCount(0, {timeout:20000});
  const project = reuseStressFixture ? await conn.page.evaluate(async ({folder,path}) => {
    const opened = await window.native.toolHosts.openProject({toolId:'rocut',workingFolder:folder,projectPath:path});
    return {path,url:opened.editorUrl};
  },{folder:ownership.folder,path:reusePath}) : await conn.page.evaluate(async ({folder,name}) => {
    const created = await window.native.toolHosts.createProject({toolId:'rocut',workingFolder:folder,name});
    const opened = await window.native.toolHosts.openProject({toolId:'rocut',workingFolder:folder,projectPath:created.path});
    return {path:created.path,url:opened.editorUrl};
  },{folder:ownership.folder,name:'live-'+Date.now()});
  assert(resolve(project.path).startsWith(resolve(ownership.folder)+'/') || resolve(project.path).startsWith(resolve(ownership.folder)+'\\'));
  evidence.projectPath=project.path;
  if (process.argv.includes('--linked-workflow-only')) {
    phase='Creator Studio project entry';
    console.log('phase:',phase);
    await enterCreatorProject({hostPage:conn.page,sessionId,folder:ownership.folder,evidence});
  }
  // Reopen through the real workspace button: host URL/theme ownership must
  // follow the fixture too, not just a navigation of its existing iframe.
  await conn.page.locator('[data-testid="chat-tab-workspace"][data-workspace-id="rocut"]').click();
  await expect.poll(async () => {
    for (const frame of conn.page.frames()) {
      if (frame.url() === project.url) { editor=frame; return true; }
    }
    return false;
  }, {timeout:30000}).toBe(true);
  await editor.locator('[aria-label="Media"]').waitFor({timeout:30000});
  assert(await editor.evaluate(()=>isSecureContext && typeof VideoDecoder !== 'undefined'));
  evidence.checks.push({name:'real Elftia iframe loaded with WebCodecs',pass:true});
  const readRecord=()=>editor.evaluate(async()=> (await (await fetch(new URL('api/record',location.href))).json()).record);
  const initialRecord = await readRecord();
  assert.equal(initialRecord.data.motionTextSequences?.length ?? 0,reuseStressFixture ? 1 : 0);
  if (reuseStressFixture) {
    assert.equal(initialRecord.data.motionTextSequences[0].cues.length,600);
    assert.equal(initialRecord.data.motionTextSequences[0].duration,480*120000);
  }
  // Frame operations use the parent page's real input devices; never dispatch fake events.
  const page = new Proxy(editor, {get(target,key) {
    if (key==='keyboard' || key==='mouse') return conn.page[key];
    if (key==='screenshot') return options=>conn.page.screenshot(options);
    if (key==='reload') return ()=>reloadEditorFrame(target);
    const value=target[key]; return typeof value==='function'?value.bind(target):value;
  }});
  conn.page.on('pageerror',error=>evidence.errors.push(scrub(error.message)));
  if (['--motion-playback-only', '--adjustment-only', '--transition-render-only', '--transition-authoring-only', '--transition-image-authoring-only', '--motion-seek-only', '--motion-duration-only', '--motion-stress-only', '--motion-stress-memory-only', '--motion-stress-full-export-only', '--export-backpressure-only'].some(flag => process.argv.includes(flag))) conn.page.on('console', message => {
    if (message.type() === 'error' && /Failed to render preview frame|Validation Error/.test(message.text())) evidence.errors.push(scrub(message.text()));
  });
  // Safe transaction summaries distinguish a dropped shortcut from stale persistence.
  evidence.recordWrites=[];
  conn.page.on('request',request=>{
    if(request.method()!=='PUT'||!request.url().endsWith('/api/record'))return;
    const data=request.postDataJSON()?.record?.data;
    evidence.recordWrites.push({phase,revision:data?.__opencutTransaction?.revision,sequences:data?.motionTextSequences?.map(s=>({revision:s.revision,beatOverride:s.audioBinding?.beatOverride}))});
  });
  // Electron may handle beforeunload before the CDP acknowledgement returns.
  // Handle it explicitly so Playwright does not create an unhandled auto-dismiss.
  conn.page.on('dialog', dialog=>{
    void dialog.accept().catch(error=>{
      evidence.errors.push(scrub(error.message));
    });
  });
  conn.page.on('response',response=>{if(response.status()>=400 && response.url().includes('/api/')) evidence.requests.push({phase,status:response.status(),url:scrub(response.url())});});
  const audioFixture=join(work,'fixture-tone-a4.wav');
  execFileSync('ffmpeg',['-v','error','-n','-f','lavfi','-i','sine=frequency=440:duration=16','-ar','44100','-ac','1','-c:a','pcm_s16le',audioFixture],{windowsHide:true});
  if (process.argv.includes('--f03-languages-only')) {
    await probeF03Languages({page,hostPage:conn.page,project:project.path,folder:ownership.folder,work,evidence,onPhase:next=>{phase=next;console.log('phase:',next);}});
  } else if (process.argv.includes('--f02-languages-only')) {
    await probeF02Languages({page,hostPage:conn.page,work,evidence,onPhase:next=>{phase=next;console.log('phase:',next);}});
  } else if (process.argv.includes('--missing-glyph-only')) {
    await probeMissingGlyph({page,hostPage:conn.page,work,evidence,onPhase:next=>{phase=next;console.log('phase:',next);}});
  } else if (process.argv.includes('--motion-edit-only')) {
    const onPhase=next=>{phase=next;console.log('phase:',next);};
    await probeMotionDuration({page,hostPage:conn.page,work,evidence,includeVideo:true,onPhase});
    await probePreviewMutation({page,hostPage:conn.page,work,evidence,onPhase});
  } else if (process.argv.includes('--clip-export-only')) {
    await probeClipExport({page,hostPage:conn.page,work,evidence,onPhase:next=>{phase=next;console.log('phase:',next);}});
  } else if (process.argv.includes('--focused-motion-only')) {
    await probeFocusedMotion({page,hostPage:conn.page,work,evidence,onPhase:next=>{phase=next;console.log('phase:',next);}});
  } else if (process.argv.includes('--toolbars-only')) {
    await probeEmbeddedToolbars({page,hostPage:conn.page,work,evidence,onPhase:next=>{phase=next;console.log('phase:',next);}});
  } else if (process.argv.includes('--linked-workflow-only')) {
    await probeLinkedWorkflow({page,hostPage:conn.page,project:project.path,work,evidence,onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (process.argv.includes('--agent-drafts-only')) {
    await probeAgentDrafts({page,hostPage:conn.page,project:project.path,work,evidence,onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (process.argv.includes('--cue-lock-workflow-only')) {
    await probeCueLockWorkflow({page,hostPage:conn.page,work,evidence,onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (process.argv.includes('--motion-clip-continuity-only')) {
    await probeMotionClipContinuity({page,hostPage:conn.page,work,evidence,onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (process.argv.includes('--unknown-preset-only')) {
    await probeUnknownPreset({page,hostPage:conn.page,work,evidence,onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (process.argv.includes('--font-recovery-only')) {
    await probeFontRecovery({page,hostPage:conn.page,work,evidence,onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (process.argv.includes('--multilingual-only')) {
    await probeMultilingual({page,hostPage:conn.page,work,evidence,onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (process.argv.includes('--mask-stroke-only')) {
    await probeMaskStroke({page,hostPage:conn.page,work,evidence,onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (process.argv.includes('--mask-feather-only')) {
    await probeMaskFeather({page,hostPage:conn.page,work,evidence,onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (process.argv.includes('--mask-shapes-only')) {
    await probeMaskShapes({page,hostPage:conn.page,work,evidence,onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (process.argv.includes('--freeform-mask-only')) {
    await probeFreeformMask({page,hostPage:conn.page,work,evidence,onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (process.argv.includes('--mask-controls-only')) {
    await probeMaskControls({page,hostPage:conn.page,work,evidence,onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (process.argv.includes('--ui-range-export-only')) {
    await probeUiRangeExport({page,hostPage:conn.page,work,evidence,onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (process.argv.includes('--ui-export-options-only')) {
    await probeUiExportOptions({page,hostPage:conn.page,work,evidence,onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (process.argv.includes('--ui-format-export-only') || process.argv.includes('--ui-webm-format-export-only')) {
    await probeUiFormatExport({page,hostPage:conn.page,work,evidence,format:process.argv.includes('--ui-webm-format-export-only')?'webm':'mp4',onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (process.argv.includes('--editor-menu-only')) {
    await probeEditorMenu({page,hostPage:conn.page,work,evidence,onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (backpressureOnly) {
    await probeExportBackpressure({page,evidence,onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (fullMotionExport) {
    await probeMotionFullExport({page,project:project.path,work,evidence,onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (fingerprintCompaction) {
    await probeFingerprintCompaction({page,hostPage:conn.page,project:project.path,work,evidence,onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (reuseStressFixture) {
    await probeMotionStressMemory({page,hostPage:conn.page,work,evidence,onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (process.argv.includes('--motion-stress-only')) {
    await probeMotionStress({page,hostPage:conn.page,project:project.path,work,evidence,onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (process.argv.includes('--motion-playback-only')) {
    await probeMotionDuration({page,hostPage:conn.page,work,evidence,includeVideo:true,onPhase:next=>{phase=next;console.log('phase:',phase);}});
    await probePreviewPlayback({page,hostPage:conn.page,work,evidence,onPhase:next=>{phase=next;console.log('phase:',phase);}});
    await probePlaybackViewState({page,hostPage:conn.page,evidence,onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (process.argv.includes('--motion-duration-only') || process.argv.includes('--motion-seek-only')) {
    await probeMotionDuration({page,hostPage:conn.page,work,evidence,measureSeek:process.argv.includes('--motion-seek-only'),onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (process.argv.includes('--media-drop-only')) {
    await probeMediaDrop({page,hostPage:conn.page,work,evidence,storageFailure:process.argv.includes('--drop-storage-failure'),onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (process.argv.includes('--graph-presets-only')) {
    await probeGraphPresets({page,hostPage:conn.page,work,evidence,onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (process.argv.includes('--video-properties-only')) {
    await probeVideoProperties({page,hostPage:conn.page,project:project.path,work,evidence,onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (process.argv.includes('--timeline-controls-only')) {
    await probeTimelineControls({page,hostPage:conn.page,project:project.path,work,evidence,onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (process.argv.includes('--media-mime-only')) {
    await probeMediaMime({page,hostPage:conn.page,work,evidence,reopenAudio:process.argv.includes('--reopen-mime-audio'),preparePlayback:()=>nativeAudioCdp.send('Emulation.clearDeviceMetricsOverride'),onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (process.argv.includes('--audio-formats-only')) {
    await probeAudioFormats({page,hostPage:conn.page,project:project.path,work,evidence,onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (process.argv.includes('--media-import-only')) {
    await probeMediaImport({page,hostPage:conn.page,work,evidence,onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (process.argv.includes('--transition-render-only') || process.argv.includes('--transition-authoring-only') || process.argv.includes('--transition-image-authoring-only')) {
    await probeTransitionRender({page,project:project.path,work,evidence,authorUi:!process.argv.includes('--transition-render-only'),mediaKind:process.argv.includes('--transition-image-authoring-only')?'image':'video',onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (process.argv.includes('--source-lifetime-only')) {
    await probeVideoSourceLifetime({page,project:project.path,work,evidence,onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (process.argv.includes('--transition-persistence-only')) {
    await probeTransitionPersistence({page,work,evidence,onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (process.argv.includes('--adjustment-only')) {
    await probeColorAdjustment({page,project:project.path,work,evidence,onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (process.argv.includes('--freeze-only')) {
    await probeVideoFreeze({page,project:project.path,work,evidence,onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else {
  phase='core interactions';
  await probeCoreInteractions({page,evidence,work,audioFixture,flags:process.argv,onPhase:next=>{
    phase=next; console.log('phase:',phase);
    writeFileSync(join(work,'evidence.json'),JSON.stringify({...evidence,phase},null,2));
  }});
  phase='installed preview'; console.log('phase:',phase);
  await probeInstalledPreview(conn.page,editor,work,evidence);
  if(process.argv.includes('--export-recovery')) {phase='export recovery'; console.log('phase:',phase); await probeExportRecovery(editor,project.path,evidence);}
  if(process.argv.includes('--mixed-export') || process.argv.includes('--export-recovery')) {phase='mixed export'; console.log('phase:',phase); await probeMixedExport(editor,project.path,evidence);}
  if(process.argv.includes('--jizura-import')) {phase='JIZURA import'; console.log('phase:',phase); await probeJizuraImport(conn.page,editor,evidence);}
  if(process.argv.includes('--responsive')) {phase='responsive'; console.log('phase:',phase); await probeResponsiveMotion(conn.page,editor,work,evidence);}
  if(process.argv.includes('--layout')) {phase='embedded layout'; console.log('phase:',phase); await probeEmbeddedLayout(conn.page,editor,work,evidence);}
  }
  assert.equal(evidence.errors.length,0,'Real-host run must not report uncaught page/driver errors');
  const expectedFailures=evidence.expectedRequestFailures??[];
  for (const expected of expectedFailures) assert.equal(evidence.requests.filter(request=>request.phase===expected.phase && request.status===expected.status && request.url.endsWith(expected.path)).length,1,'Expected exactly one verified refusal');
  const unexpectedRequests=evidence.requests.filter(request=>!(request.status===404 &&
    ['/api/library/graph-editor-presets/user-presets','/api/library/saved-sounds/user-sounds'].some(path=>request.url.endsWith(path))) && !expectedFailures.some(expected=>request.phase===expected.phase && request.status===expected.status && request.url.endsWith(expected.path)));
  assert.equal(unexpectedRequests.length,0,'Unexpected failed host API requests: '+JSON.stringify(unexpectedRequests));
  await conn.page.screenshot({path:join(work,'complete.png')});
  evidence.passed=true;
} catch(error) {
  evidence.passed=false;
  evidence.failure={phase,message:scrub(error.stack??error)};
  await conn.page.screenshot({path:join(work,'failure.png')}).catch(()=>{});
  console.error('FAILED',phase,scrub(error.message));
  process.exitCode=1;
} finally {
  try {
  await nativeAudioCdp?.detach().catch(()=>{});
  if(previousViewport) await conn.page.setViewportSize(previousViewport).catch(()=>{});
  else {
    const cdp=await conn.context.newCDPSession(conn.page);
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await cdp.detach();
  }
  } catch (error) {
    evidence.cleanupFailure = scrub(error.message);
    evidence.passed = false;
    process.exitCode = 1;
  }
  writeFileSync(join(work,'evidence.json'),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify({work,passed:evidence.passed,acceptanceEligible:evidence.acceptanceEligible,checks:evidence.checks.length,phase}));
  await conn.close().catch(error=>console.error('Disconnect failed:',scrub(error.message)));
}
