import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
// Optional integration check: requires a local Codex CLI with app-server support.
// It overrides the MCP server map for this process and uses only a synthetic library.
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server=path.resolve(process.argv[2] ?? path.join(root,'tools/mcp-server.mjs'));
const scratch=path.join(root,'.scratch/mcp-migration');
fs.mkdirSync(scratch,{recursive:true});
const dir=fs.mkdtempSync(path.join(scratch,'client-'));
const token='a'.repeat(64), source=fs.readFileSync('apps/workbench/src-tauri/src/db.rs','utf8');
const table=n=>source.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${n} \\([\\s\\S]*?\\n\\s*\\);`))[0];
fs.writeFileSync(path.join(dir,'settings.json'),'{}');
const db=new DatabaseSync(path.join(dir,'knowflick.db'));
db.exec(['projects','materials','notes','project_members','mcp_grants','mcp_audit','cards','artifacts'].map(table).join('\n'));
db.exec(`CREATE VIRTUAL TABLE fts_cards USING fts5(card_id, headline, summary, details, category, tags); CREATE VIRTUAL TABLE fts_materials USING fts5(material_id, title, raw_text, source_url); INSERT INTO projects(id,name,created_at,updated_at) VALUES ('a','A',1,1),('b','B',1,1); INSERT INTO notes(id,title,body_md,created_at,updated_at) VALUES ('a1','A 原文','共同词 项目 A 内容',1,1),('b1','B 秘密','共同词 项目 B 内容',1,1); INSERT INTO project_members VALUES ('a','a1',1),('b','b1',1);`);
db.prepare("INSERT INTO mcp_grants (id, client_label, scope, project_id, token_hash, library_read, card_write, material_write, created_at, policy_version) VALUES ('ga', 'test', 'project', 'a', ?, 0, 0, 0, 1, 1)").run(createHash('sha256').update(token).digest('hex'));
const config=`mcp_servers={kf_test={command=${JSON.stringify(process.execPath)},args=[${JSON.stringify(server)},"--dir",${JSON.stringify(dir)}],env={KNOWFLICK_MCP_TOKEN=${JSON.stringify(token)}}}}`;
const proc=spawn('codex',['app-server','--listen','stdio://','-c',config],{stdio:['pipe','pipe','pipe']});
let id=0; const pending=new Map(); let stderr='', failure;
proc.stderr.on('data',c=>{stderr=(stderr+c.toString()).slice(-4000);});
const exited=new Promise(resolve=>{
  proc.once('error',error=>{failure=error;resolve();});
  proc.once('exit',()=>resolve());
}).then(()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(failure ?? new Error('Codex app-server exited'));} pending.clear();});
createInterface({input:proc.stdout}).on('line',line=>{let msg;try{msg=JSON.parse(line);}catch{return;} if(pending.has(msg.id)){const p=pending.get(msg.id);pending.delete(msg.id);clearTimeout(p.timer);p.resolve(msg);}});
function rpc(method,params){let n=++id;return new Promise((resolve,reject)=>{let timer=setTimeout(()=>{pending.delete(n);reject(new Error(method+' timeout'));},30000);pending.set(n,{resolve,reject,timer});proc.stdin.write(JSON.stringify({id:n,method,params})+'\n');});}
try {
 let init=await rpc('initialize',{clientInfo:{name:'knowflick-test',version:'1'},capabilities:{experimentalApi:true}}); assert.ok(init.result,JSON.stringify(init.error)); proc.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
 let status=await rpc('mcpServerStatus/list',{serverName:'kf_test'}); assert.deepEqual(Object.keys(status.result?.data?.[0]?.tools ?? {}),['search_project_notes']);
 let thread=await rpc('thread/start',{cwd:dir,ephemeral:true}); if(!thread.result) throw Error('thread: '+JSON.stringify(thread.error));
 let tid=thread.result.thread.id;
 let result=await rpc('mcpServer/tool/call',{threadId:tid,server:'kf_test',tool:'search_project_notes',arguments:{query:'共同词'}});
 if(!result.result) throw Error('tool call failed');
 assert.match(JSON.stringify(result.result),/a1/); assert.doesNotMatch(JSON.stringify(result.result),/b1/);
 db.prepare("UPDATE mcp_grants SET revoked_at=2 WHERE id='ga'").run();
 let revoked=await rpc('mcpServer/tool/call',{threadId:tid,server:'kf_test',tool:'search_project_notes',arguments:{query:'共同词'}}); assert.ok(revoked.error || revoked.result?.isError); console.log('PASS: Codex MCP 客户端隔离项目并在撤销后拒绝访问');
} catch(error) { if(stderr) console.error(stderr.replaceAll(token,'[test token]').slice(-1500)); throw error;
} finally {proc.stdin.end();proc.kill();await exited;db.close();fs.rmSync(dir,{recursive:true,force:true});}
