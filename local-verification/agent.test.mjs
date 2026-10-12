import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const combined=await build({stdin:{contents: ['context','storage','provider','chat','panel','markdown','vision','math','citations','evidence'].map(name=>`export * from "./src/modules/agent/${name}.ts";`).join('\n'),resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'esm',write:false,plugins:[{name:'prefs',setup(b){b.onResolve({filter:/utils\/prefs$/},a=>({path:a.path,namespace:'prefs'}));b.onLoad({filter:/.*/,namespace:'prefs'},()=>({contents:'export const getPref=k=>globalThis.prefs[k]; export const setPref=(k,v)=>globalThis.prefs[k]=v;'}));}}]});writeFileSync(new URL('.agent-all.mjs',import.meta.url),combined.outputFiles[0].text);
const context=await import('./.agent-all.mjs');
assert.ok(context.splitSource('pdf','x'.repeat(4000),'A').length===3);
assert.equal(context.searchChunks([{id:'a',source:'pdf',text:'river mercury coastal oceans'},{id:'b',source:'pdf',text:'unrelated methods'}],'mercury')[0].id,'a');
const {window}=new JSDOM('<div id="panel"></div>',{pretendToBeVisual:true});
window.confirm=()=>true;window.AbortController=AbortController;
const disk=new Map(),stats=new Map([['/first.pdf',{lastModified:1,size:4000}],['/second.pdf',{lastModified:1,size:4000}]]);
const items=new Map();let extracted=0,requests=[];let responseMode='normal';let toolIssued=false;let noteID=100;
const pdf=(id,key,file,text)=>({id,key,parentID:1,libraryID:1,dateModified:'1',isAttachment:()=>true,isRegularItem:()=>false,attachmentContentType:'application/pdf',getFilePathAsync:async()=>file,getField:()=>key,getAnnotations:()=>[],get attachmentText(){extracted++;return Promise.resolve(text);}});
const p1=pdf(2,'AAA','/first.pdf','Mercury is a potent neurotoxic substance. Rivers export mercury to coastal oceans. '.repeat(45));
const p2=pdf(3,'BBB','/second.pdf','Supplementary material: estimation method and uncertainty. '.repeat(45));
const note={id:4,key:'NOTE',dateModified:'1',getField:()=> 'Lab note',getNote:()=>'<p>Compare river contributions</p>'};
const parent={id:1,key:'ROOT',libraryID:1,parentID:false,isAttachment:()=>false,isRegularItem:()=>true,getAttachments:()=>[2,3],getNotes:()=>[4],getCreators:()=>[],getField:k=>k==='title'?'River mercury paper':k==='abstractNote'?'Rivers are an important mercury source.':''};
const other={...parent,id:10,key:'OTHER',getAttachments:()=>[],getNotes:()=>[]};
for(const item of [parent,p1,p2,note,other])items.set(item.id,item);
globalThis.prefs={};
const IOUtils={makeDirectory:async()=>{},readJSON:async path=>{if(path.endsWith('/.pi/agent/models.json'))return {providers:{'cpa-server':{baseUrl:'https://cpa.test/v1',apiKey:'test-only-key'}}};if(!disk.has(path))throw Error('missing');return structuredClone(disk.get(path));},writeJSON:async(path,value)=>disk.set(path,structuredClone(value)),writeUTF8:async(path,s)=>disk.set(path,JSON.parse(s)),stat:async(path)=>{if(!stats.has(path))throw Error();return stats.get(path)}};
const Services={dirsvc:{get:()=>({path:'/user'})},logins:{findLogins:()=>[]}};
globalThis.ztoolkit={getGlobal:k=>({IOUtils,Services,Components:{interfaces:{nsIFile:{}}}})[k]};
globalThis.Zotero={DataDirectory:{dir:'/data'},getMainWindow:()=>window,Utilities:{randomString:()=>Math.random().toString(36).slice(2,8)},Items:{get:id=>Array.isArray(id)?id.map(i=>items.get(i)):items.get(id)},HTTP:{request:async(method,url,options)=>{
 if(method==='GET')return {response:{data:[{id:'gemini-3.8-flash-high'}]}};
 const body=JSON.parse(options.body);requests.push(body);let result;
 if(body.messages[0].content.includes('压缩为'))result=[{choices:[{delta:{content:'Old conversation summary'}}]}];
 else if(responseMode==='tool'&&!toolIssued&&body.tools){toolIssued=true;result=[{choices:[{delta:{tool_calls:[{index:0,id:'call1',type:'function',function:{name:'search_item',arguments:'{"query":"mercury"}'}}]}}]}];}
 else result=[{choices:[{delta:{content:'Rivers contribute '}}]},{choices:[{delta:{content:'mercury [PDFAAA-1].'}}]}];
 const full=result.map(e=>'data: '+JSON.stringify(e)+'\r\n\r\n').join('')+'data: [DONE]\r\n\r\n';
 return new Promise((resolve,reject)=>{const xhr={status:200,responseText:'',abort(){reject({status:0})}};options.requestObserver(xhr);let at=0;function step(){if(responseMode==='hold')return;xhr.responseText+=full.slice(at,at+13);at+=13;xhr.onprogress?.();if(at<full.length)setTimeout(step,0);else resolve({responseText:xhr.responseText});}queueMicrotask(step);});
}}};
const storage=await import('./.agent-all.mjs');
assert.equal(storage.rootItem(p1),parent);
const corpus=await storage.getCorpus(parent);assert.equal(corpus.pdfCount,2);assert.equal(extracted,2);assert.ok(corpus.chunks.some(c=>c.id.startsWith('NOTENOTE')));
await storage.getCorpus(parent);assert.equal(extracted,2,'cached turn must not reread PDFs');
note.dateModified='2';await storage.getCorpus(parent);assert.equal(extracted,2,'note changes must reuse PDF cache');
stats.set('/first.pdf',{lastModified:2,size:4001});await storage.getCorpus(parent);assert.equal(extracted,3,'only changed PDF is extracted');
const chats=await storage.loadChats(parent),separate=await storage.loadChats(other);assert.notEqual(chats.current,separate.current);
const c=storage.newConversation();chats.conversations.push(c);chats.current=c.id;await storage.saveChats(parent,chats);assert.ok(disk.get('/data/translate-agent/chats-1-ROOT.json').conversations.length===2);
const {SSEDecoder}=await import('./.agent-all.mjs');const decoder=new SSEDecoder();assert.equal(decoder.push('data: {"choices":').length,0);assert.equal(decoder.push('[]}\r\n\r\n')[0].choices.length,0);
const chat=await import('./.agent-all.mjs');const state=await storage.loadChats(parent);const cc=state.conversations[0];responseMode='tool';await chat.sendChat(parent,cc,'How much mercury comes from rivers?');assert.ok(requests.some(r=>r.messages.some(m=>m.role==='tool')),'model may retrieve local sources');assert.equal(chat.activity(parent,cc.id),'');assert.equal(cc.messages.at(-1).status,'complete');
const selected=storage.newConversation();state.conversations.push(selected);const before=extracted;await chat.sendChat(parent,selected,'Explain this','Only this selected sentence');assert.equal(extracted,before);assert.ok(requests.at(-1).tools?.some(t=>t.function.name==='search_item'),'quoted selection retains item tools');assert.ok(requests.at(-1).messages[0].content.includes('Supplementary material'));assert.ok(requests.at(-1).messages[0].content.includes('Only this selected sentence'));
responseMode='hold';const interrupted=storage.newConversation();state.conversations.push(interrupted);const pending=chat.sendChat(parent,interrupted,'Stop this','selection');await new Promise(r=>setTimeout(r,20));chat.stopChat(parent,interrupted.id);await pending;assert.equal(interrupted.messages.at(-1).status,'stopped');responseMode='normal';
const long=storage.newConversation();state.conversations.push(long);for(let i=0;i<16;i++)long.messages.push({role:i%2?'assistant':'user',content:'old turn '+i,created:i});await chat.sendChat(parent,long,'Continue','selection');assert.ok(long.summary.includes('summary'));assert.ok(long.summarized>0);assert.ok(context.recentHistory(long).length<=10);
globalThis.Zotero.Item=class{addTag(){}setNote(html){this.html=html;}async saveTx(){items.set(++noteID,this);return noteID;}};
const saved=await chat.saveAnswerNote(parent,selected,{role:'assistant',content:'<img src=x onerror=alert(1)>',created:Date.now()});assert.equal(items.get(saved).parentID,1);assert.ok(items.get(saved).html.includes('&lt;img'));
const {AgentPanel}=await import('./.agent-all.mjs');const panel=new AgentPanel(window.document.getElementById('panel'));await panel.setItem(parent);assert.ok(window.document.querySelector('[aria-label="提问"]'));assert.ok(window.document.querySelector('[aria-label="对话列表"]'));await panel.setItem(other);assert.ok(window.document.querySelector('.agent-welcome'));chat.selections.set('1-OTHER',{text:'A selected sentence',attachmentID:2});chat.changed();await new Promise(r=>setTimeout(r,25));assert.match(window.document.querySelector('.agent-selected').textContent,/A selected sentence/);assert.equal(window.document.querySelector('[aria-label="阅读范围"]'),null);
const fontControl=window.document.querySelector('[aria-label="字体大小"]');fontControl.value='18';fontControl.dispatchEvent(new window.Event('input'));assert.equal(prefs['agent.fontSize'],18);assert.equal(window.document.querySelector('.agent-pane').style.getPropertyValue('--agent-font-size'),'18px');
window.document.querySelector('[data-action="models"]').click();assert.equal(window.document.querySelector('.agent-model-popover').hidden,false);assert.ok(window.document.querySelector('[role="menuitemradio"][aria-checked="true"]'));const modelSearch=window.document.querySelector('[aria-label="搜索模型"]');modelSearch.value='not-a-model';modelSearch.dispatchEvent(new window.Event('input'));assert.match(window.document.querySelector('.agent-model-list').textContent,/没有匹配/);window.document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape'}));assert.equal(window.document.querySelector('.agent-model-popover').hidden,true);
state.current=cc.id;await storage.saveChats(parent,state);await panel.setItem(parent);const prose=window.document.querySelector('.agent-prose');assert.ok(prose);const selectionRange=window.document.createRange();selectionRange.selectNodeContents(prose);window.getSelection().removeAllRanges();window.getSelection().addRange(selectionRange);assert.ok(window.getSelection().toString(),"initial selection");chat.changed();await new Promise(r=>setTimeout(r,25));assert.equal(window.document.querySelector('.agent-prose'),prose,'background events must preserve selected message nodes');assert.ok(window.getSelection().toString());let clipboardText='';ztoolkit.Clipboard=class {addText(s){clipboardText=s;return this;}copy(){}};prose.dispatchEvent(new window.MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:20,clientY:20}));window.document.querySelector('.agent-copy-menu button').click();assert.equal(clipboardText,window.getSelection().toString());window.getSelection().removeAllRanges();panel.dispose();const reopenedPanel=new AgentPanel(window.document.getElementById('panel'));assert.equal(window.document.querySelector('[aria-label="字体大小"]').value,'18');reopenedPanel.dispose();
const rendered=window.document.createElement('div');context.renderMarkdown(window.document,rendered,'## Conclusion\n\n**strong** and `code`\n\n- item\n\n<img src=x onerror=alert(1)>\n\n| A | B |\n| --- | --- |\n| 1 | 2 |');assert.equal(rendered.querySelector('strong').textContent,'strong');assert.ok(rendered.querySelector('table'));assert.equal(rendered.querySelector('img'),null);
const pages=context.splitPDF('PDF','first page\fsecond page','KEY');assert.equal(pages[1].pageIndex,1);assert.equal(pages[1].attachmentKey,'KEY');
let renderedPages=0;Zotero.Utilities.Internal={md5:s=>createHash('md5').update(s).digest('hex')};Zotero.Items.getByLibraryAndKey=(_lib,key)=>[...items.values()].find(i=>i.key===key);IOUtils.read=async()=>new Uint8Array([1,2,3]);Zotero.PDFWorker={_enqueue:job=>job(),_query:async()=>{renderedPages++;return {buf:new Uint8Array([137,80,78,71]).buffer};}};
const currentCorpus=await storage.getCorpus(parent);const imageA=await context.readPDFPage(parent,currentCorpus,'AAA',1);assert.ok(imageA.image.startsWith('data:image/png;base64,'));await context.readPDFPage(parent,currentCorpus,'AAA',1);assert.equal(renderedPages,1,'repeat visual reads use page cache');await assert.rejects(()=>context.readPDFPage(parent,currentCorpus,'FOREIGN',1));const changedCorpus={...currentCorpus,pdfStamps:{...currentCorpus.pdfStamps,AAA:'updated'}};await context.readPDFPage(parent,changedCorpus,'AAA',1);assert.equal(renderedPages,2,'modified PDF invalidates page image');assert.equal(context.splitPDF('scan','','SCAN',3).length,3,'scanned page still has a readable image index');
console.log('PASS: all-PDF corpus, incremental PDF/notes cache, item isolation, multiple persisted chats, fragmented SSE, local tool loop, automatic selection with item context, safe Markdown and PDF page mapping, cancellation, history compression, safe child-note creation and panel item switching.');

const mathTest=window.document.createElement('div');window.document.body.append(mathTest);context.renderMarkdown(window.document,mathTest,String.raw`单位 $\mathrm{ng\,m^{-3}\,yr^{-1}}$ 与 **$\mathrm{Hg}^{II}$**，行内 \(\frac{a}{b}\)。

$$
F=\sum_{i=1}^{n} Q_i C_i
$$

\[
\begin{pmatrix}a&b\\c&d\end{pmatrix}
\]

`+'`$literal$`');assert.equal(mathTest.querySelectorAll('math').length,5);assert.equal(mathTest.querySelectorAll('annotation').length,0);assert.ok(mathTest.querySelector('mfrac'));assert.ok(mathTest.querySelector('mtable'));const eq=mathTest.querySelector('.agent-math');const equationPayload=context.equationClipboard(window.document,eq);assert.match(equationPayload.plain,/<math xmlns="http:\/\/www.w3.org\/1998\/Math\/MathML"/);assert.ok(!equationPayload.plain.includes('data-latex'));const mathRange=window.document.createRange();mathRange.selectNodeContents(mathTest);window.getSelection().removeAllRanges();window.getSelection().addRange(mathRange);const mixedPayload=context.selectionClipboard(window.document,window.getSelection());assert.ok(mixedPayload.html.includes('<mfrac>'));assert.ok(!mixedPayload.html.includes('annotation'));assert.match(mixedPayload.plain,/单位/);window.getSelection().removeAllRanges();console.log('PASS: inline/display MathML, units, matrices, nested bold math, literal code and structured equation/mixed selection clipboard.');

const partialMath=mathTest.querySelector('msup mi')||mathTest.querySelector('mi');const partialRange=window.document.createRange();partialRange.selectNodeContents(partialMath);window.getSelection().addRange(partialRange);assert.match(context.selectionClipboard(window.document,window.getSelection()).plain,/<math/);window.getSelection().removeAllRanges();const unsafeMath=context.mathElement(window.document,String.raw`\href{javascript:alert(1)}{x}`);assert.equal(unsafeMath.querySelector('a'),null);assert.equal(unsafeMath.querySelector('script'),null);

let openedPDF, navigated;const citationText='River mercury exports to coastal oceans are an important input and this sentence locates the reference.';const citationChars=Array.from(citationText).map((c,i)=>({u:c,rect:[i*5,100,i*5+5,110]}));Zotero.Reader={open:async(id,location)=>{openedPDF={id,location};return {_internalReader:{_primaryView:{_iframeWindow:{PDFViewerApplication:{pdfDocument:{getPageData:async()=>({chars:citationChars})}}}}},navigate:async location=>navigated=location}}};const citationSource={id:'PDFPKEYP3-1',source:'PDF',text:citationText,attachmentKey:'AAA',pageIndex:2};const opened=await context.openCitation(parent,citationSource.id,[citationSource]);assert.equal(openedPDF.id,2);assert.equal(openedPDF.location.pageIndex,2);assert.equal(navigated.position.pageIndex,2);assert.ok(navigated.position.rects.length);assert.equal(opened.located,true);await assert.rejects(()=>context.openCitation(other,citationSource.id,[citationSource]),/不属于/);assert.deepEqual(context.sourceRects(citationChars,'unrelated fragment without a shared contiguous passage'),[]);context.renderMarkdown(window.document,mathTest,'[PDFPKEYP3-1, PDFPKEYP3-2]',id=>{const a=window.document.createElement('a');a.dataset.sourceId=id;a.textContent=id;return a;});assert.equal(mathTest.querySelectorAll('a').length,2);assert.match(mathTest.textContent,/PDFPKEYP3-1, PDFPKEYP3-2/);console.log('PASS: grouped citation links, attachment ownership, PDF page navigation and temporary source coordinates.');

const exactA='The river mercury input is approximately thirty two times atmospheric deposition.';
const exactB='Supplementary uncertainty estimates account for changes in seasonal river discharge.';
const full='NATURE GEOSCIENCE HEADER '+exactA+' Fig. 2 | Mercury inputs into coastal oceans from external sources. '+exactB;
const chars=Array.from(full).map((u,i)=>({u,rect:[i,10,i+1,20]}));
assert.equal(context.sourceRects(chars,exactA)[0][0],full.indexOf(exactA));
assert.equal(context.sourceRects(chars,exactB)[0][0],full.indexOf(exactB));
assert.deepEqual(context.sourceRects(chars,full+' invented continuation'),[]);
assert.deepEqual(context.sourceRects([...chars,...chars],exactA),[]);
const groundingCorpus={chunks:[{id:'PDFBBBP2-1',attachmentKey:'BBB',pageIndex:1,source:'Supplementary PDF',text:full}],pdfStamps:{BBB:'stamp'}};
const grounded=context.registerEvidence(groundingCorpus,groundingCorpus.chunks[0],{kind:'text',quote:exactB},new Set());
assert.equal(grounded.attachmentKey,'BBB');assert.equal(grounded.pageIndex,1);assert.match(grounded.id,/-T[A-F0-9]+$/);assert.equal(grounded.anchor.quote,exactB);
assert.throws(()=>context.registerEvidence(groundingCorpus,groundingCorpus.chunks[0],{kind:'text',quote:exactB.replace('seasonal','annual')},new Set()),/逐字/);
const fig={kind:'figure',quote:'Fig. 2 | Mercury inputs into coastal oceans from external sources.',figure_label:'Fig. 2',region:[.1,.2,.9,.7]};
assert.throws(()=>context.registerEvidence(groundingCorpus,groundingCorpus.chunks[0],fig,new Set()),/实际读取/);
const figure=context.registerEvidence(groundingCorpus,groundingCorpus.chunks[0],fig,new Set(['BBB:2']));assert.equal(figure.anchor.kind,'figure');
assert.throws(()=>context.registerEvidence(groundingCorpus,groundingCorpus.chunks[0],{...fig,region:[0,0,1,1]},new Set(['BBB:2'])),/整页/);
assert.throws(()=>context.registerEvidence(groundingCorpus,groundingCorpus.chunks[0],{...fig,figure_label:'Fig. 3'},new Set(['BBB:2'])),/图号/);
assert.deepEqual(context.figureRects([.1,.2,.9,.7],[0,0,600,800]),[[60,240,540,640]]);
context.renderMarkdown(window.document,mathTest,`[${grounded.id}, ${figure.id}]`,id=>{const a=window.document.createElement('a');a.textContent=id;return a;});assert.equal(mathTest.querySelectorAll('a').length,2);
console.log('PASS: exact distinct passages, ambiguous and invented quote rejection, supplementary PDF provenance, viewed-figure and caption validation, image coordinates, evidence links.');

let delayedReader;Zotero.Reader.open=async()=>{delayedReader={itemID:2,_isTabClosed:false,_initPromise:Promise.resolve().then(()=>{delayedReader._internalReader={_primaryView:{_pdfPages:{2:{chars:citationChars}}}}}),navigate:async l=>navigated=l};return delayedReader;};assert.equal((await context.openCitation(parent,citationSource.id,[citationSource])).located,true);
Zotero.Reader._readers=[delayedReader];Zotero.Reader.open=async()=>undefined;assert.equal((await context.openCitation(parent,citationSource.id,[citationSource])).located,true);
console.log('PASS: newly opened and restored attachment readers wait for initialization before exact text navigation.');

assert.equal(context.evidenceStamp('["BBB",123,456,"old metadata"]'),context.evidenceStamp('["BBB",123,456,"new metadata"]'));assert.notEqual(context.evidenceStamp('["BBB",123,456,"same"]'),context.evidenceStamp('["BBB",999,456,"same"]'));console.log('PASS: PDF content stamps ignore attachment metadata changes but detect modified files.');

const subCorpus={...groundingCorpus,chunks:[{...groundingCorpus.chunks[0],text:'Fig. 2 | Mercury inputs into coastal oceans from external sources. b, Comparison of input rates of Hg between coastal and open oceans.'}]};assert.equal(context.registerEvidence(subCorpus,subCorpus.chunks[0],{...fig,quote:subCorpus.chunks[0].text,figure_label:'Figure 2b'},new Set(['BBB:2'])).anchor.figureLabel,'Figure 2b');assert.throws(()=>context.registerEvidence(subCorpus,subCorpus.chunks[0],{...fig,quote:subCorpus.chunks[0].text,figure_label:'Fig. 2c'},new Set(['BBB:2'])),/子图/);console.log('PASS: figure/subfigure caption matching accepts Fig. 2b with its b caption and rejects absent panels.');
