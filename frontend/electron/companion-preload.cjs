"use strict";
const {contextBridge,ipcRenderer}=require("electron");
contextBridge.exposeInMainWorld("companion",{
 ready:()=>ipcRenderer.invoke("companion:ready"),
 beginDrag:point=>ipcRenderer.invoke("companion:drag-start",{x:point?.x,y:point?.y}),
 moveDrag:point=>ipcRenderer.invoke("companion:drag-move",{x:point?.x,y:point?.y}),
 endDrag:point=>ipcRenderer.invoke("companion:drag-end",{x:point?.x,y:point?.y}),
 openChat:()=>ipcRenderer.invoke("companion:chat"),
 menu:()=>ipcRenderer.invoke("companion:menu"),
 hit:(enabled)=>ipcRenderer.send("companion:hit",Boolean(enabled)),
 onState:(callback)=>{const listener=(_,state)=>callback(state);ipcRenderer.on("companion:state",listener);return()=>ipcRenderer.removeListener("companion:state",listener);}
});

