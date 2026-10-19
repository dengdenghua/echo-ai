/* Local evidence graph. Source text is always rendered with textContent. */
(() => {
  const labels = {rule:'条件性结论',source:'已核读来源',conditions_and_gaps:'条件与验证缺口',topic:'专题'};
  const make = (tag, text, cls) => { const e=document.createElement(tag); if(text)e.textContent=text; if(cls)e.className=cls; return e; };
  let root, sequence=0;
  async function get(path) {const r=await fetch(path);const d=await r.json();if(!r.ok)throw Error(d.error||'读取失败');return d;}
  async function showNode(id, target) {
    const s=++sequence;
    try {
      const graph=await get('/api/graph/node?id='+encodeURIComponent(id));if(s!==sequence)return;
      const center=graph.nodes.find(n=>n.id===graph.center);
      target.replaceChildren(make('h2',labels[center.kind]||center.kind),make('p',center.title,'graph-statement'));
      if(center.corrections?.length){target.append(make('p','此记录已有来源更正，请结合下列更正使用。','banner info-banner'));center.corrections.forEach(n=>{const c=make('article',null,'graph-detail');c.append(make('h3','来源更正'),make('p',n.title),make('p','适用范围：'+n.payload.conditions_and_missing_evidence));const b=make('button','查看更正依据','button button-secondary button-small');b.onclick=()=>showNode(n.id,target);c.append(b);target.append(c);});}
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 760 360');svg.setAttribute('role','img');svg.setAttribute('aria-label','结论与来源、专题及验证缺口的关联');
      const others=graph.nodes.filter(n=>n.id!==id).slice(0,8);
      const positions=new Map([[id,[150,180]]]);others.forEach((n,i)=>positions.set(n.id,[570,35+i*290/Math.max(1,others.length-1)]));
      graph.edges.forEach(e=>{if(!positions.has(e.src)||!positions.has(e.dst))return;const a=positions.get(e.src),b=positions.get(e.dst);const line=document.createElementNS(svg.namespaceURI,'line');['x1','y1','x2','y2'].forEach((k,i)=>line.setAttribute(k,[...a,...b][i]));svg.append(line);});
      [...positions].forEach(([nid,[x,y]])=>{const n=graph.nodes.find(v=>v.id===nid),g=document.createElementNS(svg.namespaceURI,'g');g.setAttribute('transform',`translate(${x},${y})`);const c=document.createElementNS(svg.namespaceURI,'circle');c.setAttribute('r','17');g.append(c);const t=document.createElementNS(svg.namespaceURI,'text');t.setAttribute('x',24);t.setAttribute('y',5);t.textContent=labels[n.kind]||n.kind;g.append(t);svg.append(g);});target.append(svg);
      graph.nodes.forEach(n=>{const card=make('article',null,'graph-detail');card.append(make('h3',labels[n.kind]||n.kind),make('p',n.title));
        if(n.kind==='source'){card.append(make('p','核读范围：'+n.payload.read_scope),make('code','SHA-256: '+n.payload.sha256));(n.payload.current_paths||[]).forEach(p=>card.append(make('p',p,'muted')));}
        if(n.kind==='rule')card.append(make('p','定位：'+n.payload.source_id+' / '+n.payload.location),make('p','状态：未采纳为当前项目阈值；未完成完整模型验证。','muted'));
        if(n.id!==id){const b=make('button','查看关联','button button-secondary button-small');b.onclick=()=>showNode(n.id,target);card.append(b);}target.append(card);});
    }catch(e){if(s===sequence)target.replaceChildren(make('p',e.message));}
  }
  window.OpticsGraph={async load(){
    root=document.getElementById('view-graph');
    if(!root.dataset.ready){root.dataset.ready='1';root.innerHTML='<div class="page-heading"><div><div class="eyebrow">EVIDENCE · CONDITIONS · MEMORY</div><h1>知识图谱与个人记忆</h1><p>把已核读结论连到依据、适用条件和下一步验证。</p></div></div><p id="graph-count" class="banner info-banner"></p><label class="search-box"><span class="sr-only">搜索知识图谱</span><input id="graph-search" type="search" placeholder="搜索复眼、老化、透过率、条件…"></label><div class="graph-layout"><div id="graph-list" class="panel"></div><div id="graph-details" class="panel" aria-live="polite">选择结论，查看来源与验证缺口。</div></div><section class="panel graph-memory"><h2>个人记忆</h2><p>保存使用偏好、带来源的工程经验和待解决问题。工程经验继续保留适用范围。</p><div id="memory-list"></div></section>';
      let timer;root.querySelector('#graph-search').oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>this.search(),200);};}
    try{const [stats,mem]=await Promise.all([get('/api/graph/stats'),get('/api/memory')]);root.querySelector('#graph-count').textContent=`${stats.kinds.rule||0} 条条件性结论 · ${stats.nodes} 个节点 · ${stats.edges} 条关联 · ${stats.memories} 条个人记忆。${stats.scope}`;
      const list=root.querySelector('#memory-list');list.replaceChildren(...mem.items.map(m=>{const c=make('article',null,'graph-detail');c.append(make('h3',{user_preference:'使用偏好',engineering_lesson:'工程经验',open_question:'待解决问题'}[m.kind]),make('p',m.text),make('p','适用范围：'+m.scope),make('p','来源：'+m.provenance,'muted'));m.node_ids.forEach(id=>{const b=make('button','查看工程依据','button button-secondary button-small');b.onclick=()=>showNode(id,root.querySelector('#graph-details'));c.append(b);});return c;}));await this.search();
    }catch(e){root.querySelector('#graph-count').textContent=e.message;}
  },async search(){const q=root.querySelector('#graph-search').value;try{const d=await get('/api/graph/search?q='+encodeURIComponent(q));const list=root.querySelector('#graph-list');list.replaceChildren(...d.items.map(n=>{const b=make('button',n.title,'graph-node');b.append(make('small',(labels[n.kind]||n.kind)+(n.corrections?.length?' · 已有更正':'')));b.onclick=()=>showNode(n.id,root.querySelector('#graph-details'));return b;}));if(!d.items.length)list.append(make('p','暂无匹配的已导入知识。'));}catch(e){root.querySelector('#graph-list').textContent=e.message;}}};
})();
