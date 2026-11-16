"use strict";
// Shared by Echo AI and Echo OS. Only authoritative task records drive outcomes.
const ACTIVE = new Set(["pending","running","verifying","repairing","waiting_approval","paused"]);
const LABELS = {idle:"我在，点我聊聊",pending:"正在排队",running:"正在处理",verifying:"正在核验",repairing:"正在修复",waiting_approval:"需要你确认",paused:"任务已暂停",completed:"任务已完成",failed:"任务未完成",cancelled:"任务已停止",disconnected:"任务连接已中断",offline:"正在重新连接",signed_out:"登录后陪你工作",unknown:"正在同步状态"};
function bounded(value,n=100){return typeof value==="string"?value.replace(/[\u0000-\u001f]/g," ").slice(0,n):"";}
function normalizeTask(item){
 const t=item?.task_run||item||{}, status=bounded(t.status,32);
 const lease=item?.lease_health?.state;
 return {id:bounded(t.task_id,160),threadId:bounded(t.thread_id,160),title:bounded(t.title),
 status: ["running","verifying","repairing"].includes(status)&&["expired","missing_lease"].includes(lease)?"disconnected":status,
 phase:["thinking","working"].includes(t.phase)?t.phase:undefined,updated:Date.parse(t.updated_at||t.completed_at||t.created_at)||0,outcomeAt:Date.parse(t.completed_at)||0};
}
function mood(status){if(["running","verifying","repairing"].includes(status))return "working";if(status==="pending")return "thinking";if(["paused","waiting_approval"].includes(status))return "waiting";if(status==="completed")return "success";if(status==="failed")return "error";if(["offline","disconnected","unknown"].includes(status))return "offline";return "idle";}
function createProjector(now=Date.now()){
 let scope="",seen=new Map(),notice=null,started=now;
 return {reset(){scope="";seen.clear();notice=null;started=Date.now();},
 update(snapshot,at=Date.now()){
  if(!snapshot?.connected){notice=null;return {status:snapshot?.signedOut?"signed_out":"offline",mood:"offline",label:LABELS[snapshot?.signedOut?"signed_out":"offline"],title:"",threadId:"",activeCount:0};}
  if(scope!==snapshot.scope){scope=snapshot.scope;seen.clear();notice=null;started=at;}
  const durable=(snapshot.items||[]).slice(0,500), covered=new Set(durable.flatMap(i=>{const t=i.task_run||i;return [t.task_id,t.turn_id]}));
  const streams=(snapshot.streams||[]).slice(0,100).filter(t=>!covered.has(t.task_id));
  const rows=[...durable.map(item=>{const t=item.task_run||item;const stream=(snapshot.streams||[]).find(s=>s.task_id===(t.turn_id||t.task_id));return {...t,phase:stream?.status==="running"?stream.phase:t.phase,lease_health:item.lease_health};}),...streams].map(normalizeTask).filter(t=>t.id).sort((a,b)=>b.updated-a.updated);
  const live=rows.filter(t=>ACTIVE.has(t.status));
  const changed=rows.find(t=>!ACTIVE.has(t.status)&&LABELS[t.status]&&((seen.has(t.id)&&ACTIVE.has(seen.get(t.id)))||t.updated>started));
  if(changed&&(!notice||notice.task.id!==changed.id||notice.task.status!==changed.status)){notice={task:changed,until:at+9000};started=Math.max(started,changed.updated);}
  const selected=live.find(t=>t.status==="waiting_approval")||live.find(t=>t.status!=="paused")||live[0]||(notice&&at<notice.until?notice.task:null);
  seen=new Map(rows.map(t=>[t.id,t.status]));
  const status=selected?.status||"idle";
  const phase=selected?.phase;
  return {status,phase,mood:status==="running"&&phase==="thinking"?"thinking":mood(status),label:status==="running"&&phase==="thinking"?"正在思考":LABELS[status]||LABELS.unknown,title:selected?.title||"",threadId:selected?.threadId||"",taskId:selected?.id||"",eventKey:selected?[selected.id,selected.status,selected.outcomeAt].join("|"):"",activeCount:live.length};
 }};
}
function clampBounds(bounds,area){return {x:Math.round(Math.max(area.x,Math.min(bounds.x,area.x+Math.max(0,area.width-bounds.width)))),y:Math.round(Math.max(area.y,Math.min(bounds.y,area.y+Math.max(0,area.height-bounds.height)))),width:bounds.width,height:bounds.height};}
function safeThread(value){return typeof value==="string"&&/^[a-zA-Z0-9_-]{1,160}$/.test(value)?value:"";}
module.exports={createProjector,clampBounds,normalizeTask,safeThread};

