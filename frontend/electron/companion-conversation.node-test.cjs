"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {openConversation}=require('./companion-source.cjs');
function scene({mountedAt=0,listenAt=0,routeExitAt=Infinity,existing=false,thread=''}={}){
 let now=0,focused=false,dispatches=0,input=existing?{value:'保留未发送的草稿',focus(){focused=true}}:null;
 const location={hash:'#/tv'+(thread?'?conversation='+thread:'')},events=[];
 const context={location,URLSearchParams,Date:{now:()=>now},Promise,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail}},
  setTimeout:f=>{now+=150;if(now>=routeExitAt)location.hash='#/settings';queueMicrotask(f)},
  document:{querySelector:s=>s.includes('tv-shell')?(now>=mountedAt?{}:null):input},
  window:{dispatchEvent:e=>{dispatches++;events.push(e);if(now>=listenAt)input={value:'',focus(){focused=true}}}}};
 const win={isDestroyed:()=>false,isMinimized:()=>false,show(){},focus(){},webContents:{isDestroyed:()=>false,getURL:()=> 'echo-app://app/#/tv',executeJavaScript:s=>vm.runInNewContext(s,context)}};
 return {win,events,result:()=>({now,focused,dispatches,input,location})};
}
test('first click waits for cold TV mount and late effect listener',async()=>{
 const s=scene({mountedAt:900,listenAt:1350});assert.equal(await openConversation(s.win,'','thread_123'),true);
 assert.ok(s.result().now>=1350);assert.equal(s.result().focused,true);assert.equal(s.events.at(-1).detail.threadId,'thread_123');
});
test('clicking open chat preserves an existing unsent draft',async()=>{
 const s=scene({existing:true});assert.equal(await openConversation(s.win,'',''),true);assert.equal(s.result().input.value,'保留未发送的草稿');assert.equal(s.result().dispatches,0);assert.equal(s.result().focused,true);
});
test('opening the same task preserves its unsent draft',async()=>{
 const s=scene({existing:true,thread:'thread_123'});assert.equal(await openConversation(s.win,'','thread_123'),true);assert.equal(s.result().input.value,'保留未发送的草稿');assert.equal(s.result().dispatches,0);
});
test('pending chat stops when user leaves TV',async()=>{
 const s=scene({mountedAt:5000,routeExitAt:450});assert.equal(await openConversation(s.win,'',''),false);assert.equal(s.result().location.hash,'#/settings');assert.equal(s.result().dispatches,0);
});
test('missing TV shell is bounded rather than leaving a permanent pending click',async()=>{
 const s=scene({mountedAt:Infinity});assert.equal(await openConversation(s.win,'',''),false);assert.ok(s.result().now>=20000&&s.result().now<20200);assert.equal(s.result().dispatches,0);
});
