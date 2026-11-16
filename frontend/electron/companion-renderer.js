"use strict";
const root=document.getElementById("companion"),button=document.getElementById("droplet"),status=document.getElementById("status"),detail=document.getElementById("detail");
const animation=createCompanionPlayer(root,document.getElementById("motion"),document.getElementById("fallback"));
let pressed=false,start=null,opening=false,dragged=false;
function render(state){
 root.dataset.mood=state.mood||"offline";
 root.dataset.attention=String(["waiting","success","error"].includes(state.mood));
 root.dataset.status=state.status||"offline";
 status.textContent=state.label||"正在连接 Echo";
 detail.textContent=state.title||"";
 document.getElementById("count").textContent=state.activeCount>1?"· "+state.activeCount:"";
 button.setAttribute("aria-label","和 Echo 聊聊，"+status.textContent+"；可拖动移动");
 animation.state(state);
}
async function chat(){if(opening)return;opening=true;animation.greet();try{await window.companion.openChat()}finally{opening=false}}
button.addEventListener("pointerdown",event=>{if(event.button!==0)return;pressed=true;dragged=false;start={x:event.screenX,y:event.screenY};button.setPointerCapture(event.pointerId);void window.companion.beginDrag(start);});
button.addEventListener("pointermove",event=>{if(!pressed)return;if(!dragged&&Math.hypot(event.screenX-start.x,event.screenY-start.y)>=5){dragged=true;root.dataset.dragging="true";animation.drag();}void window.companion.moveDrag({x:event.screenX,y:event.screenY})});
button.addEventListener("pointerup",async event=>{
 if(!pressed)return;pressed=false;root.dataset.dragging="false";
 const travelled=start?Math.hypot(event.screenX-start.x,event.screenY-start.y):0;start=null;
 const result=await window.companion.endDrag({x:event.screenX,y:event.screenY});
 if(dragged||result?.moved){animation.drop();dragged=false;}
 if(!result?.moved&&travelled<5)await chat();
});
async function cancel(){if(!pressed)return;pressed=false;start=null;root.dataset.dragging="false";if(dragged)animation.drop();dragged=false;await window.companion.endDrag();}
button.addEventListener("pointercancel",cancel);button.addEventListener("lostpointercapture",cancel);window.addEventListener("blur",cancel);
button.addEventListener("click",event=>{if(event.detail===0)void chat()});
document.addEventListener("contextmenu",event=>{event.preventDefault();void window.companion.menu()});
let hit=null;function updateHit(event){const next=pressed||Boolean(event.target.closest?.("[data-hit]"));if(next!==hit){hit=next;window.companion.hit(next)}}
document.addEventListener("pointermove",updateHit);
// Electron forwards mousemove (not pointermove) while click-through is active.
document.addEventListener("mousemove",updateHit);
document.addEventListener("pointerleave",()=>{if(!pressed){hit=false;window.companion.hit(false)}});
window.companion.onState(render);void window.companion.ready().then(render);
window.addEventListener("pagehide",()=>animation.dispose(),{once:true});

