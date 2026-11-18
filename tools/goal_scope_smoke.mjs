#!/usr/bin/env node
// Real React view with simulated desktop commands and isolated sample data.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile), session = 'knowflick-goal-scope-smoke';
const b = async (...args) => (await exec('agent-browser', ['--session', session, ...args], { timeout: 20000 })).stdout.trim();
const ev = async code => { const r = JSON.parse(await b('eval', `JSON.stringify(${code})`)); return typeof r === 'string' ? JSON.parse(r) : r; };
async function check(code, message) {
  for (let n = 0; n < 40; n++) { if (await ev(code)) { console.log(`PASS ${message}`); return; } await new Promise(r => setTimeout(r, 100)); }
  assert.fail(message);
}
try {
  await b('open', process.env.KNOWFLICK_UI_URL || 'http://localhost:1420');
  await b('eval', `(async()=>{
    const projects=[{id:'p1',name:'项目一',archivedAt:null},{id:'p2',name:'旧项目',archivedAt:10}];
    const goals=[{id:'old',title:'旧目标',doneCriteria:'完成',scope:null,createdAt:1,achievedAt:null,abandonedAt:null,reviewNote:'',evidenceCount:1},
      {id:'archived',title:'封存目标',doneCriteria:'完成',scope:'p2',createdAt:1,achievedAt:null,abandonedAt:null,reviewNote:'',evidenceCount:1}];
    window.__goalTest={projects,goals,created:null};
    window.__TAURI_INTERNALS__={invoke:async(cmd,args)=>{
      if(cmd==='project_list') return projects.map(p=>({...p}));
      if(cmd==='goal_list_active') return goals.map(g=>({...g}));
      if(cmd==='goal_create_cmd'){window.__goalTest.created=args.goal;goals.push({...args.goal,createdAt:1,achievedAt:null,abandonedAt:null,reviewNote:'',evidenceCount:1});return 1;}
      if(cmd==='goal_set_scope_cmd'){const g=goals.find(x=>x.id===args.id);g.scope=args.scope;return;}
      if(cmd==='goal_review_snapshot'){
        if(window.__goalTest.failEvidence) throw new Error('unavailable');
        return {goals:[...goals,{id:'done',title:'已达成目标',doneCriteria:'完成',scope:null,createdAt:1,achievedAt:Date.now()-3000,abandonedAt:null,reviewNote:'',evidenceCount:1}], evidence:[
          {goalId:'old',evidenceId:'note-1',kind:'note',linkedAt:Date.now()-1000,title:'证据笔记'},
          {goalId:'old',evidenceId:'material-1',kind:'material',linkedAt:Date.now()-1500,title:'证据素材'},
          {goalId:'old',evidenceId:'deleted-1',kind:'material',linkedAt:Date.now()-2000,title:null},
          {goalId:'done',evidenceId:'done-note',kind:'note',linkedAt:Date.now()-4000,title:'达成证据'}
        ]};
      }
      throw new Error('unexpected command '+cmd);
    }};
    document.body.innerHTML='<div id="goal-test"></div>';
    const React=(await import('/node_modules/.vite/deps/react.js')).default;
    const dom=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
    const {GoalsView}=await import('/src/ui/workspace/GoalsView.tsx');
    window.__reminders=(await import('/src/domain/reviewReminder.ts')).reviewReminders;
    dom.createRoot(document.getElementById('goal-test')).render(React.createElement(GoalsView,{dir:'/test/library',materials:[],notes:[],onGoalsChange:()=>{}}));
    return true;
  })()`);
  await check('!!document.querySelector(\'select[aria-label="「旧目标」的项目归属"]\')','旧目标的归属可调整');
  await check('document.querySelector(\'select[aria-label="「封存目标」的项目归属"]\').selectedOptions[0].textContent.includes("已封存")','封存项目仍如实显示');
  await b('click', '.gl-head button');
  await b('fill', 'input[aria-label="目标标题"]', '项目目标');
  await b('fill', 'textarea[aria-label="完成条件"]', '完成检查');
  await check('!document.querySelector(\'select[aria-label="新目标的项目归属"] option[value="p2"]\')','新目标不能选择封存项目');
  await b('select', 'select[aria-label="新目标的项目归属"]', 'p1');
  await b('click', '.gl-form button.ws-primary');
  await check('window.__goalTest.created?.scope === "p1" && window.__goalTest.created?.doneCriteria === "完成检查"','新目标提交所选项目和完成条件');
  await b('select', 'select[aria-label="「旧目标」的项目归属"]', 'p1');
  await check('window.__goalTest.goals.find(g=>g.id==="old").scope === "p1"','已有目标可关联项目');
  await check('window.__reminders({goals:window.__goalTest.goals,notes:[],materials:[],staleReferences:[],projectScope:["p1"]}).filter(x=>x.kind==="goal-achieve").length === 2','项目范围回顾包含新目标和已调整的目标');
  await b('select', 'select[aria-label="「旧目标」的项目归属"]', '');
  await check('window.__goalTest.goals.find(g=>g.id==="old").scope === null','已有目标可取消项目归属');
  await check('window.__reminders({goals:window.__goalTest.goals,notes:[],materials:[],staleReferences:[],projectScope:["p1"]}).filter(x=>x.kind==="goal-achieve").length === 1','取消归属后不再计入该项目回顾');
  await b('eval', `(async()=>{
    const React=(await import('/node_modules/.vite/deps/react.js')).default;
    const dom=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
    const {ReviewFactsView}=await import('/src/ui/workspace/ReviewFactsView.tsx');
    const {defaultReviewSchedule}=await import('/src/domain/reviewReminder.ts');
    const host=document.createElement('div');document.body.replaceChildren(host);
    window.__goalTest.reviewRoot=dom.createRoot(host);
    window.__goalTest.renderReview=()=>window.__goalTest.reviewRoot.render(React.createElement(ReviewFactsView,{
      dir:'/test/library',materials:[],cards:[],goals:window.__goalTest.goals,projects:[],schedule:defaultReviewSchedule,
      reminders:[],onScheduleChange:()=>{},onEnableSystemNotifications:async()=>false,onOpenMaterial:id=>window.__goalTest.opened='material:'+id,
      onOpenCard:()=>{},onOpenNote:id=>window.__goalTest.opened='note:'+id
    }));
    window.__goalTest.renderReview();return true;
  })()`);
  await check('document.querySelector(\'[aria-label="目标现状"]\')?.innerText.includes("原件已删除或不可用")','已删除的来源保留关联事实并标记不可用');
  await check('document.querySelector(\'[aria-label="目标现状"]\')?.innerText.includes("已达成目标 — 关联证据 1 条（已达成）") && document.querySelector(\'[aria-label="目标现状"]\')?.innerText.includes("达成证据")','周期内已达成目标及其证据仍可回顾');
  await b('click', 'button.rv-source-link');
  await check('window.__goalTest.opened === "note:note-1"','周期证据可点击回到笔记原件');
  await b('eval', `(()=>{[...document.querySelectorAll('button.rv-source-link')].find(b=>b.textContent==='证据素材').click();return true;})()`);
  await check('window.__goalTest.opened === "material:material-1"','周期证据可点击回到素材原件');
  await b('eval', `(()=>{window.__goalTest.failEvidence=true;document.querySelector('[aria-label="复盘周期"] button').click();return true;})()`);
  await check('document.querySelector(\'[aria-label="目标现状"]\')?.innerText.includes("明细读取失败") && !document.querySelector(\'[aria-label="目标现状"]\')?.innerText.includes("本周期没有新增关联证据")','读取失败不会冒充零条证据');
  await b('eval', `(()=>{window.__goalTest.failEvidence=false;document.querySelector('[aria-label="目标现状"] [role="alert"] button').click();return true;})()`);
  await check('document.querySelector(\'[aria-label="目标现状"]\')?.innerText.includes("证据笔记")','读取失败后可重试');
  await b('eval', `(async()=>{
    const React=(await import('/node_modules/.vite/deps/react.js')).default;
    const {ReviewFactsView}=await import('/src/ui/workspace/ReviewFactsView.tsx');
    const {defaultReviewSchedule,indexNoteProjects}=await import('/src/domain/reviewReminder.ts');
    window.__goalTest.renderScoped=(scope,projects,status='ready')=>{
      const goals=[{id:'archived',title:'封存项目目标',doneCriteria:'完成',scope:'gone',createdAt:1,achievedAt:null,abandonedAt:null,reviewNote:'',evidenceCount:1}];
      const staleReferences=[{noteId:'n1',title:'共享笔记引用',status:'changed'}];
      const noteProject=indexNoteProjects([['n1','p1'],['n1','p2']]);
      const factDate=new Date();
      factDate.setHours(0,0,0,0);
      factDate.setDate(factDate.getDate()-((factDate.getDay()+6)%7));
      const factAt=factDate.getTime();
      const notes=[
        {id:'n1',title:'共享项目复盘笔记',bodyMd:'',notebook:null,tags:[],isPinned:false,isFavorite:false,archivedAt:null,sourceMaterialId:'m1',currentRevision:1,createdAt:factAt,updatedAt:factAt,isDeleted:false,deletedAt:null},
        {id:'n2',title:'项目二复盘笔记',bodyMd:'',notebook:null,tags:[],isPinned:false,isFavorite:false,archivedAt:null,sourceMaterialId:'m2',currentRevision:1,createdAt:factAt,updatedAt:factAt,isDeleted:false,deletedAt:null}
      ];
      const noteProjects=indexNoteProjects([['n1','p1'],['n1','p2'],['n2','p2']]);
      const materials=[
        {id:'m1',sourceType:'manual',title:'项目一素材',createdAt:factAt},
        {id:'m2',sourceType:'manual',title:'项目二素材',createdAt:factAt}
      ];
      const cards=[
        {id:'c1',headline:'项目一卡片',createdAt:factAt,lastReviewedAt:factAt,materialId:'m1'},
        {id:'c2',headline:'项目二卡片',createdAt:factAt,lastReviewedAt:factAt,materialId:'m2'}
      ];
      const factStatus=status==='ready'&&!scope.every(id=>projects.some(p=>p.id===id))?'unavailable':status;
      const selectedNotes=factStatus==='ready'?notes.filter(n=>(noteProjects.get(n.id)||[]).some(id=>scope.includes(id))):null;
      const projectNoteIds=selectedNotes?new Set(selectedNotes.map(n=>n.id)):null;
      const projectMaterialIds=selectedNotes?new Set(selectedNotes.map(n=>n.sourceMaterialId).filter(Boolean)):null;
      const projectCardIds=projectMaterialIds?new Set(cards.filter(c=>projectMaterialIds.has(c.materialId)).map(c=>c.id)):null;
      const reminders=window.__reminders({goals,notes:[],materials:[],staleReferences,projectScope:scope,noteProject,activeProjectIds:new Set(projects.map(p=>p.id))});
      document.querySelector('[aria-label="复盘周期"] button:nth-child(2)')?.click();
      return window.__goalTest.reviewRoot.render(React.createElement(ReviewFactsView,{
      dir:'/test/library',materials,notes:factStatus==='ready'?notes:null,cards,goals,
      projectFactsStatus:factStatus,projectNoteIds,projectMaterialIds,projectCardIds,
      projects, projectIndexStatus:status, schedule:{...defaultReviewSchedule,projectScope:scope}, reminders, noteProject,
      onScheduleChange:next=>window.__goalTest.nextScope=next.projectScope,
      onEnableSystemNotifications:async()=>false,
      onOpenMaterial:()=>{},onOpenCard:()=>{},onOpenNote:id=>window.__goalTest.opened='note:'+id
    }));};
    window.__goalTest.renderScoped(['p1'],[{id:'p1',name:'项目一'},{id:'p2',name:'项目二'}]);return true;
  })()`);
  await check('document.querySelector("[data-reminders]")?.innerText.includes("共享笔记引用")','共享笔记在第一个所属项目可回顾');
  await check('document.querySelector("[data-fact=notes] strong")?.textContent==="1" && document.querySelector("[data-fact=materials] strong")?.textContent==="1" && document.querySelector("[data-fact=cards] strong")?.textContent==="1"','项目复盘只统计成员笔记及其来源素材和卡片');
  await b('eval', `(()=>{[...document.querySelectorAll('[aria-label="记录事实"] button.rv-source-link')].find(b=>b.textContent==='共享项目复盘笔记').click();return true;})()`);
  await check('window.__goalTest.opened === "note:n1"','项目周期笔记可点击回到原件');
  await b('eval', `(()=>{window.__goalTest.renderScoped(['p2'],[{id:'p1',name:'项目一'},{id:'p2',name:'项目二'}]);return true;})()`);
  await check('document.querySelector("[data-reminders]")?.innerText.includes("共享笔记引用")','共享笔记在第二个所属项目可回顾');
  await check('document.querySelector("[data-fact=notes] strong")?.textContent==="2" && document.querySelector("[data-fact=materials] strong")?.textContent==="2" && document.querySelector("[data-fact=cards] strong")?.textContent==="2"','共享笔记可同时计入每个所属项目');
  await b('eval', `(()=>{window.__goalTest.renderScoped(['gone'],[]);return true;})()`);
  await check('document.querySelector(\'input[aria-label="移除不可用项目 gone"]\')?.checked && document.body.innerText.includes("已封存、删除或暂时无法读取")','已选项目不可用时范围仍可见');
  await check('document.querySelector("[data-fact=notes] strong")?.textContent==="—" && document.querySelector("[data-fact=materials] strong")?.textContent==="—" && document.body.innerText.includes("项目事实计数暂不显示")','已封存或删除项目不会把空归属伪装成零条事实');
  await check('!document.querySelector("[data-reminders]")?.innerText.includes("封存项目目标")','封存项目目标不进入提醒');
  await b('eval', `(()=>{document.querySelector('input[aria-label="移除不可用项目 gone"]').scrollIntoView({block:'center'});return true;})()`);
  await b('click', 'input[aria-label="移除不可用项目 gone"]');
  await check('Array.isArray(window.__goalTest.nextScope) && window.__goalTest.nextScope.length===0','用户可移除最后一个不可用项目');
  await b('eval', `(()=>{window.__goalTest.renderScoped(['gone'],[],'error');return true;})()`);
  await check('document.querySelector(\'[aria-label="主动回顾"]\')?.innerText.includes("项目归属读取失败") && !document.querySelector(\'[aria-label="主动回顾"]\')?.innerText.includes("没有需要你动手的事")','项目归属读取失败不会误报没有事项');
  console.log('目标项目归属 smoke 完成。');
} finally { await b('close').catch(()=>{}); }
