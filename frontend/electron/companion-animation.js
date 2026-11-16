(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.EchoCompanionAnimation = factory();
})(typeof window === "object" ? window : globalThis, function () {
  "use strict";
  const clips = {idle:96,greet:48,drag:48,land:24,think:72,work:72,wait:72,success:48,blink:24,glance:72,nod:48};
  const looping = new Set(["idle","drag","think","work","wait"]);
  const unavailable = new Set(["offline","disconnected","unknown","signed_out"]);
  function createMachine() {
    let status="offline", base="idle", clip="idle", since=0, dragging=false, oneShot=false, reduced=false;
    const celebrated=new Set();
    let ambient=false,nextAmbient=8000,ambientIndex=0;
    const idleGestures=["blink","glance","blink","nod"];
    function play(next, now, once=false, restart=false) {
      if (clip!==next || restart) {clip=next;since=now;}
      oneShot=once;
    }
    return {
      state(state, now) {
        const previous=status;status=state.status || "offline";
        if(status==="idle"&&previous!=="idle")nextAmbient=now+8000;
        if(ambient&&status!=="idle"){ambient=false;oneShot=false;}
        base=status==="pending"||(status==="running"&&state.phase==="thinking")?"think":["running","verifying","repairing"].includes(status)?"work":["waiting_approval","paused"].includes(status)?"wait":"idle";
        const key=state.eventKey || [state.taskId,state.threadId,state.title,status].join("|");
        if (status==="completed" && !celebrated.has(key)) {
          celebrated.add(key);if(celebrated.size>128)celebrated.delete(celebrated.values().next().value);
          if (!dragging && !reduced) play("success",now,true,true);
        }
        if (unavailable.has(status) && !dragging) play("idle",now);
        else if (clip==="success" && status!=="completed" && !dragging) play(base,now);
        else if (!dragging && !oneShot) play(base,now);
      },
      greet(now) {ambient=false;nextAmbient=now+12000;if(!dragging&&!reduced)play("greet",now,true,true);},
      drag(now) {ambient=false;dragging=true;play("drag",now);},
      drop(now) {if(!dragging)return;dragging=false;nextAmbient=now+10000;play(reduced?base:"land",now,!reduced,true);},
      reduce(value,now) {reduced=Boolean(value);if(reduced){ambient=false;oneShot=false;play(dragging?"drag":base,now);}},
      frame(now) {
        if(status==="idle"&&!dragging&&!oneShot&&!reduced&&now>=nextAmbient){ambient=true;play(idleGestures[ambientIndex++%idleGestures.length],now,true,true);}
        const still=reduced || (unavailable.has(status)&&!dragging&&!oneShot);
        let index=still?0:Math.max(0,Math.floor((now-since)*24/1000));
        if(oneShot && index>=clips[clip]) {ambient=false;nextAmbient=now+9000+(ambientIndex%3)*2000;play(base,now);index=0;}
        return {clip,index:looping.has(clip)?index%clips[clip]:Math.min(index,clips[clip]-1),still,loop:looping.has(clip),status};
      }
    };
  }
  return {createMachine,clips};
});
