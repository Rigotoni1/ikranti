import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const nativeRequire=createRequire(import.meta.url);
function load(file,overrides={}) {
 const compiled=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};
 new Function('require','module','exports',compiled)(name=>name.endsWith('.css')?{}:overrides[name]||nativeRequire(name),module,module.exports);
 return module.exports;
}
const terms=load('../lib/terms.ts');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
// Exercise actual component handlers with deterministic hooks, without a browser or live accounts.
function harness({documents=[],details={},type='buyer',onDocumentsSaved=async()=>{}}={}) {
 const cells=[];let cursor=0;const calls=[];
 const state=initial=>{const index=cursor++;if(!(index in cells))cells[index]=typeof initial==='function'?initial():initial;return [cells[index],value=>{cells[index]=typeof value==='function'?value(cells[index]):value;}];};
 const client={auth:{getSession:async()=>({data:{session:{access_token:'test-only-token'}}})},rpc:async(name,args)=>{calls.push({name,args});return {error:null};}};
 const {Onboarding}=load('../app/account/onboarding.tsx',{'react':{useState:state,useRef:initial=>state(()=>({current:initial}))[0]},'@/lib/terms':terms,'@/lib/supabase/browser':{browserClient:()=>client},'@/lib/supabase/config':{supabaseUrl:'https://upload.example.invalid'}});
 const props={type,record:{account_type:type,step:2,details,completed_at:null},documents,onDocumentsSaved,onComplete:async()=>{},onCancel:()=>{}};
 const tree=()=>{cursor=0;return Onboarding(props);};
 function nodes(node,result=[]) {if(Array.isArray(node))node.forEach(child=>nodes(child,result));else if(node&&typeof node==='object'&&node.props){result.push(node);nodes(node.props.children,result);}return result;}
 const find=predicate=>nodes(tree()).find(predicate);
 return {calls,html:()=>renderToStaticMarkup(tree()),file:()=>find(n=>n.type==='input'&&n.props.type==='file'),checkbox:()=>find(n=>n.type==='input'&&n.props.type==='checkbox'),form:()=>find(n=>n.type==='form'),continue:()=>find(n=>n.type==='button'&&n.props.className==='goldButton')};
}

test('verification has direct automatic upload, no defer/submit buttons and unchecked terms',()=>{
 const h=harness({details:{adult:'true'}});const html=h.html();
 assert.match(html,/Selecting a file uploads it immediately/);
 assert.match(html,/I confirm I have read the/);
 assert.match(html,/href="\/terms\/2026-09-22\.1" target="_blank"/);
 assert.doesNotMatch(html,/Maybe later|Submit for review|I confirm I am at least 18/);
 assert.equal(h.checkbox().props.checked,false);assert.equal(h.continue().props.disabled,true);
});

test('saved account documents are reused; property and business documents cannot substitute for ID',()=>{
 const h=harness({documents:[{kind:'identity',auction_id:null}]});
 assert.match(h.html(),/ID document saved privately/);
 h.checkbox().props.onChange({target:{checked:true}});assert.equal(h.continue().props.disabled,false);
 const unrelated=harness({documents:[{kind:'identity',auction_id:'a-lot'}]});
 unrelated.checkbox().props.onChange({target:{checked:true}});assert.equal(unrelated.continue().props.disabled,true);
 const business=harness({details:{business_name:'Example business'},documents:[{kind:'business'}]});
 business.checkbox().props.onChange({target:{checked:true}});assert.equal(business.continue().props.disabled,true);
 assert.match(business.html(),/ID document required/);
});

test('selecting a file uploads immediately, blocks continuation in flight and records terms only on continue',async t=>{
 let finish;let requests=0;let sent;
 t.mock.method(globalThis,'fetch',async(url,options)=>{requests++;sent=options;assert.match(url,/ir-launch-worker$/);return new Promise(resolve=>{finish=()=>resolve(Response.json({ok:true}));});});
 const h=harness();h.checkbox().props.onChange({target:{checked:true}});
 h.file().props.onChange({currentTarget:{files:[new File(['%PDF-test'],'identity.pdf',{type:'application/pdf'})]}});
 await tick();assert.equal(requests,1);assert.equal(sent.body.get('kind'),'identity');assert.equal(sent.headers.Authorization,'Bearer test-only-token');
 assert.equal(h.continue().props.disabled,true);assert.match(h.html(),/Uploading securely/);
 await h.form().props.onSubmit({preventDefault(){}});assert.equal(h.calls.length,0);
 finish();await tick();await tick();
 assert.match(h.html(),/Saved privately: identity.pdf/);assert.equal(h.continue().props.disabled,false);
 await h.form().props.onSubmit({preventDefault(){}});
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].args.p_details.terms_version,terms.TERMS_VERSION);assert.equal(h.calls[0].args.p_details.terms_accepted,'true');assert.equal(h.calls[0].args.p_step,3);
 assert.equal(h.calls[0].args.p_details.adult,undefined);
});

test('failed or invalid uploads never unlock continuation or claim success',async t=>{
 let requests=0;t.mock.method(globalThis,'fetch',async()=>{requests++;return Response.json({error:'Upload unavailable'},{status:503});});
 const h=harness();h.checkbox().props.onChange({target:{checked:true}});
 h.file().props.onChange({currentTarget:{files:[new File(['bad'],'bad.txt',{type:'text/plain'})]}});
 await tick();assert.equal(requests,0);assert.match(h.html(),/This file has not been saved/);
 h.file().props.onChange({currentTarget:{files:[new File(['%PDF-test'],'id.pdf',{type:'application/pdf'})]}});
 await tick();await tick();assert.equal(requests,1);assert.match(h.html(),/Upload unavailable/);assert.match(h.html(),/Retry upload/);
 assert.equal(h.continue().props.disabled,true);assert.doesNotMatch(h.html(),/Saved privately:/);
});

test('terms page identifies the operator and both payment deadlines without waiving consumer rights',()=>{
 const {default:TermsPage}=load('../app/terms/2026-09-22.1/page.tsx',{'../../brand-logo':load('../app/brand-logo.tsx')});const html=renderToStaticMarkup(TermsPage());
 assert.match(html,/Luca Arrigo, Ogirra, Triq Il Kaffis, Swieqi/);
 assert.match(html,/10% of the final winning price on the day the auction closes/);
 assert.match(html,/within 30 calendar days after the closing date/);
 assert.match(html,/These terms do not exclude mandatory consumer protections/);
 assert.match(html,/separate legal documents/);
 const migration=readFileSync(new URL('../supabase/migrations/20260922134003_buyer_only_staff_inventory.sql',import.meta.url),'utf8');
 assert.ok(migration.includes(`current_terms constant text:='${terms.TERMS_VERSION}'`));
});
