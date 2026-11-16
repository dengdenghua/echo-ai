const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {createAutomationFeedback,validateFeedback,nativeFeedbackDirectory,nativeScreenLocked}=require('./automation-feedback.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const packet=(session,extra={})=>({session,id:'a'.repeat(32),kind:'click',phase:'done',at:Date.now(),x:400,y:200,...extra});
test('rejects stale, foreign and malformed signals; strips arbitrary content',()=>{
  for(const extra of [{session:'other'},{at:Date.now()-2000},{at:Date.now()+2000},{kind:'execute'},{phase:'bad'},{id:'bad'}])
    assert.equal(validateFeedback(packet('mine',extra),'mine'),null);
  const safe=validateFeedback(packet('mine',{text:'private',keys:['private']}),'mine');
  assert.equal(safe.text,undefined);assert.equal(safe.keys,undefined);assert.equal(safe.session,undefined);
});
function setup(t,options={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'echo-feedback-test-'));
 const windows=[];
 class Window {
  constructor(options){this.options=options;this.visible=false;this.destroyed=false;this.webContents=new EventEmitter();this.webContents.setWindowOpenHandler=fn=>this.open=fn;this.webContents.send=(_channel,event)=>this.last=event;windows.push(this);}
  isDestroyed(){return this.destroyed} destroy(){this.destroyed=true} hide(){this.visible=false}
  setIgnoreMouseEvents(v){this.ignores=v}setFocusable(v){this.focusable=v}setAlwaysOnTop(){}setVisibleOnAllWorkspaces(){}
  loadFile(){return Promise.resolve().then(()=>this.webContents.emit('did-finish-load'))}
  setBounds(v){this.bounds=v}isVisible(){return this.visible}showInactive(){this.visible=true;this.shownInactive=true}
 }
 const controller=createAutomationFeedback({app:{},BrowserWindow:Window,directory,home:directory,platform:'win32',screen:{screenToDipPoint:p=>({x:p.x/2,y:p.y/2}),getCursorScreenPoint:()=>({x:510,y:300}),getDisplayNearestPoint:()=>({bounds:{x:0,y:0,width:600,height:400}})},...options});
 t.after(()=>{controller.stop();fs.rmSync(directory,{recursive:true,force:true})});
 return {controller,windows,directory,write:extra=>fs.writeFileSync(controller.file,JSON.stringify(packet(controller.session,extra)))};
}
test('transparent decoration never takes focus; DPI, side, expiry and close',async t=>{
 const {controller,windows,write}=setup(t);controller.start();write();await wait(180);
 const w=windows[0];assert.ok(w);assert.equal(w.options.focusable,false);assert.equal(w.options.transparent,true);
 assert.equal(w.ignores,true);assert.equal(w.focusable,false);assert.equal(w.shownInactive,true);
 assert.deepEqual(w.bounds,{x:40,y:44,width:320,height:112});assert.equal(w.open().action,'deny');
 write({kind:'move',phase:'active'});await wait(130);
 assert.equal(w.bounds.x,350);assert.equal(w.last.side,'left');
 await wait(1750);assert.equal(w.visible,false);controller.stop();assert.equal(w.destroyed,true);assert.equal(fs.existsSync(controller.file),false);
});
test('in-flight poll cannot recreate window after stop',async t=>{
 const {controller,windows,write}=setup(t);write();
 const original=fs.promises.readFile;let resolveRead;
 fs.promises.readFile=async(...args)=>{const data=await original(...args);await new Promise(r=>resolveRead=r);return data};
 t.after(()=>{fs.promises.readFile=original});controller.start();
 for(let i=0;i<30&&!resolveRead;i++)await wait(10);
 assert.ok(resolveRead);controller.stop();resolveRead();await wait(50);assert.equal(windows.length,0);
});
test('renderer or display failure only disposes the decoration',async t=>{
 const {controller,windows,write}=setup(t);controller.start();write({phase:'active'});await wait(180);
 const first=windows[0];first.webContents.emit('render-process-gone');assert.equal(first.destroyed,true);
 await wait(120);const second=windows.at(-1);assert.notEqual(second,first);
 second.setBounds=()=>{throw Error('display unavailable')};await wait(60);
 assert.equal(second.destroyed,true);controller.stop();
});
test('native owner lease refreshes, disappears on stop and returns on restart',{skip:process.platform!=='linux'},async t=>{
 const {controller}=setup(t,{nativeAgent:true,platform:'linux'});
 const owner=path.join(path.dirname(controller.file),'owner-'+controller.session+'.json');
 assert.equal(fs.existsSync(owner),false);controller.start();
 const first=JSON.parse(fs.readFileSync(owner));
 assert.deepEqual(Object.keys(first).sort(),['at','display','session']);
 assert.equal(fs.statSync(owner).mode&0o777,0o600);
 await wait(1150);assert.ok(JSON.parse(fs.readFileSync(owner)).at>first.at);
 controller.stop();assert.equal(fs.existsSync(owner),false);
 await wait(1100);assert.equal(fs.existsSync(owner),false);
 controller.start();assert.equal(JSON.parse(fs.readFileSync(owner)).session,controller.session);
});

function lockMarker(directory,pid=process.pid,extra={}) {
 const raw=fs.readFileSync(`/proc/${pid}/stat`,'utf8');
 const marker={pid,start:raw.slice(raw.lastIndexOf(')')+2).split(' ')[19],display:process.env.DISPLAY||'',...extra};
 const file=path.join(directory,`lock-${pid}.json`);
 fs.writeFileSync(file,JSON.stringify(marker),{mode:0o600});
 return file;
}
test('Linux lock process identity, display, permissions and dead marker cleanup',{skip:process.platform!=='linux'},async t=>{
 const {controller}=setup(t,{nativeAgent:true,platform:'linux'});
 const dir=path.dirname(controller.file),display=process.env.DISPLAY||'';
 const file=lockMarker(dir);
 assert.equal(nativeScreenLocked(dir,display),true);
 assert.equal(nativeScreenLocked(dir,display+'other'),false);
 fs.chmodSync(file,0o644);assert.equal(nativeScreenLocked(dir,display),false);
 fs.chmodSync(file,0o600);lockMarker(dir,process.pid,{start:'0'});
 assert.equal(nativeScreenLocked(dir,display),false);assert.equal(fs.existsSync(file),false);
 const {spawn}=require('node:child_process');
 const child=spawn('/bin/sleep',['10']);
 t.after(()=>child.kill());lockMarker(dir,child.pid);
 assert.equal(nativeScreenLocked(dir,display),true);
 const ended=new Promise(r=>child.once('exit',r));child.kill();await ended;
 assert.equal(nativeScreenLocked(dir,display),false);
 assert.equal(fs.existsSync(path.join(dir,`lock-${child.pid}.json`)),false);
});
test('Linux lock hides overlay, withdraws discovery and resumes without replaying pre-unlock events',{skip:process.platform!=='linux'},async t=>{
 const {controller,windows,write}=setup(t,{nativeAgent:true,platform:'linux'});
 const dir=path.dirname(controller.file),owner=path.join(dir,'owner-'+controller.session+'.json');
 controller.start();write({phase:'active'});await wait(180);
 assert.equal(windows[0].visible,true);
 const marker=lockMarker(dir);await wait(120);
 assert.equal(windows[0].destroyed,true);assert.equal(fs.existsSync(owner),false);
 write({kind:'type',phase:'active'});await wait(1100);
 assert.equal(windows.length,1);assert.equal(fs.existsSync(owner),false);
 fs.unlinkSync(marker);await wait(180);
 assert.equal(fs.existsSync(owner),true);assert.equal(windows.length,1);
 write({kind:'key',phase:'active',id:'b'.repeat(32)});await wait(180);
 assert.equal(windows.at(-1).visible,true);assert.equal(windows.at(-1).last.kind,'key');
 lockMarker(dir);controller.stop();controller.start();await wait(160);
 assert.equal(fs.existsSync(owner),false);assert.equal(windows.length,2);
});
test('native discovery rejects linked or writable parent directories',{skip:process.platform!=='linux'},t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'echo-native-owner-'));
 t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 fs.mkdirSync(path.join(home,'outside'));
 fs.symlinkSync(path.join(home,'outside'),path.join(home,'.cache'));
 assert.throws(()=>nativeFeedbackDirectory(home),/private user-owned/);
 assert.equal(fs.existsSync(path.join(home,'outside','echo-os')),false);
 fs.unlinkSync(path.join(home,'.cache'));fs.mkdirSync(path.join(home,'.cache'),{mode:0o777});
 fs.chmodSync(path.join(home,'.cache'),0o777);
 assert.throws(()=>nativeFeedbackDirectory(home),/private user-owned/);
});
test('independent Python worker reaches the shell without inherited feedback variables',{skip:process.platform!=='linux'},async t=>{
 const {spawnSync}=require('node:child_process');
 const {controller,windows,directory}=setup(t,{nativeAgent:true,platform:'linux'});controller.start();
 const env={...process.env,HOME:directory,ECHO_AUTOMATION_FEEDBACK_DISCOVERY:'1'};
 delete env.ECHO_AUTOMATION_FEEDBACK_FILE;delete env.ECHO_AUTOMATION_FEEDBACK_SESSION;
 const modulePath=process.env.ECHO_FEEDBACK_PYTHON_MODULE||path.resolve(__dirname,'../../runtime/execution/suckers/computer_feedback.py');
 const code="import importlib.util,sys; s=importlib.util.spec_from_file_location('feedback',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); assert m._feedback_endpoint() is not None; assert m.desktop_feedback('type')(lambda: 'passed')()=='passed'";
 const child=spawnSync(process.env.ECHO_TEST_PYTHON||'python3',['-c',code,modulePath],{env,encoding:'utf8',timeout:10000});
 assert.equal(child.status,0,child.stderr);
 await wait(180);assert.ok(windows[0]?.visible);assert.equal(windows[0].last.kind,'type');assert.equal(windows[0].last.phase,'done');
});
test('Linux uses DIP cursor coordinates without calling the Windows-only converter',async t=>{
 let cursor={x:155,y:205};
 const {controller,windows,write}=setup(t,{platform:'linux',screen:{
  screenToDipPoint:()=>{throw Error('Windows-only API')},
  getCursorScreenPoint:()=>cursor,
  getDisplayNearestPoint:()=>({bounds:{x:0,y:0,width:600,height:400}})
 }});
 controller.start();write({x:310,y:410,phase:'active'});await wait(180);
 const w=windows[0];assert.equal(w.visible,true);assert.equal(w.destroyed,false);
 assert.deepEqual(w.bounds,{x:-5,y:149,width:320,height:112});
 write({phase:'done'});await wait(120);cursor={x:450,y:350};await wait(90);
 assert.deepEqual(w.bounds,{x:-5,y:149,width:320,height:112});
});
