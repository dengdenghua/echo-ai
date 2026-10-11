import { expect, test } from "@playwright/test";

// Browser integration uses the real renderer and conversation contexts. The
// transport receipt is controlled here; backend validation has separate tests.
test("native cards stream safely, submit once and adapt to a narrow screen", async ({
  page,
}, testInfo) => {
  await page.route("**/native-ui-test", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root" style="max-width:760px;margin:24px auto;padding:0 16px"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type;
      window.__vite_plugin_react_preamble_installed__=true;
      const {default: React}=await import('/node_modules/.vite/deps/react.js');
      const {default: {createRoot}}=await import('/node_modules/.vite/deps/react-dom_client.js');
      const {NativeUIMessages}=await import('/src/components/workspace/messages/native-ui.tsx');
      const {ThreadMetaContext,ThreadMessagesContext,ThreadValuesContext}=await import('/src/components/workspace/messages/context.tsx');
      await import('/src/styles/globals.css');
      const root=createRoot(document.getElementById('root'));
      const uiDocument={version:1,title:'Echo · 项目启动',blocks:[
        {id:'intro',type:'text',text:'先比较工作方式，再补充两项需求。确认后继续制定实施计划。'},
        {id:'options',type:'comparison',title:'工作方式对比',columns:['方案','适用场景','文件位置'],rows:[['本地工作','个人开发','当前电脑'],['Echo OS 共享','团队协作','共享设备'],['NAS 挂载','大文件资料','共享目录'],['远程工作区','长时间任务','远程设备'],['临时沙盒','验证方案','隔离目录']]},
        {id:'requirements',type:'form',title:'确认项目需求',fields:[{id:'name',type:'text',label:'项目名称',required:true},{id:'location',type:'select',label:'工作位置',required:true,options:['当前电脑','Echo OS 共享空间']}]},
        {id:'plan',type:'tasks',title:'当前任务计划'}
      ]};
      window.sent=[];
      window.addEventListener('echo:quick-reply',event=>{window.sent.push(event.detail);event.preventDefault();});
      window.renderUI=(complete=false,ack=false,extra=false)=>{
        const doc=extra?{...uiDocument,blocks:[...uiDocument.blocks,{id:'extra',type:'text',text:'补充：方案支持后续调整。'}]}:uiDocument;
        const messages=[{type:'ai',id:'ai',content:'',tool_calls:[{id:'call',name:'show_ui',args:{document:doc}}]},...(complete?[{type:'tool',id:'result',tool_call_id:'call',content:JSON.stringify({ok:true,kind:'echo.ui.v1',thread_id:'thread',version:1,status:'ready'})}]:[])];
        const all=ack?[...messages,{id:window.sent[0].clientMessageId,type:'human',content:window.sent[0].text}]:messages;
        root.render(React.createElement(ThreadMetaContext.Provider,{value:{threadId:'thread'}},React.createElement(ThreadMessagesContext.Provider,{value:{messages:all}},React.createElement(ThreadValuesContext.Provider,{value:{values:{todos:[{content:'确认执行环境',status:'completed'},{content:'整理需求与约束',status:'in_progress'},{content:'实施与验证',status:'pending'}]}}},React.createElement(NativeUIMessages,{messages})))));
      };
      window.renderUI(); window.nativeReady=true;
    </script></body></html>`,
    }),
  );
  await page.goto("/native-ui-test");
  await page.waitForFunction(() => (window as any).nativeReady);
  await expect(
    page.getByRole("button", { name: "发送到当前对话" }),
  ).toBeDisabled();
  await page.evaluate(() => (window as any).renderUI(true));
  await page.getByRole("button", { name: "发送到当前对话" }).click();
  expect(await page.evaluate(() => (window as any).sent.length)).toBe(0);
  await page.getByLabel(/项目名称/).fill("Echo 协作优化");
  await page.getByLabel(/工作位置/).selectOption("Echo OS 共享空间");
  await page.evaluate(() => (window as any).renderUI(true, false, true));
  await expect(page.getByLabel(/项目名称/)).toHaveValue("Echo 协作优化");
  await page.getByRole("searchbox").fill("NAS");
  await expect(page.getByRole("cell", { name: "NAS 挂载" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "本地工作" })).toHaveCount(0);
  await page.getByRole("searchbox").clear();
  await expect(page.getByText("计划完成 1/3")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("native-ui-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 850 });
  await expect(page.getByLabel(/项目名称/)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("native-ui-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "发送到当前对话" }).click();
  await expect(page.getByRole("button", { name: "等待回执" })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).sent)).toEqual([
    expect.objectContaining({
      threadId: "thread",
      text: "表单回复：确认项目需求\n项目名称：Echo 协作优化\n工作位置：Echo OS 共享空间",
    }),
  ]);
  await page.evaluate(() => (window as any).renderUI(true, true, true));
  await expect(page.getByRole("button", { name: "已收到" })).toBeDisabled();
});
