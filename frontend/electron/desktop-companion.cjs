"use strict";
const fs=require("fs"),path=require("path"),{pathToFileURL}=require("url");
const {createProjector,clampBounds}=require("./companion-state.cjs");
const {readTasks,openConversation}=require("./companion-source.cjs");
function createDesktopCompanion({app,BrowserWindow,ipcMain,screen,Menu,getMainWindow,devURL,brand="Echo"}){
 const stateFile=path.join(app.getPath("userData"),"desktop-companion.json"),url=pathToFileURL(path.join(__dirname,"companion.html")).href;
 let win=null,timer=null,dragTimer=null,hitTimer=null,drag=null,refreshing=false,stopped=false,quiet=false,lastSnapshot=0,mouseIgnored=null,nativeShape=false;
 let state={status:"offline",mood:"offline",label:"正在连接 "+brand,title:"",activeCount:0};
 const projector=createProjector();
 let saved={};try{saved=JSON.parse(fs.readFileSync(stateFile,"utf8"))}catch{}
 function persist(){try{fs.mkdirSync(path.dirname(stateFile),{recursive:true});fs.writeFileSync(stateFile,JSON.stringify(saved))}catch{}}
 function broadcast(){if(win&&!win.isDestroyed())win.webContents.send("companion:state",state);}
 function trusted(e){return win&&!win.isDestroyed()&&e.sender===win.webContents&&e.senderFrame===win.webContents.mainFrame&&e.senderFrame.url===url;}
 const channels=[];
 function handle(channel,fn){channels.push(channel);ipcMain.handle(channel,(e,...args)=>{if(!trusted(e))throw Error("Untrusted companion sender");return fn(...args)})}
 function moveDrag(cursor){if(!drag||!win||win.isDestroyed()||!cursor||!Number.isFinite(cursor.x)||!Number.isFinite(cursor.y)||Math.abs(cursor.x)>100000||Math.abs(cursor.y)>100000)return;const dx=cursor.x-drag.cursor.x,dy=cursor.y-drag.cursor.y;if(Math.hypot(dx,dy)>=5)drag.moved=true;if(drag.moved)win.setBounds(clampBounds({...drag.bounds,x:drag.bounds.x+dx,y:drag.bounds.y+dy},screen.getDisplayNearestPoint(cursor).workArea));}
 function stopDrag(point){moveDrag(point);const moved=drag?.moved||false;clearInterval(dragTimer);dragTimer=null;drag=null;if(win&&!win.isDestroyed()){const b=win.getBounds();saved.x=b.x;saved.y=b.y;persist();}if(moved&&process.platform==="linux"){const main=getMainWindow();if(main&&!main.isDestroyed?.())main.focus?.();}return {moved};}
 function position(){const area=screen.getPrimaryDisplay().workArea,b={x:Number.isFinite(saved.x)?saved.x:area.x+area.width-230,y:Number.isFinite(saved.y)?saved.y:area.y+area.height-(brand==="Echo OS"?420:245),width:210,height:220};return clampBounds(b,screen.getDisplayMatching(b).workArea);}
 function hide(){saved.visible=false;persist();win?.hide();stopDrag();}
 async function refresh(){
  if(stopped||refreshing||!win||win.isDestroyed())return;refreshing=true;
  try{const snapshot=await readTasks(getMainWindow()?.webContents,devURL);if(stopped)return;lastSnapshot=Date.now();state=projector.update(snapshot);quiet=Boolean(snapshot.quiet);
   if(quiet)win.hide();else if(saved.visible!==false){if(!win.isVisible())win.showInactive();win.setAlwaysOnTop(true,"screen-saver");win.moveTop();}
  }catch{state=projector.update({connected:false});}finally{refreshing=false;if(!stopped)broadcast();}
 }
 function start(){
  if(process.env.ECHO_PET_DISABLED==="1")return {ok:false,reason:"disabled"};
  saved.visible=true;persist();stopped=false;
  if(win&&!win.isDestroyed()){if(!quiet)win.showInactive();return {ok:true};}
  win=new BrowserWindow({...position(),parent:process.platform==="linux"?getMainWindow():undefined,title:brand+" 回芽玩伴",transparent:true,backgroundColor:"#00000000",frame:false,resizable:false,hasShadow:false,skipTaskbar:true,alwaysOnTop:true,show:false,fullscreenable:false,webPreferences:{preload:path.join(__dirname,"companion-preload.cjs"),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  win.setAlwaysOnTop(true,"screen-saver");
  // Native input regions avoid click-through races on Windows: the sprite
  // remains immediately draggable even before a forwarded mousemove arrives.
  nativeShape=process.platform==="win32"&&typeof win.setShape==="function";
  if(nativeShape){win.setShape([{x:8,y:5,width:194,height:31},{x:23,y:35,width:164,height:164},{x:8,y:199,width:194,height:14}]);win.setIgnoreMouseEvents(false);}
  win.webContents.setWindowOpenHandler(()=>({action:"deny"}));
  win.webContents.on("will-navigate",(event,target)=>{if(target!==url)event.preventDefault()});
  win.once("ready-to-show",()=>{if(saved.visible!==false&&!quiet){win.showInactive();win.moveTop();}broadcast();void refresh()});
  win.on("closed",()=>{win=null;clearInterval(timer);clearInterval(hitTimer);timer=null;stopDrag()});
  win.loadURL(url);
  // Native cursor sampling also works when an elevated app prevents Chromium
  // mousemove forwarding. No full-screen input hook or keyboard interception.
  if(process.platform!=="linux"&&!nativeShape)hitTimer=setInterval(()=>{
    if(!win||win.isDestroyed()||!win.isVisible())return;
    const c=screen.getCursorScreenPoint(),b=win.getBounds(),x=c.x-b.x,y=c.y-b.y;
    const onBody=((x-105)/76)**2+((y-123)/89)**2<=1;
    const onBubble=x>=8&&x<=202&&y>=5&&y<=36;
    const ignore=!(drag||onBody||onBubble);
    if(ignore!==mouseIgnored){mouseIgnored=ignore;win.setIgnoreMouseEvents(ignore,{forward:true});if(!ignore)win.moveTop();}
  },50);
  hitTimer?.unref?.();
  timer=setInterval(()=>{if(lastSnapshot&&Date.now()-lastSnapshot>12000){state=projector.update({connected:false});broadcast()}void refresh()},2000);timer.unref?.();
  return {ok:true};
 }
 handle("companion:ready",()=>state);
 handle("companion:chat",()=>openConversation(getMainWindow(),devURL,state.threadId));
 handle("companion:drag-start",point=>{
  stopDrag();const bounds=win.getBounds(),valid=point&&Number.isFinite(point.x)&&Number.isFinite(point.y)&&point.x>=bounds.x&&point.x<=bounds.x+bounds.width&&point.y>=bounds.y&&point.y<=bounds.y+bounds.height;
  drag={cursor:valid?{x:point.x,y:point.y}:screen.getCursorScreenPoint(),bounds,moved:false,started:Date.now()};
  dragTimer=setInterval(()=>{if(!drag||!win||win.isDestroyed()||Date.now()-drag.started>30000)return stopDrag();},1000);dragTimer.unref?.();return {ok:true};
 });
 handle("companion:drag-move",point=>{moveDrag(point);return {ok:true}});
 handle("companion:drag-end",stopDrag);
 handle("companion:menu",()=>{Menu.buildFromTemplate([{label:"和 "+brand+" 聊聊",click:()=>void openConversation(getMainWindow(),devURL,"")},{label:"收起玩伴（重开应用恢复）",click:hide}]).popup({window:win});return {ok:true}});
 const hitListener=(e,hit)=>{if(trusted(e)&&hit&&process.platform!=="linux"&&!nativeShape){mouseIgnored=false;win.setIgnoreMouseEvents(false,{forward:true});}};
 ipcMain.on("companion:hit",hitListener);
 const displayChanged=()=>{if(win&&!win.isDestroyed())win.setBounds(clampBounds(win.getBounds(),screen.getDisplayMatching(win.getBounds()).workArea))};
 screen.on("display-removed",displayChanged);screen.on("display-metrics-changed",displayChanged);
 function shutdown(){stopped=true;clearInterval(timer);clearInterval(hitTimer);timer=null;stopDrag();if(win&&!win.isDestroyed())win.destroy();for(const c of channels)ipcMain.removeHandler(c);ipcMain.removeListener("companion:hit",hitListener);screen.removeListener("display-removed",displayChanged);screen.removeListener("display-metrics-changed",displayChanged);}
 return {start,stop:hide,isRunning:()=>Boolean(win&&!win.isDestroyed()&&win.isVisible()),shutdown,refresh,getState:()=>({...state}),getWindow:()=>win};
}
module.exports={createDesktopCompanion};

