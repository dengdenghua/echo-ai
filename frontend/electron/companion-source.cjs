"use strict";
const {safeThread}=require("./companion-state.cjs");
function trustedMainURL(raw,devURL){
 try{const u=new URL(raw);if(u.protocol==="echo-app:")return u.hostname==="app"&&["/","/index.html"].includes(u.pathname);
 const d=new URL(devURL);return ["http:","https:"].includes(u.protocol)&&u.origin===d.origin&&u.pathname===d.pathname;}catch{return false;}
}
// Execute a fixed read in the authenticated app frame. Tokens stay inside that
// frame; the companion renderer receives only bounded status/title coordinates.
async function readTasks(contents,devURL){
 if(!contents||contents.isDestroyed()||!trustedMainURL(contents.getURL(),devURL))return {connected:false};
 return contents.executeJavaScript(`(async()=>{
  if(location.hash.startsWith("#/login")||location.hash.startsWith("#/register"))return {connected:false,signedOut:true};
  const token=sessionStorage.getItem("echo_auth_token");
  const headers=token&&token!=="__account_free__"?{Authorization:"Bearer "+token}:{};
  const response=await fetch("/api/task-runs?limit=100",{headers,credentials:"include",cache:"no-store",signal:AbortSignal.timeout(5000)});
  if(!response.ok)return {connected:false,signedOut:response.status===401||response.status===403};
  const body=await response.json();
  if(!Array.isArray(body.items)&&!Array.isArray(body.tasks))throw Error("Invalid task snapshot");
  let user={};try{user=JSON.parse(sessionStorage.getItem("echo_user")||"{}")}catch{}
  return {connected:true,scope:String(user?.actor_id||user?.user_id||body.filters?.owner_id||"local"),
   quiet:Boolean(document.fullscreenElement||document.querySelector(".tv-player")),
   streams:typeof window.echoCompanionActivity==="function"?window.echoCompanionActivity():[],
   items:(body.items||body.tasks).map(item=>{const t=item.task_run||item;return {task_run:{task_id:t.task_id,thread_id:t.thread_id,status:t.status,title:String(t.title||"").slice(0,100),updated_at:t.updated_at,completed_at:t.completed_at,created_at:t.created_at,turn_id:t.metadata?.turn_id},lease_health:{state:item.lease_health?.state}}})};
 })()`);
}
async function openConversation(win,devURL,threadId){
 if(!win||win.isDestroyed()||!trustedMainURL(win.webContents.getURL(),devURL))return false;
 if(win.isMinimized())win.restore();win.show();win.focus();
 const id=safeThread(threadId);
 return win.webContents.executeJavaScript(`(async()=>{
  const id=${JSON.stringify(id)};
  if(location.hash.startsWith("#/tv")){
   // The companion can become interactive before the TV shell has mounted its
   // listener. Wait for an acknowledged input instead of dropping that first click.
   const input=()=>document.querySelector('textarea[aria-label="给 Agent 的任务"], textarea[aria-label="继续对话"]');
   const current=new URLSearchParams(location.hash.split("?")[1]||"").get("conversation")||"";
   if(input()&&(!id||current===id)){input().focus();return true;}
   const deadline=Date.now()+20000;
   while(location.hash.startsWith("#/tv")&&Date.now()<deadline){
    if(document.querySelector('[data-testid="tv-shell"]'))
     window.dispatchEvent(new CustomEvent("echo:companion-chat",{detail:{threadId:id}}));
    await new Promise(resolve=>setTimeout(resolve,150));
    if(input()){input().focus();return true;}
   }
   return false;
  }else{const target="#/workspace/realtime/"+(id||"new");
   if(location.hash!==target)location.hash=target;
   else document.querySelector('[contenteditable="true"],textarea')?.focus();
  }
  return true;
 })()`,true);
}
module.exports={readTasks,openConversation,trustedMainURL};

