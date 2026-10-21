(function () {
  'use strict';
  const W = 1200, H = 900, COLORS = ['#182b49','#2563eb','#dc2626','#15803d'];
  const MAX_POINTS=300000,MAX_STROKES=10000,MAX_STROKE_POINTS=50000;
  const COMPRESS_BACKUP_BYTES=40*1024*1024;
  const isPen = e => e.pointerType === 'pen';
  const accepts = (e, mouse) => isPen(e) || (mouse && e.pointerType === 'mouse' && e.button === 0);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  function point(e, rect) {
    return [clamp((e.clientX-rect.left)/rect.width*W,0,W), clamp((e.clientY-rect.top)/rect.height*H,0,H), clamp(Number(e.pressure)||0.5,0.05,1)];
  }
  function segmentDistance(p,a,b) {
    const dx=b[0]-a[0],dy=b[1]-a[1],len=dx*dx+dy*dy;
    const t=len?clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dy)/len,0,1):0;
    return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
  }
  function hits(stroke,p,radius) {
    if (stroke.points.length===1) return Math.hypot(p[0]-stroke.points[0][0],p[1]-stroke.points[0][1])<=radius+stroke.width;
    return stroke.points.some((v,i,a)=>i && segmentDistance(p,a[i-1],v)<=radius+stroke.width);
  }
  function validNote(n) {
    if (!n || n.version!==1 || !Array.isArray(n.pages) || n.pages.length<1 || n.pages.length>100) return false;
    if(n.updatedAt!==undefined&&(!Number.isFinite(n.updatedAt)||n.updatedAt<0))return false;
    let count=0;
    return n.pages.every(page=>Array.isArray(page)&&page.length<=10000&&page.every(s=>s && COLORS.includes(s.color)&&Number.isFinite(s.width)&&s.width>=1&&s.width<=12&&Array.isArray(s.points)&&s.points.length>0&&s.points.length<=50000&&s.points.every(p=>{
      count++;return count<=300000&&Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)&&p[0]>=0&&p[0]<=W&&p[1]>=0&&p[1]<=H&&p[2]>=0&&p[2]<=1;
    })));
  }
  async function backupFile(notes) {
    const blob=new Blob([JSON.stringify({format:'kepco-pen-backup',version:1,notes})],{type:'application/json'});
    if(blob.size>COMPRESS_BACKUP_BYTES&&typeof CompressionStream==='function'&&typeof DecompressionStream==='function'&&typeof blob.stream==='function'){
      try {
        const compressed=await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob();
        return {blob:compressed,suffix:'.json.gz',large:true};
      } catch(e) {}
    }
    return {blob,suffix:'.json',large:blob.size>COMPRESS_BACKUP_BYTES};
  }
  async function readBackup(file) {
    let compressed=/\.gz$/i.test(file.name||'')||file.type==='application/gzip';
    if(typeof file.slice==='function'){
      const header=file.slice(0,2);
      if(typeof header.arrayBuffer==='function'){
        const bytes=new Uint8Array(await header.arrayBuffer());
        compressed=compressed||(bytes[0]===0x1f&&bytes[1]===0x8b);
      }
    }
    if(compressed&&(typeof DecompressionStream!=='function'||typeof file.stream!=='function'||typeof Response!=='function'))throw new Error('gzip-unavailable');
    const raw=compressed?await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text():await file.text();
    const data=JSON.parse(raw);
    if(!data||data.format!=='kepco-pen-backup'||data.version!==1||!data.notes||typeof data.notes!=='object'||Array.isArray(data.notes))throw new Error('format');
    const entries=Object.entries(data.notes);
    if(entries.some(([k,v])=>!(/^(reader|question|scratch):[A-Za-z0-9_:.-]{1,160}$/).test(k)||!validNote(v)))throw new Error('invalid');
    return entries;
  }
  if (typeof module==='object' && module.exports) { module.exports={accepts,point,hits,validNote,segmentDistance,backupFile,readBackup,W,H}; return; }
  if (!document.querySelector('.top-in,.site-nav')) return;
  const $ = id=>document.getElementById(id);
  const panel=document.createElement('aside'); panel.className='pen-panel'; panel.id='penPanel'; panel.hidden=true;
  panel.setAttribute('aria-label','S펜 필기 노트');
  panel.innerHTML=`<div class="pen-head"><strong>S펜 필기</strong><button id="penLock" type="button" aria-pressed="true">터치 잠금 켜짐</button><button id="penClose" type="button" aria-label="필기 닫기">닫기</button></div>
    <div class="pen-context" id="penContext"></div>
    <div class="pen-tools" role="group" aria-label="필기 도구">
      <button id="penDraw" type="button" aria-pressed="true">펜</button><button id="penErase" type="button" aria-pressed="false">획 지우개</button>
      <label>색 <select id="penColor" aria-label="펜 색"><option value="#182b49">검정</option><option value="#2563eb">파랑</option><option value="#dc2626">빨강</option><option value="#15803d">초록</option></select></label>
      <label>굵기 <select id="penWidth" aria-label="펜 굵기"><option value="2">얇게</option><option value="4" selected>보통</option><option value="7">굵게</option></select></label>
      <button id="penUndo" type="button">되돌리기</button><button id="penRedo" type="button">다시 실행</button><button id="penClear" type="button">이 쪽 비우기</button>
    </div>
    <p class="pen-help">S펜만 필기합니다. 손바닥·손가락은 잉크가 생기지 않습니다. 터치 잠금 중에는 S펜으로 버튼을 누르세요. S펜 옆 버튼은 지원 기기에서 지우개로 동작합니다.</p>
    <div class="pen-alert" id="penConfirm" hidden><p>현재 필기 쪽을 비울까요? 되돌리기로 복원할 수 있습니다.</p><button id="penConfirmClear" type="button">비우기</button><button id="penCancelClear" type="button">취소</button></div>
    <div class="pen-stage" id="penStage"><canvas id="penCanvas" aria-label="S펜 전용 필기 영역"></canvas></div>
    <div class="pen-pages"><button id="penPrevPage" type="button" aria-label="이전 필기 쪽">← 쪽</button><span id="penPageLabel"></span><button id="penNextPage" type="button" aria-label="다음 필기 쪽">쪽 →</button><button id="penAddPage" type="button">+ 새 쪽</button><button id="penScrollUp" type="button">본문 ↑</button><button id="penScrollDown" type="button">본문 ↓</button></div>
    <div id="penStatus" class="pen-status" role="status"></div>
    <div class="pen-backup"><button id="penExport" type="button">전체 필기 백업</button><button id="penImport" type="button">백업 가져오기</button><button id="penPng" type="button">현재 쪽 PNG</button><button id="penMouse" type="button" aria-pressed="false">마우스 필기 꺼짐</button><input id="penFile" type="file" accept="application/json,application/gzip,.json,.gz" hidden></div>
    <p class="pen-help">필기는 이 기기의 브라우저에 자동 저장됩니다. 다른 기기로 옮길 때는 백업 파일을 이용하세요.</p>`;
  document.body.append(panel);
  const toggle=document.createElement('button'); toggle.type='button'; toggle.id='penToggle'; toggle.textContent='S펜 필기'; toggle.setAttribute('aria-expanded','false'); toggle.setAttribute('aria-controls','penPanel');
  document.querySelector('.top-in,.site-nav').append(toggle);
  const canvas=$('penCanvas'),ctx=canvas.getContext('2d');
  let opened=false,locked=true,mouse=false,eraser=false,key='',title='',page=0,note=null,ready=false,active=null,undo=[],redo=[],changeToken=0;
  let saveQueue=Promise.resolve(), dbPromise=null, storageFailed=false, latestTouch=0,dirty=false,frame=0,importing=false,exporting=false;
  const pending=new Map(),failed=new Set(),backedUp=new Map();
  const PREFIX='kepco-pen:v1:';
  function db() {
    if (!dbPromise) dbPromise=new Promise((resolve,reject)=>{
      if (!window.indexedDB) {reject(new Error('indexedDB'));return;}
      const req=indexedDB.open('kepco-pen-notes',1);
      req.onupgradeneeded=()=>req.result.createObjectStore('notes');
      req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
    });
    return dbPromise;
  }
  async function access(mode,action) {
    const database=await db();
    return new Promise((resolve,reject)=>{
      const tx=database.transaction('notes',mode),store=tx.objectStore('notes');
      const request=action(store);let result;
      if(request)request.onsuccess=()=>{result=request.result;};
      tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });
  }
  async function load(k) {
    let value=null, fallback=null;
    try {value=await access('readonly',s=>s.get(k));}catch(e){}
    try {fallback=JSON.parse(localStorage.getItem(PREFIX+k));}catch(e){}
    if(validNote(fallback)&&(!validNote(value)||fallback.updatedAt>value.updatedAt))value=fallback;
    return pending.get(k)||value;
  }
  async function put(k,value) {
    try {await access('readwrite',s=>s.put(value,k));}
    catch(e) {localStorage.setItem(PREFIX+k,JSON.stringify(value));}
  }
  async function allNotes() {
    const result={};
    try {await access('readonly',s=>{const r=s.openCursor();r.onsuccess=()=>{const c=r.result;if(c){result[c.key]=c.value;c.continue();}};});}catch(e){}
    try {for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k.startsWith(PREFIX)){try{const value=JSON.parse(localStorage.getItem(k));const old=result[k.slice(PREFIX.length)];if(!old || value.updatedAt>old.updatedAt) result[k.slice(PREFIX.length)]=value;}catch(e){}}}}catch(e){}
    for(const [k,value] of pending)result[k]=value;
    return result;
  }
  function message(text){$('penStatus').textContent=text;}
  function unbacked(){return [...pending].some(([k,value])=>backedUp.get(k)!==JSON.stringify(value));}
  function save() {
    if(!note||!key||!ready||!dirty)return;
    dirty=false;
    note.updatedAt=Date.now();note.title=title;
    const snapshot=JSON.parse(JSON.stringify(note)), savedKey=key;
    pending.set(savedKey,snapshot);
    message('이 기기에 저장 중…');
    saveQueue=saveQueue.catch(()=>{}).then(()=>put(savedKey,snapshot)).then(()=>{
      if(pending.get(savedKey)===snapshot)pending.delete(savedKey);
      failed.delete(savedKey);storageFailed=failed.size>0;if(savedKey===key)message('이 기기에 자동 저장됨 · 필기는 Google 동기화 대상이 아닙니다.');
    }).catch(()=>{failed.add(savedKey);storageFailed=true;message('자동 저장 실패 · 닫기 전에 전체 필기 백업을 저장하세요.');});
  }
  function context() {
    const q=$('questionCard');
    if(q&&!q.hidden&&q.dataset.studyId)return {key:'question:'+q.dataset.studyId,title:$('questionMeta').textContent};
    const scroller=document.querySelector('.scroller');
    if(scroller){
      const box=scroller.getBoundingClientRect(),anchor=box.top+Math.min(100,box.height*.2);
      const visible=[...scroller.querySelectorAll('section.sec[id^="s-"]')].find(sec=>{const r=sec.getBoundingClientRect();return r.bottom>anchor&&r.top<box.bottom;});
      if(visible){const id=visible.id.slice(2);return {key:'reader:'+id,title:visible.querySelector('h2,h3')?.textContent?.trim()||id};}
    }
    const where=$('where')?.textContent?.trim();
    const id=where?.match(/^([A-Z]\d{2,3})\b/)?.[1];
    if(id)return {key:'reader:'+id,title:where};
    return {key:location.pathname.includes('questions')?'scratch:questions':'scratch:reader',title:'자유 필기'};
  }
  async function switchContext(next, reload=false) {
    if(importing||(!reload&&next.key===key))return;
    if(storageFailed&&unbacked()){message('저장 실패로 현재 필기를 유지합니다. 먼저 백업하세요.');return;}
    endStroke();save();const token=++changeToken;ready=false;
    await saveQueue;
    if(token!==changeToken)return;
    if(storageFailed&&unbacked()){ready=!!note;message('저장 실패로 현재 필기를 유지합니다. 먼저 백업하세요.');render();return;}
    key=next.key;title=next.title;page=0;note=null;dirty=false;undo=[];redo=[];
    $('penContext').textContent=title;message('필기를 불러오는 중…');render();
    const stored=await load(key);
    if(token!==changeToken)return;
    note=validNote(stored)?stored:{version:1,title,pages:[[]],updatedAt:0};ready=true;render();
    message('S펜으로 필기하세요 · 이 단원/문제에 따로 저장됩니다.');
  }
  function history() {undo.push(JSON.stringify(note.pages[page]));if(undo.length>40)undo.shift();redo=[];}
  function scheduleRender(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;render();});}
  function render() {
    if(!ctx)return;
    const stage=$('penStage').getBoundingClientRect();const scale=Math.max(.01,Math.min(stage.width/W,stage.height/H));
    const width=Math.max(1,Math.floor(W*scale)),height=Math.max(1,Math.floor(H*scale)),dpr=Math.min(window.devicePixelRatio||1,3);
    if(canvas.width!==Math.round(width*dpr)||canvas.height!==Math.round(height*dpr)){canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);canvas.style.width=width+'px';canvas.style.height=height+'px';}
    ctx.setTransform(canvas.width/W,0,0,canvas.height/H,0,0);paint(ctx);
    $('penPageLabel').textContent=note?`${page+1} / ${note.pages.length}`:'—';
    $('penUndo').disabled=!ready||!undo.length;$('penRedo').disabled=!ready||!redo.length;$('penPrevPage').disabled=!ready||page===0;$('penNextPage').disabled=!ready||page>=note.pages.length-1;
    $('penImport').disabled=importing||exporting||!ready;$('penExport').disabled=importing||exporting;
    ['penClear','penAddPage','penPng'].forEach(id=>$(id).disabled=!ready);
  }
  function paint(c) {
    c.fillStyle='#fff';c.fillRect(0,0,W,H);c.fillStyle='#d7dfe9';
    for(let x=25;x<W;x+=25)for(let y=25;y<H;y+=25){c.beginPath();c.arc(x,y,1,0,Math.PI*2);c.fill();}
    const strokes=note?.pages[page]||[];
    for(const s of strokes) {
      c.strokeStyle=s.color;c.fillStyle=s.color;c.lineCap='round';c.lineJoin='round';
      if(s.points.length===1){const p=s.points[0];c.beginPath();c.arc(p[0],p[1],s.width*(.4+p[2])/2,0,Math.PI*2);c.fill();}
      for(let i=1;i<s.points.length;i++){const a=s.points[i-1],b=s.points[i];c.lineWidth=s.width*(.4+(a[2]+b[2])/2);c.beginPath();c.moveTo(a[0],a[1]);c.lineTo(b[0],b[1]);c.stroke();}
    }
  }
  function endStroke(e) {
    if(!active||(e&&e.pointerId!==active.id))return;
    const id=active.id;active=null;try{canvas.releasePointerCapture(id);}catch(_){}
    save();render();
  }
  canvas.addEventListener('pointerdown',e=>{
    if(!ready||active||!accepts(e,mouse)||e.buttons===0)return;
    const erase=eraser||(isPen(e)&&((e.buttons&2)||(e.buttons&32)||e.button===5));
    const points=note.pages.reduce((n,p)=>n+p.reduce((m,s)=>m+s.points.length,0),0);
    if(!erase&&(note.pages[page].length>=MAX_STROKES||points>=MAX_POINTS)){e.preventDefault();message('필기 용량에 도달했습니다. 백업한 뒤 쪽을 비우거나 다른 단원 노트를 사용하세요.');return;}
    e.preventDefault();history();
    active={id:e.pointerId,erase,stroke:null,points};
    canvas.setPointerCapture(e.pointerId);
    if(!active.erase){active.stroke={color:$('penColor').value,width:Number($('penWidth').value),points:[]};note.pages[page].push(active.stroke);}
    move(e);
  });
  function move(e) {
    if(!active||e.pointerId!==active.id)return;e.preventDefault();
    const rect=canvas.getBoundingClientRect();
    for(const ev of (e.getCoalescedEvents?.().length?e.getCoalescedEvents():[e])) {
      const p=point(ev,rect);
      if(active.erase){const before=note.pages[page].length;note.pages[page]=note.pages[page].filter(s=>!hits(s,p,20));if(before!==note.pages[page].length)dirty=true;}
      else if(active.stroke.points.length<MAX_STROKE_POINTS&&active.points<MAX_POINTS){const prev=active.stroke.points.at(-1);if(!prev||Math.hypot(p[0]-prev[0],p[1]-prev[1])>.25){active.stroke.points.push(p);active.points++;dirty=true;}}
    }
    scheduleRender();
  }
  canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',endStroke);canvas.addEventListener('pointercancel',endStroke);canvas.addEventListener('lostpointercapture',endStroke);
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  function lockUI(){document.body.classList.toggle('pen-locked',opened&&locked);$('penLock').textContent=locked?'터치 잠금 켜짐':'터치 이동 허용';$('penLock').setAttribute('aria-pressed',String(locked));}
  function touchGuard(e) {
    if(!opened)return;
    const touch=e.pointerType==='touch'||e.type.startsWith('touch');
    if(touch)latestTouch=Date.now();
    if(locked&&touch){e.preventDefault();e.stopImmediatePropagation();}
  }
  ['pointerdown','pointermove','pointerup','touchstart','touchmove','touchend'].forEach(type=>document.addEventListener(type,touchGuard,{capture:true,passive:false}));
  document.addEventListener('click',e=>{
    if(opened&&locked&&(e.pointerType==='touch'||(!e.pointerType&&e.sourceCapabilities?.firesTouchEvents)||(e.detail>0&&!e.pointerType&&Date.now()-latestTouch<800))){e.preventDefault();e.stopImmediatePropagation();}
  },true);
  async function show(value){
    if(importing){message('백업을 가져오는 중입니다. 완료될 때까지 기다려 주세요.');return;}
    endStroke();
    if(!value){save();await saveQueue;if(storageFailed&&unbacked()){message('자동 저장에 실패했습니다. 전체 필기를 백업한 뒤 닫아 주세요.');return;}}
    opened=value;panel.hidden=!value;document.body.classList.toggle('pen-open',value);toggle.setAttribute('aria-expanded',String(value));lockUI();
    if(value){document.dispatchEvent(new CustomEvent('study-pen-open'));switchContext(context());requestAnimationFrame(render);$('penClose').focus();}else{toggle.focus();}
  }
  toggle.addEventListener('click',()=>show(!opened));$('penClose').addEventListener('click',()=>show(false));
  $('penLock').addEventListener('click',()=>{locked=!locked;lockUI();});
  $('penMouse').addEventListener('click',()=>{mouse=!mouse;$('penMouse').textContent=mouse?'마우스 필기 켜짐':'마우스 필기 꺼짐';$('penMouse').setAttribute('aria-pressed',String(mouse));});
  function tool(value){eraser=value;$('penDraw').setAttribute('aria-pressed',String(!value));$('penErase').setAttribute('aria-pressed',String(value));}
  $('penDraw').addEventListener('click',()=>tool(false));$('penErase').addEventListener('click',()=>tool(true));
  $('penUndo').addEventListener('click',()=>{if(!undo.length||!ready)return;endStroke();redo.push(JSON.stringify(note.pages[page]));note.pages[page]=JSON.parse(undo.pop());dirty=true;save();render();});
  $('penRedo').addEventListener('click',()=>{if(!redo.length||!ready)return;endStroke();undo.push(JSON.stringify(note.pages[page]));note.pages[page]=JSON.parse(redo.pop());dirty=true;save();render();});
  $('penClear').addEventListener('click',()=>{$('penConfirm').hidden=false;});$('penCancelClear').addEventListener('click',()=>{$('penConfirm').hidden=true;});
  $('penConfirmClear').addEventListener('click',()=>{if(!ready)return;endStroke();history();note.pages[page]=[];dirty=true;$('penConfirm').hidden=true;save();render();});
  function goPage(n){if(!ready)return;endStroke();page=clamp(n,0,note.pages.length-1);undo=[];redo=[];$('penConfirm').hidden=true;render();}
  $('penPrevPage').addEventListener('click',()=>goPage(page-1));$('penNextPage').addEventListener('click',()=>goPage(page+1));
  $('penAddPage').addEventListener('click',()=>{if(!ready||note.pages.length>=100)return;endStroke();note.pages.push([]);dirty=true;goPage(note.pages.length-1);save();});
  for(const [id,dir] of [['penScrollUp',-1],['penScrollDown',1]])$(id).addEventListener('click',()=>{const el=document.querySelector('.scroller');if(el)el.scrollBy({top:dir*el.clientHeight*.65,behavior:'smooth'});else window.scrollBy({top:dir*window.innerHeight*.4,behavior:'smooth'});});
  function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  $('penExport').addEventListener('click',async()=>{
    if(importing||exporting)return;
    exporting=true;render();
    try{
      endStroke();await saveQueue;const notes=await allNotes();if(note&&key)notes[key]=JSON.parse(JSON.stringify(note));
      const snapshots=Object.entries(notes).map(([k,value])=>[k,JSON.stringify(value)]);
      message('전체 필기 백업을 준비하는 중…');
      const archive=await backupFile(notes);
      download(archive.blob,'학습필기_'+new Date().toISOString().slice(0,10)+archive.suffix);
      for(const [k,value]of snapshots)backedUp.set(k,value);
      message((archive.large&&archive.suffix==='.json'?'큰 백업은 JSON으로 저장합니다. 같은 파일로 가져올 수 있습니다. ':'')+'백업 다운로드를 요청했습니다. 저장된 파일을 확인한 뒤 닫아 주세요.');
    }catch(e){message('백업을 만들지 못했습니다. 필기를 유지한 채 다시 시도하세요.');}
    finally{exporting=false;render();}
  });
  $('penPng').addEventListener('click',()=>{if(!ready)return;const c=document.createElement('canvas');c.width=W;c.height=H;paint(c.getContext('2d'));c.toBlob(blob=>{if(blob)download(blob,key.replace(/[^a-z0-9_-]/gi,'_')+'_'+(page+1)+'.png');});});
  $('penImport').addEventListener('click',()=>$('penFile').click());
  $('penFile').addEventListener('change',async e=>{
    const file=e.target.files[0];e.target.value='';if(!file)return;
    if(importing||exporting||!ready)return;
    endStroke();save();importing=true;ready=false;$('penConfirm').hidden=true;render();
    let completed=false,resultMessage='',importedCurrent=null;
    try {
      await saveQueue;
      if(storageFailed&&unbacked()){resultMessage='현재 필기를 저장하지 못했습니다. 전체 필기를 백업한 뒤 다시 가져오세요.';return;}
      message('백업을 읽고 검사하는 중…');
      const entries=await readBackup(file);
      let count=0;
      for(const [k,value] of entries){const old=await load(k);if(!old||Number(value.updatedAt)>Number(old.updatedAt)){
        pending.set(k,value);
        if(k===key)importedCurrent=value;
        try{await put(k,value);if(pending.get(k)===value)pending.delete(k);failed.delete(k);count++;}
        catch(error){failed.add(k);storageFailed=true;resultMessage='백업 데이터는 읽었지만 저장 공간이 부족합니다. 원본 백업 파일을 보관하세요.';return;}
      }}
      storageFailed=failed.size>0;
      completed=true;resultMessage=`${count}개 필기를 가져왔습니다. 기존 기록은 더 최신인 경우 유지했습니다.`;
    } catch(e){resultMessage=e.message==='gzip-unavailable'?'이 브라우저는 압축 백업을 열 수 없습니다. 지원 브라우저를 사용하거나 .gz를 압축 해제한 JSON을 선택하세요.':'가져오기 실패 · 올바른 필기 백업 JSON 또는 JSON.GZ를 선택하세요. 기존 필기는 유지됩니다.';}
    finally{
      if(importedCurrent){note=JSON.parse(JSON.stringify(importedCurrent));page=clamp(page,0,note.pages.length-1);dirty=false;undo=[];redo=[];}
      importing=false;ready=!!note;render();
      await switchContext(context(),completed);
      message(resultMessage);
    }
  });
  panel.addEventListener('keydown',e=>{if(opened)e.stopPropagation();});
  document.addEventListener('keydown',e=>{if(opened&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();show(false);}},{capture:true});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){endStroke();save();}});window.addEventListener('pagehide',()=>{endStroke();save();for(const [k,value] of pending){try{localStorage.setItem(PREFIX+k,JSON.stringify(value));}catch(e){}}});
  window.addEventListener('beforeunload',e=>{if(storageFailed||pending.size){e.preventDefault();e.returnValue='';}});
  const observer=new MutationObserver(()=>{if(opened&&!active)switchContext(context());});
  const where=$('where'),card=$('questionCard');if(where)observer.observe(where,{childList:true,characterData:true,subtree:true});if(card)observer.observe(card,{attributes:true,attributeFilter:['data-study-id','hidden']});
  let scrollTimer=0;document.querySelector('.scroller')?.addEventListener('scroll',()=>{clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>{if(opened&&!active)switchContext(context());},180);},{passive:true});
  if(window.ResizeObserver)new ResizeObserver(()=>{if(opened)render();}).observe($('penStage'));else window.addEventListener('resize',()=>{if(opened)render();});
})();
