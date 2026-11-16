"use strict";
// Image-generated poses; retain at most two decoded atlases, pause when hidden.
function createCompanionPlayer(root,canvas,fallback,existingMachine) {
  const machine=existingMachine||window.EchoCompanionAnimation.createMachine(), manifest=window.EchoCompanionAssets;
  const ctx=canvas.getContext("2d",{alpha:true}), cache=new Map(), failed=new Set();
  const motion=window.matchMedia("(prefers-reduced-motion: reduce)");
  let timer=null,disposed=false,last="";
  function load(clip) {
    if(!manifest?.clips[clip]||failed.has(clip))return null;
    if(cache.has(clip)){const value=cache.get(clip);cache.delete(clip);cache.set(clip,value);return value.complete&&value.naturalWidth?value:null;}
    const img=new Image();cache.set(clip,img);
    while(cache.size>2){const [key,old]=cache.entries().next().value;cache.delete(key);old.onload=old.onerror=null;old.src="";}
    img.onload=()=>{if(disposed)return;last="";wake();};
    img.onerror=()=>{failed.add(clip);cache.delete(clip);root.dataset.assetError=clip;wake();};
    img.src="companion-assets/"+manifest.clips[clip].file;
    return null;
  }
  function tick() {
    clearTimeout(timer);timer=null;if(disposed||document.hidden)return;
    const state=machine.frame(performance.now()),meta=manifest?.clips[state.clip];
    root.dataset.animation=state.clip;root.dataset.frame=String(state.index);root.dataset.motion=state.still?"still":"animated";
    const img=load(state.clip),key=state.clip+":"+state.index;
    if(img&&meta&&last!==key){
      ctx.clearRect(0,0,canvas.width,canvas.height);
      const frame=meta.sequence?.[state.index]??state.index;
      ctx.drawImage(img,(frame%meta.columns)*meta.size,Math.floor(frame/meta.columns)*meta.size,meta.size,meta.size,0,0,canvas.width,canvas.height);
      canvas.hidden=false;fallback.hidden=true;root.dataset.renderedAnimation=state.clip;root.dataset.renderedFrame=String(state.index);delete root.dataset.assetError;last=key;
    } else if(failed.has(state.clip)||!meta){canvas.hidden=true;fallback.hidden=false;root.dataset.renderedAnimation="fallback";}
    if(!state.still&&meta&&!failed.has(state.clip))timer=setTimeout(tick,1000/24);
  }
  function wake(){if(!disposed)tick();}
  function reduced(){machine.reduce(motion.matches,performance.now());last="";wake();}
  function visibility(){clearTimeout(timer);timer=null;if(!document.hidden){last="";wake();}}
  motion.addEventListener("change",reduced);document.addEventListener("visibilitychange",visibility);reduced();
  return {
    state(value){machine.state(value,performance.now());wake();},
    greet(){machine.greet(performance.now());wake();},
    drag(){machine.drag(performance.now());wake();},
    drop(){machine.drop(performance.now());wake();},
    dispose(){disposed=true;clearTimeout(timer);motion.removeEventListener("change",reduced);document.removeEventListener("visibilitychange",visibility);for(const img of cache.values()){img.onload=img.onerror=null;img.src="";}cache.clear();}
  };
}
