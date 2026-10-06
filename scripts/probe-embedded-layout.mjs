import assert from "node:assert/strict";
import { join } from "node:path";
import { expect } from "./rocut-probe-source.mjs";

export async function probeEmbeddedLayout(parent, frame, work, evidence) {
 const originalViewport = parent.viewportSize();
 const nativeViewport = await parent.evaluate(()=>({width:innerWidth,height:innerHeight}));
 const chatToggle=parent.getByTestId("chat-button-panel-toggle");
 const originallyExpanded=(await chatToggle.getAttribute("aria-label"))==="向右收起对话";
 const originallyDark=await parent.evaluate(()=>document.documentElement.classList.contains("dark"));
 const originalThemeMode=await parent.evaluate(async()=> (await window.native.theme.getState()).mode);
 const prefs=()=>frame.evaluate(()=>{const raw=localStorage.getItem("panel-sizes");if(!raw)return null;const {panels}=JSON.parse(raw).state;return [panels.tools,panels.preview,panels.properties];});
 await expect.poll(prefs).not.toBeNull();
 const storedWide=await prefs();
 const main=frame.getByTestId("editor-main-panels");
 await frame.locator('.panel').filter({has:frame.locator('[aria-label="Media"]')}).locator('[aria-label="Motion text"]').click();
 const input=frame.locator("#motion-text-source");
 const originalText=await input.inputValue();
 const formatSelector=frame.locator("#motion-text-source-format");
 const originalFormat=await formatSelector.innerText();
 const draft="布局检查草稿：改变大小时不可丢失";
 await input.fill(draft);
 const assertPanels=async(label)=>{
  await expect(input).toHaveValue(draft);
  const bounds=await main.evaluate(e=>({width:e.clientWidth,panels:[...e.querySelectorAll('[data-panel-id]')].map(p=>p.getBoundingClientRect().width)}));
  assert.equal(bounds.panels.length,3);
  assert(bounds.panels.every(w=>w>0),"All three editor panels must remain visible");
  if(bounds.width>=640&&bounds.width<992) {
   assert(bounds.panels[0]>=210&&bounds.panels[2]>=210,"Compact sidebars need usable control width");
  }
  const toolbar=frame.getByTestId("preview-toolbar");
  const overflow=await toolbar.evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth}));
  assert(overflow.scroll<=overflow.width+1,"Preview controls must wrap instead of overflow");
  for(const locator of [frame.getByRole("button",{name:"Play preview",exact:true}),frame.getByRole("combobox",{name:"Preview zoom",exact:true}),frame.getByRole("button",{name:"Toggle preview fullscreen",exact:true})]) await expect(locator).toBeInViewport();
  assert.deepEqual(await prefs(),storedWide,"Automatic host resizing must preserve stored wide-panel proportions");
  evidence.checks.push({name:"embedded layout "+label,...bounds,pass:true});
 };
 const setTheme=async(dark)=>{
  const current=await parent.evaluate(()=>document.documentElement.classList.contains("dark"));
  if(current!==dark) await parent.getByRole("button",{name:current?"深色":"浅色",exact:true}).click();
  await expect.poll(()=>frame.evaluate(()=>document.documentElement.classList.contains("dark"))).toBe(dark);
 };
 try {
  await expect(main).toHaveAttribute("data-layout","compact");
  await assertPanels("native split workspace");
  const handle=frame.getByRole("separator",{name:"Resize assets and preview",exact:true});
  const before=Number(await handle.getAttribute("aria-valuenow"));
  await handle.focus();await parent.keyboard.press("ArrowRight");
  await expect.poll(async()=>Number(await handle.getAttribute("aria-valuenow"))).toBeGreaterThan(before);
  await parent.keyboard.press("ArrowLeft");
  await expect.poll(async()=>Number(await handle.getAttribute("aria-valuenow"))).toBeCloseTo(before,0);
  await expect(input).toHaveValue(draft);
  evidence.checks.push({name:"keyboard pane resize preserves unsaved lyrics",pass:true});
  if(originallyExpanded) await chatToggle.click();
  await parent.setViewportSize({width:1280,height:830});
  await expect(main).toHaveAttribute("data-layout","wide");
  await assertPanels("wide workspace");
  for(const width of [900,760]) {
   await parent.setViewportSize({width,height:640});
   await expect(main).toHaveAttribute("data-layout","compact");
   await assertPanels(width+"px host");
   const format=frame.locator("#motion-text-source-format");
   await format.scrollIntoViewIfNeeded();
   for(const [key,label] of [["End","LRC timestamps"],["Home","Plain lyrics"]]) {
    await format.focus();await parent.keyboard.press("Space");
    await expect(frame.getByRole("listbox")).toBeVisible();
    await expect.poll(()=>frame.evaluate(()=>document.activeElement?.getAttribute("role"))).toBe("option");
    await parent.keyboard.press(key);
    await expect(frame.getByRole("option",{name:label,exact:true})).toBeFocused();
    await parent.keyboard.press("Enter");
    await expect(format).toHaveText(label);
   }
   for(const dark of [true,false]) {
    await setTheme(dark);
    const contrasts=await main.evaluate(e=>{
     const panel=e.querySelector('.panel');const style=getComputedStyle(panel);
     const ctx=document.createElement('canvas').getContext('2d');
     const lum=value=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);const rgb=[...ctx.getImageData(0,0,1,1).data].slice(0,3).map(c=>{const s=c/255;return s<=0.04045?s/12.92:((s+0.055)/1.055)**2.4;});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
     const bg=lum(style.getPropertyValue('--background'));
     return Object.fromEntries(['--foreground','--muted-foreground','--border'].map(key=>{const fg=lum(style.getPropertyValue(key));return[key,(Math.max(bg,fg)+.05)/(Math.min(bg,fg)+.05)];}));
    });
    assert(contrasts['--foreground']>=4.5&&contrasts['--muted-foreground']>=4.5,"Text tokens must meet AA contrast in both themes");
    assert(contrasts['--border']>=3,"Control border must remain distinguishable");
    await parent.screenshot({path:join(work,"layout-"+width+"-"+(dark?"dark":"light")+".png")});
    evidence.checks.push({name:"embedded theme contrast and LRC keyboard",width,dark,contrasts,pass:true});
   }
  }
 } finally {
  try {
   await parent.keyboard.press("Escape");
   await input.fill(originalText);
   await formatSelector.scrollIntoViewIfNeeded();await formatSelector.press("Space");
   const originalOption=frame.getByRole("option",{name:originalFormat,exact:true});
   await originalOption.click();
  } finally {
   await parent.setViewportSize(originalViewport??nativeViewport);
   const expanded=(await chatToggle.getAttribute("aria-label"))==="向右收起对话";
   if(expanded!==originallyExpanded) await chatToggle.click();
   await setTheme(originallyDark);
   // Restore a possible system-following preference, not just its resolved color.
   await parent.evaluate(mode=>window.native.theme.setMode(mode),originalThemeMode);
  }
 }
}
