const STORE_KEY = 'manualPollBudgetOneTable_status_v2';
const LEGACY_MIGRATION_FLAG = 'oprosyPro_serverMigration_v2_done';
let state = {users:[]};
let activeUserId = '';
let generalMode = false;
let appReady = false;
let saveTimer = null;
const reportSaveQueues = new Map();

function uid(){ return Date.now() + '-' + Math.random().toString(36).slice(2,10); }
function today(){ return new Date().toLocaleDateString('ru-RU'); }

async function appApi(action, payload={}){
  const res = await fetch('/api/app', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    credentials:'same-origin',
    body:JSON.stringify({action, ...payload})
  });
  const data = await res.json().catch(()=>({error:'Bad JSON'}));
  if(!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
}

async function initApp(){
  try{
    let data = await appApi('listWorkspace');
    if(await maybeMigrateLegacyState(data)) data = await appApi('listWorkspace');
    state = {users:data.users || []};
    const currentId = window.currentAuthUser?.id || data.currentUser?.id || '';
    if(!activeUserId || !state.users.some(u=>u.id===activeUserId)){
      activeUserId = state.users.some(u=>u.id===currentId) ? currentId : (state.users[0]?.id || '');
    }
    state.users.forEach(u=>{
      if(!u.activeReportId || !u.reports.some(r=>r.id===u.activeReportId)) u.activeReportId = u.reports[0]?.id || '';
      u.reports.forEach(normalizeClientReport);
    });
    appReady = true;
    render();
  }catch(e){
    console.error(e);
    alert('Не удалось загрузить статистики: ' + e.message);
  }
}


async function maybeMigrateLegacyState(workspace){
  if(window.currentAuthUser?.role !== 'owner') return false;
  if(localStorage.getItem(LEGACY_MIGRATION_FLAG)) return false;
  const raw = localStorage.getItem(STORE_KEY);
  if(!raw){ localStorage.setItem(LEGACY_MIGRATION_FLAG,'no-data'); return false; }
  let legacy;
  try{ legacy=JSON.parse(raw); }catch(_){ localStorage.setItem(LEGACY_MIGRATION_FLAG,'bad-data'); return false; }
  const reportCount=(legacy.users||[]).reduce((sum,u)=>sum+(Array.isArray(u.reports)?u.reports.length:0),0);
  if(!reportCount){ localStorage.setItem(LEGACY_MIGRATION_FLAG,'empty'); return false; }
  const ok=confirm(`Найдены старые локальные статистики (${reportCount}). Перенести их на сервер?\n\nЕсли имена совпадут с уже зарегистрированными пользователями, статистики будут привязаны к ним. Остальные попадут owner с именем в названии.`);
  if(!ok){ localStorage.setItem(LEGACY_MIGRATION_FLAG,'skipped'); return false; }
  try{
    const result=await appApi('importLegacyState',{legacyState:legacy});
    localStorage.setItem(LEGACY_MIGRATION_FLAG,'done');
    alert(`Перенос завершён. Импортировано статистик: ${result.imported||0}`);
    return true;
  }catch(e){
    alert('Не удалось перенести старые данные: '+e.message);
    return false;
  }
}

function normalizeClientReport(r){
  r.vat = parseNumber(r.vat || 1.22) || 1.22;
  r.zoom = parseNumber(r.zoom || 0.8) || 0.8;
  r.visibility = r.visibility === 'private' ? 'private' : 'public';
  r.customColumns = Array.isArray(r.customColumns) ? r.customColumns.map(c=>({
    id:String(c.id||uid()),
    title:String(c.title||'Колонка'),
    width:Math.max(70,parseNumber(c.width||130)),
    type:c.type==='formula'?'formula':'manual',
    formula:String(c.formula||'').slice(0,1000),
    format:['text','number','money','percent'].includes(c.format)?c.format:(c.type==='formula'?'number':'text'),
    summary:['none','sum','avg','min','max','count','auto'].includes(c.summary)?c.summary:'auto',
    decimals:Math.max(0,Math.min(6,parseInt(c.decimals??2,10)||0))
  })) : [];
  r.columnWidths = r.columnWidths && typeof r.columnWidths==='object' ? r.columnWidths : {};
  r.rows = Array.isArray(r.rows) ? r.rows : [];
  r.rows = r.rows.map(row=>normalizeClientRow(row,r.vat));
  return r;
}

function normalizeClientRow(row,vat=1.22){
  const coef=parseNumber(vat)||1.22;
  if(row.spentNet === undefined || row.spentNet === null){
    if(row.spentVat !== undefined && row.spentVat !== null) row.spentNet=coef>0?parseNumber(row.spentVat)/coef:parseNumber(row.spentVat);
    else row.spentNet=parseNumber(row.spent);
  }
  row.impressions = parseNumber(row.impressions);
  row.clicks = parseNumber(row.clicks);
  row.collected = parseNumber(row.collected);
  row.spentNet = parseNumber(row.spentNet);
  row.need = parseNumber(row.need);
  row.status = row.status || 'РАБОТАЕТ';
  row.customFields = row.customFields && typeof row.customFields==='object' ? row.customFields : {};
  delete row.spent;
  delete row.spentVat;
  return row;
}

function activeUser(){ return state.users.find(u=>u.id===activeUserId) || state.users[0] || null; }
function activeReport(){
  const u = activeUser();
  if(!u) return null;
  return u.reports.find(r=>r.id===u.activeReportId) || u.reports[0] || null;
}
function isEditable(){ return !!activeReport()?.editable; }

function parseNumber(v){
  if(typeof v === 'number') return Number.isFinite(v) ? v : 0;
  return Number(String(v || '0').replace(/\s/g,'').replace(',','.')) || 0;
}
function money(n){ return Number(n||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}) + ' ₽'; }
function num(n){ return Number(n||0).toLocaleString('ru-RU'); }
function percent(n){ return Number(n||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}) + '%'; }
function escapeHtml(str){ return String(str??'').replace(/[&<>"']/g, s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[s])); }

function getNetwork(name){
  const text = String(name || '').toUpperCase();
  const rules = [
    {cls:'ok', label:'OK', patterns:['ВКР_ОК','ВКР ОК','_ОК',' ОК','-ОК','ОКМ','ОКЖ','OK']},
    {cls:'vk', label:'VK', patterns:['ВКР_ВК','ВКР ВК','_ВК',' ВК','-ВК','ВКМ','ВКЖ','VK','ВК']},
    {cls:'none', label:'С', patterns:['СКФО']},
    {cls:'none', label:'Д', patterns:['ДФО']},
    {cls:'none', label:'ДЗ', patterns:['ДЗЕН','ZEN']}
  ];
  for(const rule of rules) if(rule.patterns.some(p=>text.includes(p))) return {cls:rule.cls,label:rule.label};
  return {cls:'none',label:'—'};
}
function statusClass(status){ return status==='СОБРАЛИ'?'done':status==='НЕ РАБОТАЕТ'?'stop':'work'; }
function option(value,label,current){ return `<option value="${value}" ${value===current?'selected':''}>${label}</option>`; }

function renderUsers(){
  const s = document.getElementById('userSelect');
  s.innerHTML = '';
  state.users.forEach(u=>{
    const o=document.createElement('option');
    o.value=u.id;
    o.textContent=u.name + (u.id===window.currentAuthUser?.id?' (я)':'');
    o.selected=u.id===activeUserId;
    s.appendChild(o);
  });
}

function renderReports(){
  const list=document.getElementById('reportList');
  const u=activeUser();
  list.innerHTML='';
  if(!u || !u.reports.length){
    list.innerHTML='<div class="empty-reports">Нет доступных статистик</div>';
    return;
  }
  u.reports.forEach(r=>{
    const el=document.createElement('div');
    el.className='report-item'+(r.id===u.activeReportId&&!generalMode?' active':'');
    const privacy=r.visibility==='private'?'🔒':'🌐';
    el.innerHTML=`<b>${privacy} ${escapeHtml(r.title)}</b><span>${escapeHtml(r.date)} · строк: ${r.rows.length}</span>`;
    el.onclick=()=>{ generalMode=false; u.activeReportId=r.id; render(); };
    list.appendChild(el);
  });
}

function applyScale(r){
  const zoom=parseNumber(r?.zoom||1);
  const scaler=document.getElementById('tableScaler');
  scaler.style.transform=`scale(${zoom})`;
  scaler.style.width=`${100/zoom}%`;
}

function setEditorVisible(visible){
  document.querySelector('.topbar').classList.toggle('hidden',!visible);
  document.querySelector('.toolbar').classList.toggle('hidden',!visible);
  document.querySelector('.settings').classList.toggle('hidden',!visible);
  document.querySelector('section.report:not(#generalStatsSection)').classList.toggle('hidden',!visible);
  document.getElementById('generalStatsSection').classList.toggle('hidden',visible);
}

const BASE_COLUMNS = [
  {key:'social',title:'Коллектор / соцсеть',width:225,sticky:true},
  {key:'impressions',title:'Показы',width:115},
  {key:'clicks',title:'Клики',width:110},
  {key:'collected',title:'Собрано анкет',width:125},
  {key:'spentNet',title:'Потрачено без НДС',width:145},
  {key:'spentVat',title:'Потрачено с НДС',width:145},
  {key:'clickPrice',title:'Стоимость клика с НДС',width:145},
  {key:'leadPrice',title:'Стоимость анкеты с НДС',width:155},
  {key:'left',title:'Осталось сделать',width:120},
  {key:'need',title:'Всего необходимо анкет',width:150},
  {key:'status',title:'СТАТУС',width:135},
  {key:'percent',title:'Сколько процентов собрано',width:175},
  {key:'budget',title:'Всего нужно бюджета в среднем c НДС',width:190},
  {key:'delete',title:'✕',width:55,noPrint:true}
];

function allColumns(r){
  const custom=(r.customColumns||[]).map(c=>({key:'custom:'+c.id,title:c.title,width:c.width||130,custom:true,id:c.id,type:c.type,format:c.format,summary:c.summary}));
  return [...BASE_COLUMNS.slice(0,-1),...custom,BASE_COLUMNS[BASE_COLUMNS.length-1]];
}

function getColumnWidth(r,col){
  return Math.max(55,parseNumber(r.columnWidths?.[col.key] || col.width || 120));
}

function renderTableStructure(r,editable){
  const cols=allColumns(r);
  const colgroup=document.getElementById('mainColgroup');
  const head=document.getElementById('mainTableHead');
  const foot=document.getElementById('mainTableFoot');
  colgroup.innerHTML=cols.map(c=>`<col data-col-key="${escapeHtml(c.key)}" style="width:${getColumnWidth(r,c)}px">`).join('');
  head.innerHTML=`<tr>${cols.map((c,idx)=>`<th data-col-index="${idx}" data-col-key="${escapeHtml(c.key)}" class="${c.sticky?'sticky-col':''} ${c.noPrint?'no-print':''}"><span class="th-label">${c.custom&&c.type==='formula'?'<span class="fx-badge">fx</span> ':''}${escapeHtml(c.title)}</span>${c.custom&&editable?`<span class="custom-col-actions no-print"><button class="edit-custom-col" data-edit-custom-col="${escapeHtml(c.id)}" type="button" title="Настроить колонку">✎</button><button class="remove-custom-col" data-remove-custom-col="${escapeHtml(c.id)}" type="button" title="Удалить колонку">×</button></span>`:''}<span class="col-resizer no-print" data-col-index="${idx}"></span></th>`).join('')}</tr>`;

  const totalMap={social:'Σ Итого',impressions:'<span id="totalImpressions">0</span>',clicks:'<span id="totalClicks">0</span>',collected:'<span id="totalCollected">0</span>',spentNet:'<span id="totalSpentNet">0 ₽</span>',spentVat:'<span id="totalSpentVat">0 ₽</span>',clickPrice:'<span id="totalClickPrice">0 ₽</span>',leadPrice:'<span id="totalLeadPrice">0 ₽</span>',left:'<span id="totalLeft">0</span>',need:'<span id="totalNeed">0</span>',status:'—',percent:'<span id="totalPercent">0%</span>',budget:'<span id="totalBudget" class="gold">0 ₽</span>',delete:''};
  const avgMap={social:'Ø Среднее',impressions:'<span id="avgImpressions">0</span>',clicks:'<span id="avgClicks">0</span>',collected:'<span id="avgCollected">0</span>',spentNet:'<span id="avgSpentNet">0 ₽</span>',spentVat:'<span id="avgSpentVat">0 ₽</span>',clickPrice:'<span id="avgClickPrice">0 ₽</span>',leadPrice:'<span id="avgLeadPrice">0 ₽</span>',left:'<span id="avgLeft">0</span>',need:'<span id="avgNeed">0</span>',status:'—',percent:'<span id="avgPercent">0%</span>',budget:'<span id="avgBudget" class="gold">0 ₽</span>',delete:''};

  foot.innerHTML=`<tr class="totals-row">${cols.map(c=>`<td class="${c.sticky?'sticky-col':''} ${c.noPrint?'no-print':''}">${c.custom?`<span data-custom-summary="${escapeHtml(c.id)}">${summarizeCustomColumn((r.customColumns||[]).find(x=>x.id===c.id)||c,r,(r.customColumns||[]).find(x=>x.id===c.id)?.summary)}</span>`:(totalMap[c.key]??'')}</td>`).join('')}</tr>
  <tr class="averages-row">${cols.map(c=>`<td class="${c.sticky?'sticky-col':''} ${c.noPrint?'no-print':''}">${c.custom?`<span data-custom-average="${escapeHtml(c.id)}">${summarizeCustomColumn((r.customColumns||[]).find(x=>x.id===c.id)||c,r,'avg')}</span>`:(avgMap[c.key]??'')}</td>`).join('')}</tr>`;
  initColumnResizers(r);
}

function initColumnResizers(r){
  const table=document.getElementById('mainStatsTable');
  if(!table) return;
  table.querySelectorAll('.col-resizer').forEach(handle=>{
    handle.onmousedown=(e)=>{
      e.preventDefault(); e.stopPropagation();
      const index=Number(handle.dataset.colIndex);
      const th=table.querySelector(`th[data-col-index="${index}"]`);
      const col=document.getElementById('mainColgroup')?.children[index];
      if(!th||!col) return;
      const startX=e.clientX, startWidth=th.getBoundingClientRect().width/(parseNumber(r.zoom)||1);
      document.body.classList.add('resizing-column');
      const move=(ev)=>{
        const width=Math.max(55,Math.round(startWidth+(ev.clientX-startX)/(parseNumber(r.zoom)||1)));
        col.style.width=width+'px';
      };
      const up=()=>{
        document.removeEventListener('mousemove',move); document.removeEventListener('mouseup',up); document.body.classList.remove('resizing-column');
        const width=parseNumber(col.style.width);
        const key=th.dataset.colKey;
        r.columnWidths=r.columnWidths||{}; r.columnWidths[key]=width;
        const custom=(r.customColumns||[]).find(c=>'custom:'+c.id===key); if(custom) custom.width=width;
        saveState();
      };
      document.addEventListener('mousemove',move); document.addEventListener('mouseup',up);
    };
  });
}

function syncVisibleInputsToState(){
  const r=activeReport(); if(!r?.editable) return;
  document.querySelectorAll('#tableBody [data-row][data-field]').forEach(el=>{
    const i=Number(el.dataset.row), field=el.dataset.field; const row=r.rows[i]; if(!row)return;
    if(field.startsWith('custom:')){ row.customFields=row.customFields||{}; row.customFields[field.slice(7)]=el.value; }
    else row[field]=['impressions','clicks','collected','spentNet','need'].includes(field)?parseNumber(el.value):el.value;
  });
}

function calculateRow(row,vat){
  const impressions=parseNumber(row.impressions);
  const clicks=parseNumber(row.clicks);
  const collected=parseNumber(row.collected);
  const spentNet=parseNumber(row.spentNet);
  const spentVat=spentNet*vat;
  const need=parseNumber(row.need);
  const clickPrice=clicks>0?spentVat/clicks:0;
  const leadPrice=collected>0?spentVat/collected:0;
  const left=Math.max(need-collected,0);
  const rowPercent=need>0?collected/need*100:0;
  const budgetNeed=leadPrice*need;
  return {impressions,clicks,collected,spentNet,spentVat,need,clickPrice,leadPrice,left,rowPercent,budgetNeed};
}

const FORMULA_PRESETS = [
  {id:'ctr',title:'CTR, %',formula:'SAFE_DIV([КЛИКИ],[ПОКАЗЫ])*100',format:'percent',summary:'avg',desc:'Доля кликов от показов.'},
  {id:'cr_click_lead',title:'Конверсия клик → анкета, %',formula:'SAFE_DIV([АНКЕТЫ],[КЛИКИ])*100',format:'percent',summary:'avg',desc:'Какая доля кликов стала анкетами.'},
  {id:'cr_show_lead',title:'Конверсия показ → анкета, %',formula:'SAFE_DIV([АНКЕТЫ],[ПОКАЗЫ])*100',format:'percent',summary:'avg',desc:'Какая доля показов дала анкету.'},
  {id:'cpc_net',title:'CPC без НДС',formula:'SAFE_DIV([ПОТРАЧЕНО БЕЗ НДС],[КЛИКИ])',format:'money',summary:'avg',desc:'Цена клика без НДС.'},
  {id:'cpc_vat',title:'CPC с НДС',formula:'SAFE_DIV([ПОТРАЧЕНО С НДС],[КЛИКИ])',format:'money',summary:'avg',desc:'Цена клика с НДС.'},
  {id:'cpa_net',title:'Цена анкеты без НДС',formula:'SAFE_DIV([ПОТРАЧЕНО БЕЗ НДС],[АНКЕТЫ])',format:'money',summary:'avg',desc:'Стоимость одной анкеты без НДС.'},
  {id:'cpa_vat',title:'Цена анкеты с НДС',formula:'SAFE_DIV([ПОТРАЧЕНО С НДС],[АНКЕТЫ])',format:'money',summary:'avg',desc:'Стоимость одной анкеты с НДС.'},
  {id:'cpm_net',title:'CPM без НДС',formula:'SAFE_DIV([ПОТРАЧЕНО БЕЗ НДС],[ПОКАЗЫ])*1000',format:'money',summary:'avg',desc:'Цена 1000 показов без НДС.'},
  {id:'cpm_vat',title:'CPM с НДС',formula:'SAFE_DIV([ПОТРАЧЕНО С НДС],[ПОКАЗЫ])*1000',format:'money',summary:'avg',desc:'Цена 1000 показов с НДС.'},
  {id:'vat_sum',title:'Сумма НДС',formula:'[ПОТРАЧЕНО С НДС]-[ПОТРАЧЕНО БЕЗ НДС]',format:'money',summary:'sum',desc:'Разница между расходом с НДС и без НДС.'},
  {id:'vat_percent',title:'Надбавка НДС, %',formula:'([КОЭФФИЦИЕНТ]-1)*100',format:'percent',summary:'avg',desc:'Процент надбавки из коэффициента.'},
  {id:'completion',title:'Выполнение плана, %',formula:'SAFE_DIV([АНКЕТЫ],[НУЖНО])*100',format:'percent',summary:'avg',desc:'Процент выполненного плана анкет.'},
  {id:'remaining',title:'Осталось анкет',formula:'MAX([НУЖНО]-[АНКЕТЫ],0)',format:'number',summary:'sum',desc:'Сколько анкет осталось собрать.'},
  {id:'overplan',title:'Перевыполнение, анкеты',formula:'MAX([АНКЕТЫ]-[НУЖНО],0)',format:'number',summary:'sum',desc:'Сколько анкет собрано сверх плана.'},
  {id:'remaining_percent',title:'Осталось плана, %',formula:'MAX(100-[ПРОЦЕНТ],0)',format:'percent',summary:'avg',desc:'Процент плана, который еще не выполнен.'},
  {id:'budget_forecast',title:'Прогноз бюджета с НДС',formula:'SAFE_DIV([ПОТРАЧЕНО С НДС],[АНКЕТЫ])*[НУЖНО]',format:'money',summary:'sum',desc:'Прогноз общего бюджета при текущей цене анкеты.'},
  {id:'budget_remaining',title:'Нужно бюджета еще с НДС',formula:'SAFE_DIV([ПОТРАЧЕНО С НДС],[АНКЕТЫ])*MAX([НУЖНО]-[АНКЕТЫ],0)',format:'money',summary:'sum',desc:'Сколько еще ориентировочно потребуется бюджета.'},
  {id:'views_per_click',title:'Показов на 1 клик',formula:'SAFE_DIV([ПОКАЗЫ],[КЛИКИ])',format:'number',summary:'avg',desc:'Сколько показов приходится на один клик.'},
  {id:'views_per_lead',title:'Показов на 1 анкету',formula:'SAFE_DIV([ПОКАЗЫ],[АНКЕТЫ])',format:'number',summary:'avg',desc:'Сколько показов приходится на одну анкету.'},
  {id:'clicks_per_lead',title:'Кликов на 1 анкету',formula:'SAFE_DIV([КЛИКИ],[АНКЕТЫ])',format:'number',summary:'avg',desc:'Сколько кликов требуется на одну анкету.'},
  {id:'roas',title:'ROAS, %',formula:'SAFE_DIV([ВЫРУЧКА],[ПОТРАЧЕНО С НДС])*100',format:'percent',summary:'avg',desc:'Для работы сначала добавьте ручную колонку «Выручка».'},
  {id:'roi',title:'ROI, %',formula:'SAFE_DIV([ВЫРУЧКА]-[ПОТРАЧЕНО С НДС],[ПОТРАЧЕНО С НДС])*100',format:'percent',summary:'avg',desc:'Для работы сначала добавьте ручную колонку «Выручка».'},
  {id:'sale_cr',title:'Конверсия анкета → продажа, %',formula:'SAFE_DIV([ПРОДАЖИ],[АНКЕТЫ])*100',format:'percent',summary:'avg',desc:'Для работы сначала добавьте ручную колонку «Продажи».'},
  {id:'cps',title:'Стоимость продажи с НДС',formula:'SAFE_DIV([ПОТРАЧЕНО С НДС],[ПРОДАЖИ])',format:'money',summary:'avg',desc:'Для работы сначала добавьте ручную колонку «Продажи».'}
];

function normalizeFormulaName(name){
  return String(name||'').trim().toUpperCase().replace(/Ё/g,'Е').replace(/\s+/g,' ');
}

function formulaBaseContext(row,r){
  const c=calculateRow(row,parseNumber(r.vat)||1.22);
  return {
    'ПОКАЗЫ':c.impressions,
    'КЛИКИ':c.clicks,
    'АНКЕТЫ':c.collected,
    'СОБРАНО АНКЕТ':c.collected,
    'ПОТРАЧЕНО БЕЗ НДС':c.spentNet,
    'ПОТРАЧЕНО С НДС':c.spentVat,
    'СТОИМОСТЬ КЛИКА':c.clickPrice,
    'СТОИМОСТЬ КЛИКА С НДС':c.clickPrice,
    'СТОИМОСТЬ АНКЕТЫ':c.leadPrice,
    'СТОИМОСТЬ АНКЕТЫ С НДС':c.leadPrice,
    'ОСТАЛОСЬ':c.left,
    'ОСТАЛОСЬ СДЕЛАТЬ':c.left,
    'НУЖНО':c.need,
    'ВСЕГО НЕОБХОДИМО АНКЕТ':c.need,
    'ПРОЦЕНТ':c.rowPercent,
    'ПРОЦЕНТ СОБРАНО':c.rowPercent,
    'БЮДЖЕТ':c.budgetNeed,
    'БЮДЖЕТ С НДС':c.budgetNeed,
    'КОЭФФИЦИЕНТ':parseNumber(r.vat)||1.22,
    'НДС КОЭФФИЦИЕНТ':parseNumber(r.vat)||1.22
  };
}

function tokenizeFormula(input){
  const s=String(input||'').trim();
  const out=[];
  let i=0;
  while(i<s.length){
    const ch=s[i];
    if(/\s/.test(ch)){i++;continue;}
    if(ch==='['){
      const j=s.indexOf(']',i+1);
      if(j<0) throw new Error('Не закрыта скобка [колонка]');
      out.push({type:'var',value:s.slice(i+1,j).trim()}); i=j+1; continue;
    }
    if(/[0-9.]/.test(ch)){
      let j=i+1; while(j<s.length&&/[0-9.]/.test(s[j]))j++;
      const raw=s.slice(i,j); if(!/^\d*\.?\d+$/.test(raw))throw new Error('Некорректное число '+raw);
      out.push({type:'num',value:Number(raw)});i=j;continue;
    }
    if(/[A-Za-zА-Яа-яЁё_]/.test(ch)){
      let j=i+1;while(j<s.length&&/[A-Za-zА-Яа-яЁё0-9_]/.test(s[j]))j++;
      out.push({type:'id',value:s.slice(i,j).toUpperCase()});i=j;continue;
    }
    const two=s.slice(i,i+2);
    if(['>=','<=','==','!='].includes(two)){out.push({type:'op',value:two});i+=2;continue;}
    if('+-*/%^(),><'.includes(ch)){out.push({type:'op',value:ch});i++;continue;}
    throw new Error('Недопустимый символ: '+ch);
  }
  return out;
}

function evaluateFormulaExpression(expr,resolver){
  const tokens=tokenizeFormula(expr); let p=0;
  const peek=()=>tokens[p]; const take=()=>tokens[p++];
  const match=(v)=>{if(peek()?.value===v){p++;return true;}return false;};
  const funcs={
    SAFE_DIV:(a,b)=>Math.abs(Number(b)||0)<1e-12?0:Number(a||0)/Number(b),
    PERCENT:(a,b)=>Math.abs(Number(b)||0)<1e-12?0:Number(a||0)/Number(b)*100,
    ROUND:(a,n=0)=>{const k=10**Math.max(0,Math.min(8,Math.trunc(Number(n)||0)));return Math.round(Number(a||0)*k)/k;},
    MIN:(...a)=>Math.min(...a.map(Number)),
    MAX:(...a)=>Math.max(...a.map(Number)),
    ABS:(a)=>Math.abs(Number(a)||0),
    CEIL:(a)=>Math.ceil(Number(a)||0),
    FLOOR:(a)=>Math.floor(Number(a)||0),
    SQRT:(a)=>Math.sqrt(Math.max(0,Number(a)||0)),
    POWER:(a,b)=>Math.pow(Number(a)||0,Number(b)||0),
    CLAMP:(x,a,b)=>Math.min(Number(b),Math.max(Number(a),Number(x))),
    IF:(cond,a,b)=>cond?a:b
  };
  function primary(){
    const t=take(); if(!t)throw new Error('Формула оборвана');
    if(t.type==='num')return t.value;
    if(t.type==='var')return Number(resolver(t.value)||0);
    if(t.type==='id'){
      if(match('(')){
        const args=[]; if(!match(')')){do{args.push(compare());}while(match(',')); if(!match(')'))throw new Error('Не закрыта функция '+t.value);}
        const fn=funcs[t.value]; if(!fn)throw new Error('Неизвестная функция '+t.value);
        return Number(fn(...args))||0;
      }
      if(t.value==='TRUE')return 1;if(t.value==='FALSE')return 0;
      throw new Error('Неизвестное имя '+t.value+'. Колонки пишутся в [квадратных скобках].');
    }
    if(t.value==='('){const v=compare();if(!match(')'))throw new Error('Не закрыта круглая скобка');return v;}
    throw new Error('Ожидалось число, колонка или функция');
  }
  function unary(){if(match('+'))return unary();if(match('-'))return -unary();return primary();}
  function power(){let v=unary();while(match('^'))v=Math.pow(v,unary());return v;}
  function mult(){let v=power();while(true){if(match('*'))v*=power();else if(match('/')){const b=power();v=Math.abs(b)<1e-12?0:v/b;}else if(match('%')){const b=power();v=Math.abs(b)<1e-12?0:v%b;}else break;}return v;}
  function add(){let v=mult();while(true){if(match('+'))v+=mult();else if(match('-'))v-=mult();else break;}return v;}
  function compare(){let v=add();while(true){if(match('>='))v=v>=add()?1:0;else if(match('<='))v=v<=add()?1:0;else if(match('=='))v=v===add()?1:0;else if(match('!='))v=v!==add()?1:0;else if(match('>'))v=v>add()?1:0;else if(match('<'))v=v<add()?1:0;else break;}return v;}
  const value=compare(); if(p<tokens.length)throw new Error('Лишняя часть формулы около '+tokens[p].value);
  return Number.isFinite(value)?value:0;
}

function evaluateCustomColumn(row,r,col,stack=new Set()){
  if(col.type!=='formula') return {value:parseNumber(row.customFields?.[col.id]),error:''};
  if(stack.has(col.id)) return {value:0,error:'Циклическая ссылка'};
  const next=new Set(stack); next.add(col.id);
  try{
    const base=formulaBaseContext(row,r);
    const resolver=(name)=>{
      const key=normalizeFormulaName(name);
      if(Object.prototype.hasOwnProperty.call(base,key)) return base[key];
      const target=(r.customColumns||[]).find(x=>normalizeFormulaName(x.title)===key || normalizeFormulaName(x.id)===key);
      if(!target) return 0;
      if(target.type==='formula') return evaluateCustomColumn(row,r,target,next).value;
      return parseNumber(row.customFields?.[target.id]);
    };
    return {value:evaluateFormulaExpression(col.formula,resolver),error:''};
  }catch(e){return {value:0,error:e.message||'Ошибка формулы'};}
}

function formatCustomValue(value,col){
  const n=Number(value)||0, d=Math.max(0,Math.min(6,parseInt(col.decimals??2,10)||0));
  if(col.format==='money')return n.toLocaleString('ru-RU',{minimumFractionDigits:d,maximumFractionDigits:d})+' ₽';
  if(col.format==='percent')return n.toLocaleString('ru-RU',{minimumFractionDigits:d,maximumFractionDigits:d})+'%';
  if(col.format==='number')return n.toLocaleString('ru-RU',{minimumFractionDigits:0,maximumFractionDigits:d});
  return String(value??'');
}

function customColumnValues(col,r){
  const sourceRows=col.type==='formula'?filledRowsForAverage(r):(r.rows||[]);
  return sourceRows.map(row=>{
    if(col.type==='formula')return evaluateCustomColumn(row,r,col).value;
    const raw=row.customFields?.[col.id];
    const text=String(raw??'').trim();
    if(!text)return null;
    const n=Number(text.replace(/\s/g,'').replace(',','.'));
    return Number.isFinite(n)?n:null;
  }).filter(v=>v!==null&&Number.isFinite(v));
}

function summarizeCustomColumn(col,r,mode){
  const vals=customColumnValues(col,r);
  if(!vals.length)return '';
  let method=mode||col.summary||'auto';
  if(method==='auto')method=col.type==='formula'?'avg':(col.format==='text'?'none':'sum');
  if(method==='none')return '';
  if(method==='sum')return formatCustomValue(vals.reduce((a,b)=>a+b,0),col);
  if(method==='avg')return formatCustomValue(vals.reduce((a,b)=>a+b,0)/vals.length,col);
  if(method==='min')return formatCustomValue(Math.min(...vals),col);
  if(method==='max')return formatCustomValue(Math.max(...vals),col);
  if(method==='count')return num(vals.length);
  return '';
}

function filledRowsForAverage(r){
  return (r.rows||[]).filter(row=>{
    if(parseNumber(row.impressions)||parseNumber(row.clicks)||parseNumber(row.collected)||parseNumber(row.spentNet)||parseNumber(row.need))return true;
    return (r.customColumns||[]).some(c=>c.type!=='formula'&&String(row.customFields?.[c.id]??'').trim()!=='');
  });
}

function recalculateRowDom(i){
  const r=activeReport(); if(!r)return;
  const row=r.rows[i]; if(!row)return;
  const vat=parseNumber(r.vat)||1.22;
  const c=calculateRow(row,vat);
  const tr=document.querySelector(`#tableBody tr[data-row-index="${i}"]`);
  if(!tr)return;
  const set=(key,value)=>{const el=tr.querySelector(`[data-auto-field="${key}"]`);if(el)el.textContent=value;};
  set('spentVat',money(c.spentVat));
  set('clickPrice',money(c.clickPrice));
  set('leadPrice',money(c.leadPrice));
  set('left',num(c.left));
  set('percent',percent(c.rowPercent));
  set('budget',money(c.budgetNeed));
  const percentEl=tr.querySelector('[data-auto-field="percent"]');
  if(percentEl) percentEl.classList.toggle('positive',c.rowPercent>=100);

  (r.customColumns||[]).filter(col=>col.type==='formula').forEach(col=>{
    const el=tr.querySelector(`[data-formula-col="${CSS.escape(col.id)}"]`);
    if(!el)return;
    const result=evaluateCustomColumn(row,r,col);
    el.textContent=result.error?'#ФОРМ!':formatCustomValue(result.value,col);
    el.classList.toggle('formula-error',!!result.error);
    el.title=result.error||col.formula||'';
  });
}

function recalculateTotalsDom(){
  const r=activeReport(); if(!r)return;
  const vat=parseNumber(r.vat)||1.22;
  let totalImpressions=0,totalClicks=0,totalCollected=0,totalSpentNet=0,totalSpentVat=0,totalNeed=0,totalLeft=0,totalBudget=0;
  r.rows.forEach(row=>{
    const c=calculateRow(row,vat);
    totalImpressions+=c.impressions;totalClicks+=c.clicks;totalCollected+=c.collected;
    totalSpentNet+=c.spentNet;totalSpentVat+=c.spentVat;totalNeed+=c.need;totalLeft+=c.left;totalBudget+=c.budgetNeed;
  });
  const totalPercent=totalNeed>0?totalCollected/totalNeed*100:0;
  const vals={
    totalImpressions:num(totalImpressions),totalClicks:num(totalClicks),totalCollected:num(totalCollected),
    totalSpentNet:money(totalSpentNet),totalSpentVat:money(totalSpentVat),
    totalClickPrice:money(totalClicks>0?totalSpentVat/totalClicks:0),
    totalLeadPrice:money(totalCollected>0?totalSpentVat/totalCollected:0),
    totalLeft:num(totalLeft),totalNeed:num(totalNeed),totalPercent:percent(totalPercent),totalBudget:money(totalBudget)
  };
  Object.entries(vals).forEach(([id,v])=>{const el=document.getElementById(id);if(el)el.textContent=v;});

  const filled=filledRowsForAverage(r);
  const count=filled.length||1;
  const calcs=filled.map(row=>calculateRow(row,vat));
  const avg=(key,filterFn=null)=>{
    const arr=filterFn?calcs.filter(filterFn):calcs;
    return arr.length?arr.reduce((s,x)=>s+parseNumber(x[key]),0)/arr.length:0;
  };
  const avgVals={
    avgImpressions:num(avg('impressions')),
    avgClicks:num(avg('clicks')),
    avgCollected:num(avg('collected')),
    avgSpentNet:money(avg('spentNet')),
    avgSpentVat:money(avg('spentVat')),
    avgClickPrice:money(avg('clickPrice',x=>x.clicks>0)),
    avgLeadPrice:money(avg('leadPrice',x=>x.collected>0)),
    avgLeft:num(avg('left')),
    avgNeed:num(avg('need')),
    avgPercent:percent(avg('rowPercent',x=>x.need>0)),
    avgBudget:money(avg('budgetNeed',x=>x.collected>0&&x.need>0))
  };
  Object.entries(avgVals).forEach(([id,v])=>{const el=document.getElementById(id);if(el)el.textContent=v;});

  (r.customColumns||[]).forEach(col=>{
    const sumEl=document.querySelector(`[data-custom-summary="${CSS.escape(col.id)}"]`);
    const avgEl=document.querySelector(`[data-custom-average="${CSS.escape(col.id)}"]`);
    if(sumEl)sumEl.textContent=summarizeCustomColumn(col,r,col.summary);
    if(avgEl)avgEl.textContent=summarizeCustomColumn(col,r,'avg');
  });
}

function updateRowValueOnly(i,field,value){
  const r=activeReport(); if(!r?.editable)return; const row=r.rows[i]; if(!row)return;
  if(field.startsWith('custom:')){row.customFields=row.customFields||{};row.customFields[field.slice(7)]=value;}
  else row[field]=['impressions','clicks','collected','spentNet','need'].includes(field)?parseNumber(value):value;

  if(['impressions','clicks','collected','spentNet','need'].includes(field) || field.startsWith('custom:')){
    recalculateRowDom(i);
    recalculateTotalsDom();
  }
  saveState();
}

function commitRowEdit(i,field,value){
  updateRowValueOnly(i,field,value);
  const tr=document.querySelector(`#tableBody tr[data-row-index="${i}"]`);
  if(!tr)return;
  if(field==='status'){
    const sel=tr.querySelector('[data-field="status"]');
    if(sel){
      sel.classList.remove('work','done','stop');
      sel.classList.add(statusClass(value));
    }
  }
  if(field==='social'){
    const icon=tr.querySelector('.network-icon');
    const net=getNetwork(value);
    if(icon){
      icon.className=`network-icon ${net.cls}`;
      icon.textContent=net.label;
    }
  }
}

let editingCustomColumnId=null;

function renderFormulaPresetOptions(){
  const select=document.getElementById('columnPreset');
  if(!select)return;
  select.innerHTML='<option value="">Своя формула / без шаблона</option>'+FORMULA_PRESETS.map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.title)}</option>`).join('');
}

function openColumnBuilder(id=null){
  const r=activeReport(); if(!r?.editable)return;
  editingCustomColumnId=id;
  const col=id?(r.customColumns||[]).find(c=>c.id===id):null;
  document.getElementById('columnBuilderTitle').textContent=col?'Настроить колонку':'Добавить колонку';
  document.getElementById('columnName').value=col?.title||'';
  document.getElementById('columnType').value=col?.type||'manual';
  document.getElementById('columnFormat').value=col?.format||((col?.type==='formula')?'number':'text');
  document.getElementById('columnSummary').value=col?.summary||'auto';
  document.getElementById('columnDecimals').value=String(col?.decimals??2);
  document.getElementById('columnFormula').value=col?.formula||'';
  renderFormulaPresetOptions();
  document.getElementById('columnPreset').value='';
  document.getElementById('columnBuilderModal').classList.remove('hidden');
  syncColumnBuilderType();
  setTimeout(()=>document.getElementById('columnName')?.focus(),30);
}

function closeColumnBuilder(){
  document.getElementById('columnBuilderModal')?.classList.add('hidden');
  editingCustomColumnId=null;
}

function syncColumnBuilderType(){
  const type=document.getElementById('columnType')?.value||'manual';
  document.getElementById('formulaBuilderFields')?.classList.toggle('hidden',type!=='formula');
  const format=document.getElementById('columnFormat');
  if(type==='formula'&&format?.value==='text')format.value='number';
}

function applyFormulaPreset(){
  const id=document.getElementById('columnPreset')?.value;
  const p=FORMULA_PRESETS.find(x=>x.id===id);
  if(!p)return;
  document.getElementById('columnName').value=p.title;
  document.getElementById('columnFormula').value=p.formula;
  document.getElementById('columnFormat').value=p.format;
  document.getElementById('columnSummary').value=p.summary;
  document.getElementById('columnPresetDescription').textContent=p.desc||'';
}

function saveCustomColumnFromBuilder(){
  const r=activeReport(); if(!r?.editable)return;
  const title=String(document.getElementById('columnName')?.value||'').trim();
  if(!title){alert('Введите название колонки');return;}
  const type=document.getElementById('columnType')?.value==='formula'?'formula':'manual';
  const formula=String(document.getElementById('columnFormula')?.value||'').trim();
  const format=document.getElementById('columnFormat')?.value||'text';
  const summary=document.getElementById('columnSummary')?.value||'auto';
  const decimals=Math.max(0,Math.min(6,parseInt(document.getElementById('columnDecimals')?.value||'2',10)||0));
  if(type==='formula'){
    if(!formula){alert('Введите формулу или выберите готовую');return;}
    try{evaluateFormulaExpression(formula,()=>0);}catch(e){alert('Ошибка формулы: '+e.message);return;}
  }
  r.customColumns=r.customColumns||[];
  if(editingCustomColumnId){
    const col=r.customColumns.find(c=>c.id===editingCustomColumnId); if(!col)return;
    Object.assign(col,{title,type,formula:type==='formula'?formula:'',format,summary,decimals});
  }else{
    r.customColumns.push({id:'c_'+uid(),title,width:150,type,formula:type==='formula'?formula:'',format,summary,decimals});
  }
  saveState(); closeColumnBuilder(); render();
}

function editCustomColumn(id){openColumnBuilder(id);}

function removeCustomColumn(id){
  const r=activeReport(); if(!r?.editable)return; if(!confirm('Удалить эту дополнительную колонку?'))return;
  r.customColumns=(r.customColumns||[]).filter(c=>c.id!==id); r.rows.forEach(row=>{if(row.customFields)delete row.customFields[id];});
  saveState(); render();
}

function addCustomColumn(){openColumnBuilder(null);}

function openFormulaManual(){
  const modal=document.getElementById('formulaManualModal'); if(!modal)return;
  const catalog=document.getElementById('formulaPresetCatalog');
  if(catalog)catalog.innerHTML=FORMULA_PRESETS.map(p=>`<div class="formula-card"><div><b>${escapeHtml(p.title)}</b><p>${escapeHtml(p.desc||'')}</p></div><code>${escapeHtml(p.formula)}</code></div>`).join('');
  const r=activeReport();
  const custom=(r?.customColumns||[]).filter(c=>c.type!=='formula').map(c=>`<code>[${escapeHtml(c.title)}]</code>`).join(' ');
  const refs=document.getElementById('formulaCustomRefs');
  if(refs)refs.innerHTML=custom||'<span class="muted">Сначала добавьте ручную колонку — её название автоматически станет доступно в формулах.</span>';
  modal.classList.remove('hidden');
}

function closeFormulaManual(){document.getElementById('formulaManualModal')?.classList.add('hidden');}

function render(){
  if(!appReady) return;
  renderUsers(); renderReports();
  document.getElementById('generalStatsBtn').classList.toggle('active-general',generalMode);
  if(generalMode){ setEditorVisible(false); renderGeneralStats(); return; }
  setEditorVisible(true);
  const u=activeUser(), r=activeReport();
  if(!u || !r){ document.getElementById('reportTitleView').textContent='Нет доступной статистики'; document.getElementById('ownerView').textContent=u?'Пользователь: '+u.name:''; document.getElementById('tableBody').innerHTML=''; return; }
  normalizeClientReport(r); applyScale(r);

  const editable=!!r.editable;
  const editElements=['reportTitle','reportDate','vatInput','visibilitySelect','zoomSelect','addRowBtn','addColumnBtn','saveBtn','deleteReportBtn','importBackupBtn'];
  editElements.forEach(id=>{const el=document.getElementById(id);if(el)el.disabled=!editable;});
  ['deleteReportBtn','addRowBtn','addColumnBtn','saveBtn','importBackupBtn'].forEach(id=>document.getElementById(id)?.classList.toggle('hidden',!editable));

  document.getElementById('reportTitle').value=r.title; document.getElementById('reportDate').value=r.date; document.getElementById('vatInput').value=r.vat;
  document.getElementById('visibilitySelect').value=r.visibility; document.getElementById('zoomSelect').value=String(r.zoom||0.8);
  document.getElementById('ownerView').textContent=`Пользователь: ${u.name} · ${r.visibility==='private'?'🔒 Приватная':'🌐 Публичная'}${editable?' · можно редактировать':' · только просмотр'}`;
  document.getElementById('reportTitleView').textContent=r.title; document.getElementById('dateView').textContent=r.date;

  renderTableStructure(r,editable);
  const body=document.getElementById('tableBody'); body.innerHTML='';
  let totalImpressions=0,totalClicks=0,totalCollected=0,totalSpentNet=0,totalSpentVat=0,totalNeed=0,totalLeft=0,totalBudget=0;
  const vat=parseNumber(r.vat)||1.22;
  r.rows.forEach((row,i)=>{
    normalizeClientRow(row,vat);
    const {impressions,clicks,collected,spentNet,spentVat,need,clickPrice,leadPrice,left,rowPercent,budgetNeed}=calculateRow(row,vat);
    const net=getNetwork(row.social), cls=statusClass(row.status), dis=editable?'':'disabled';
    totalImpressions+=impressions;totalClicks+=clicks;totalCollected+=collected;totalSpentNet+=spentNet;totalSpentVat+=spentVat;totalNeed+=need;totalLeft+=left;totalBudget+=budgetNeed;
    const customCells=(r.customColumns||[]).map(c=>{
      if(c.type==='formula'){
        const result=evaluateCustomColumn(row,r,c);
        return `<td class="auto-cell custom-formula-cell ${result.error?'formula-error':''}" data-formula-col="${escapeHtml(c.id)}" title="${escapeHtml(result.error||c.formula||'')}">${result.error?'#ФОРМ!':formatCustomValue(result.value,c)}</td>`;
      }
      return `<td><input ${dis} class="cell-input manual-input custom-manual" data-row="${i}" data-field="custom:${escapeHtml(c.id)}" value="${escapeHtml(row.customFields?.[c.id]??'')}"></td>`;
    }).join('');
    body.innerHTML+=`<tr data-row-index="${i}">
      <td class="sticky-col"><div class="social-cell"><span class="network-icon ${net.cls}">${net.label}</span><input ${dis} class="cell-input name-input" data-row="${i}" data-field="social" value="${escapeHtml(row.social)}"></div></td>
      <td><input ${dis} class="cell-input manual-input" data-row="${i}" data-field="impressions" inputmode="decimal" value="${impressions}"></td>
      <td><input ${dis} class="cell-input manual-input" data-row="${i}" data-field="clicks" inputmode="decimal" value="${clicks}"></td>
      <td><input ${dis} class="cell-input manual-input" data-row="${i}" data-field="collected" inputmode="decimal" value="${collected}"></td>
      <td><input ${dis} class="cell-input manual-input" data-row="${i}" data-field="spentNet" inputmode="decimal" value="${spentNet}"></td>
      <td class="auto-cell" data-auto-field="spentVat">${money(spentVat)}</td><td class="auto-cell" data-auto-field="clickPrice">${money(clickPrice)}</td><td class="auto-cell" data-auto-field="leadPrice">${money(leadPrice)}</td><td class="auto-cell" data-auto-field="left">${num(left)}</td>
      <td><input ${dis} class="cell-input manual-input" data-row="${i}" data-field="need" inputmode="decimal" value="${need}"></td>
      <td><select ${dis} class="cell-select status-select ${cls}" data-row="${i}" data-field="status">${option('РАБОТАЕТ','РАБОТАЕТ',row.status)}${option('СОБРАЛИ','СОБРАЛИ',row.status)}${option('НЕ РАБОТАЕТ','НЕ РАБОТАЕТ',row.status)}</select></td>
      <td class="auto-cell ${rowPercent>=100?'positive':''}" data-auto-field="percent">${percent(rowPercent)}</td><td class="auto-cell gold" data-auto-field="budget">${money(budgetNeed)}</td>${customCells}<td class="no-print">${editable?`<button class="danger row-delete-btn" type="button" data-remove-row="${i}">×</button>`:''}</td></tr>`;
  });
  const totalPercent=totalNeed>0?totalCollected/totalNeed*100:0;
  const vals={totalImpressions:num(totalImpressions),totalClicks:num(totalClicks),totalCollected:num(totalCollected),totalSpentNet:money(totalSpentNet),totalSpentVat:money(totalSpentVat),totalClickPrice:money(totalClicks>0?totalSpentVat/totalClicks:0),totalLeadPrice:money(totalCollected>0?totalSpentVat/totalCollected:0),totalLeft:num(totalLeft),totalNeed:num(totalNeed),totalPercent:percent(totalPercent),totalBudget:money(totalBudget)};
  Object.entries(vals).forEach(([id,v])=>{const el=document.getElementById(id);if(el)el.textContent=v;});
  recalculateTotalsDom();
}

function collectorGroup(name){
  let t=String(name||'').toUpperCase().replace(/_/g,' ').replace(/\s+/g,' ').trim();
  if(/18\s*[-–—]\s*24/.test(t)) return '18–24';
  if(/25\s*[-–—]\s*34/.test(t)) return '25–34';
  if(t.includes('СКФО')) return 'СКФО';
  if(t.includes('ДФО')) return 'ДФО';
  if(t.includes('ДЗЕН')||t.includes('ZEN')) return 'Дзен';
  if(/ВКР.*ОК[МЖ]\b/.test(t)||/ВКР\s+ОК\s*[МЖ]\b/.test(t)) return 'ВКР ОК';
  if(/МТ.*ВК[МЖ]\b/.test(t)||/МТ\s+ВК\s*[МЖ]\b/.test(t)) return 'МТ ВК';
  if(/МТ.*ОК[МЖ]\b/.test(t)||/МТ\s+ОК\s*[МЖ]\b/.test(t)) return 'МТ ОК';
  if(/ВКР.*ВК[МЖ]\b/.test(t)||/ВКР\s+ВК\s*[МЖ]\b/.test(t)) return 'ВКР ВК';
  if(/^ВК\s*[МЖ]$/.test(t)||/^ВК[МЖ]$/.test(t)) return 'ВК';
  return String(name||'Без названия').trim();
}

const GENERAL_ORDER=['МТ ВК','МТ ОК','ВКР ВК','ВКР ОК','СКФО','ДФО','18–24','25–34','Дзен','ВК'];
function buildGeneralRows(){
  const out=[];
  state.users.forEach(u=>u.reports.forEach(r=>{
    const groups=new Map();
    (r.rows||[]).forEach(row=>{
      normalizeClientRow(row,r.vat);
      const key=collectorGroup(row.social);
      if(!groups.has(key)) groups.set(key,{collector:key,impressions:0,clicks:0,collected:0,spentVat:0});
      const g=groups.get(key);
      g.impressions+=parseNumber(row.impressions); g.clicks+=parseNumber(row.clicks); g.collected+=parseNumber(row.collected); g.spentVat+=parseNumber(row.spentNet)*(parseNumber(r.vat)||1.22);
    });
    [...groups.values()].sort((a,b)=>{
      const ia=GENERAL_ORDER.indexOf(a.collector),ib=GENERAL_ORDER.indexOf(b.collector);
      if(ia!==-1||ib!==-1) return (ia===-1?999:ia)-(ib===-1?999:ib);
      return a.collector.localeCompare(b.collector,'ru');
    }).forEach(g=>out.push({...g,reportId:r.id,reportTitle:r.title,ownerName:u.name,visibility:r.visibility}));
  }));
  return out;
}

function renderGeneralStats(){
  const rows=buildGeneralRows(), body=document.getElementById('generalStatsBody');
  let impressions=0,clicks=0,collected=0,spent=0;
  if(!rows.length){
    body.innerHTML='<tr><td colspan="8">Нет доступных данных</td></tr>';
  }else{
    const counts={};
    rows.forEach(r=>{const k=r.reportId||`${r.ownerName}::${r.reportTitle}`;counts[k]=(counts[k]||0)+1;});
    const seen=new Set();
    body.innerHTML=rows.map(r=>{
      impressions+=r.impressions; clicks+=r.clicks; collected+=r.collected; spent+=r.spentVat;
      const key=r.reportId||`${r.ownerName}::${r.reportTitle}`;
      const titleCell=seen.has(key)?'':`<td class="general-report-group" rowspan="${counts[key]}"><b>${escapeHtml(r.reportTitle)}</b><div class="general-owner">${escapeHtml(r.ownerName)} · ${r.visibility==='private'?'🔒':'🌐'}</div><div class="group-row-count">${counts[key]} строк</div></td>`;
      seen.add(key);
      return `<tr>${titleCell}<td>${escapeHtml(r.collector)}</td><td>${num(r.impressions)}</td><td>${num(r.clicks)}</td><td>${money(r.clicks?r.spentVat/r.clicks:0)}</td><td>${num(r.collected)}</td><td>${money(r.collected?r.spentVat/r.collected:0)}</td><td>${money(r.spentVat)}</td></tr>`;
    }).join('');
  }
  document.getElementById('generalTotalImpressions').textContent=num(impressions);
  document.getElementById('generalTotalClicks').textContent=num(clicks);
  document.getElementById('generalTotalCpc').textContent=money(clicks?spent/clicks:0);
  document.getElementById('generalTotalCollected').textContent=num(collected);
  document.getElementById('generalTotalCpa').textContent=money(collected?spent/collected:0);
  document.getElementById('generalTotalSpent').textContent=money(spent);
}

function updateReportField(field,value){
  const r=activeReport(); if(!r?.editable) return;
  syncVisibleInputsToState();
  r[field]=['vat','zoom'].includes(field)?parseNumber(value):value;
  if(field==='vat'){
    r.rows.forEach(row=>normalizeClientRow(row,r.vat));
    r.rows.forEach((_,i)=>recalculateRowDom(i));
    recalculateTotalsDom();
  }
  saveState();

  if(field==='zoom'){ applyScale(r); return; }
  if(field==='title'){
    document.getElementById('reportTitleView').textContent=r.title;
    renderReports();
    return;
  }
  if(field==='date'){
    document.getElementById('dateView').textContent=r.date;
    renderReports();
    return;
  }
  if(field==='visibility'){
    const u=activeUser();
    document.getElementById('ownerView').textContent=`Пользователь: ${u?.name||''} · ${r.visibility==='private'?'🔒 Приватная':'🌐 Публичная'} · можно редактировать`;
    renderReports();
    return;
  }
}
function updateRow(i,field,value){ commitRowEdit(i,field,value); }
function addRow(){
  const r=activeReport(); if(!r?.editable) return;
  r.rows.push({social:'Новая строка',impressions:0,clicks:0,collected:0,spentNet:0,need:0,status:'РАБОТАЕТ',customFields:{}});
  saveState(); render();
}
function removeRow(i){ const r=activeReport(); if(!r?.editable)return; syncVisibleInputsToState(); r.rows.splice(i,1); saveState(); render(); }

async function addReport(){
  try{
    const title=prompt('Название статистики','Новая статистика'); if(title===null)return;
    const data=await appApi('createReport',{title:title||'Новая статистика',visibility:'public'});
    await initApp();
    activeUserId=window.currentAuthUser.id;
    const meUser=activeUser(); if(meUser){meUser.activeReportId=data.report.id;}
    generalMode=false; render();
  }catch(e){alert(e.message);}
}
async function deleteReport(){
  const r=activeReport(); if(!r?.editable)return;
  if(!confirm('Удалить статистику?'))return;
  try{await appApi('deleteReport',{reportId:r.id});await initApp();}catch(e){alert(e.message);}
}

function findReportById(reportId){
  for(const u of state.users){
    const r=(u.reports||[]).find(x=>x.id===reportId);
    if(r) return r;
  }
  return null;
}

function cloneReport(report){
  return JSON.parse(JSON.stringify(report));
}

function setAutosaveStatus(status){
  const btn=document.getElementById('saveBtn');
  if(!btn)return;
  if(status==='saving'){
    btn.textContent='Сохранение…';
    btn.classList.add('autosaving');
  }else if(status==='saved'){
    btn.textContent='✓ Сохранено';
    btn.classList.remove('autosaving');
    clearTimeout(btn._restoreTimer);
    btn._restoreTimer=setTimeout(()=>{btn.textContent='Сохранить';},900);
  }else if(status==='error'){
    btn.textContent='Ошибка сохранения';
    btn.classList.remove('autosaving');
  }else{
    btn.textContent='Сохранить';
    btn.classList.remove('autosaving');
  }
}

function getSaveMeta(reportId){
  if(!reportSaveQueues.has(reportId)){
    reportSaveQueues.set(reportId,{version:0,savedVersion:0,inFlight:false,pending:false,timer:null,showMessage:false});
  }
  return reportSaveQueues.get(reportId);
}

function scheduleReportSave(reportId,delay=120){
  const r=findReportById(reportId);
  if(!r?.editable)return;
  const meta=getSaveMeta(reportId);
  meta.version++;
  clearTimeout(meta.timer);
  meta.timer=setTimeout(()=>flushReportSave(reportId,false),delay);
  if(activeReport()?.id===reportId) setAutosaveStatus('saving');
}

function saveState(){
  const r=activeReport(); if(!r?.editable)return;
  scheduleReportSave(r.id,120);
}

async function flushReportSave(reportId,showMessage=false){
  const r=findReportById(reportId);
  if(!r?.editable)return;

  if(activeReport()?.id===reportId) syncVisibleInputsToState();

  const meta=getSaveMeta(reportId);
  if(showMessage) meta.showMessage=true;
  clearTimeout(meta.timer);
  meta.timer=null;

  if(meta.inFlight){
    meta.pending=true;
    return;
  }

  meta.inFlight=true;
  meta.pending=false;
  const savingVersion=meta.version;
  const snapshot=cloneReport(r);

  try{
    await appApi('saveReport',{report:snapshot});
    meta.savedVersion=Math.max(meta.savedVersion,savingVersion);
    if(activeReport()?.id===reportId && meta.savedVersion>=meta.version) setAutosaveStatus('saved');
    if(meta.showMessage && meta.savedVersion>=meta.version){
      meta.showMessage=false;
      alert('Сохранено');
    }
  }catch(e){
    if(activeReport()?.id===reportId) setAutosaveStatus('error');
    meta.showMessage=false;
    alert('Ошибка сохранения: '+e.message);
  }finally{
    meta.inFlight=false;
    if(meta.pending || meta.version>savingVersion){
      meta.pending=false;
      meta.timer=setTimeout(()=>flushReportSave(reportId,false),0);
    }
  }
}

async function persistActiveReport(showMessage=true){
  const r=activeReport(); if(!r?.editable)return;
  syncVisibleInputsToState();
  const meta=getSaveMeta(r.id);
  meta.version++;
  if(showMessage) meta.showMessage=true;
  setAutosaveStatus('saving');
  return flushReportSave(r.id,showMessage);
}

function exportCsv(){
  const u=activeUser(),r=activeReport(); if(!u||!r)return; syncVisibleInputsToState();
  const customHeaders=(r.customColumns||[]).map(c=>c.title);
  const lines=[[ 'Пользователь','Статистика','Коллектор','Показы','Клики','Анкеты','Потрачено без НДС','Потрачено с НДС','Стоимость клика с НДС','Стоимость анкеты с НДС','Осталось','Всего необходимо','Статус','% собрано','Бюджет с НДС',...customHeaders].join(';')];
  const vat=parseNumber(r.vat)||1.22;
  r.rows.forEach(row=>{
    normalizeClientRow(row,vat); const spentVat=row.spentNet*vat,left=Math.max(row.need-row.collected,0),p=row.need?row.collected/row.need*100:0;
    lines.push([u.name,r.title,row.social,row.impressions,row.clicks,row.collected,row.spentNet,spentVat,row.clicks?spentVat/row.clicks:0,row.collected?spentVat/row.collected:0,left,row.need,row.status,p,(row.collected?spentVat/row.collected:0)*row.need,...(r.customColumns||[]).map(c=>c.type==='formula'?evaluateCustomColumn(row,r,c).value:(row.customFields?.[c.id]??''))].join(';'));
  });
  downloadBlob(new Blob(['\ufeff'+lines.join('\n')],{type:'text/csv;charset=utf-8;'}),`${u.name} - ${r.title}.csv`);
}

function exportGeneralCsv(){
  const rows=buildGeneralRows();
  const lines=[['Название опроса','Пользователь','Коллектор','Показы','Клики','Стоимость клика','Анкеты','Стоимость анкеты','Потрачено с НДС'].join(';')];
  rows.forEach(r=>lines.push([r.reportTitle,r.ownerName,r.collector,r.impressions,r.clicks,r.clicks?r.spentVat/r.clicks:0,r.collected,r.collected?r.spentVat/r.collected:0,r.spentVat].join(';')));
  downloadBlob(new Blob(['\ufeff'+lines.join('\n')],{type:'text/csv;charset=utf-8;'}),'Общая статистика.csv');
}
function downloadBlob(blob,filename){ const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename.replace(/[\\/:*?"<>|]/g,'-');a.click();URL.revokeObjectURL(a.href); }

function exportBackup(){
  const mine=state.users.find(u=>u.id===window.currentAuthUser?.id);
  const backup={version:'oprosy-pro-user-backup-v2',exportedAt:new Date().toISOString(),reports:mine?.reports||[],quotaData:getQuotaData?.()||null};
  downloadBlob(new Blob([JSON.stringify(backup,null,2)],{type:'application/json;charset=utf-8'}),'backup-oprosy-pro-'+new Date().toISOString().slice(0,10)+'.json');
}
function importBackupFile(file){
  if(!file)return; const reader=new FileReader();
  reader.onload=async()=>{try{const backup=JSON.parse(reader.result);if(!Array.isArray(backup.reports))throw new Error('В файле нет статистик');if(!confirm('Импортировать статистики в ваш аккаунт?'))return;await appApi('importReports',{reports:backup.reports});if(backup.quotaData)saveQuotaData(backup.quotaData);await initApp();alert('Импортировано');}catch(e){alert('Ошибка импорта: '+e.message);}};
  reader.readAsText(file);
}
function triggerImportBackup(){const input=document.getElementById('importBackupInput');if(input){input.value='';input.click();}}

function bindMainEvents(){
  const tableBody=document.getElementById('tableBody');
  if(tableBody){
    tableBody.addEventListener('input',e=>{
      const el=e.target.closest('[data-row][data-field]');
      if(!el)return;
      const row=Number(el.dataset.row), field=el.dataset.field;
      updateRowValueOnly(row,field,el.value);
    });
    tableBody.addEventListener('change',e=>{
      const el=e.target.closest('[data-row][data-field]');
      if(!el)return;
      const row=Number(el.dataset.row), field=el.dataset.field;
      commitRowEdit(row,field,el.value);
    });
    tableBody.addEventListener('click',e=>{
      const btn=e.target.closest('[data-remove-row]');
      if(!btn)return;
      removeRow(Number(btn.dataset.removeRow));
    });
  }

  const tableHead=document.getElementById('mainTableHead');
  if(tableHead){
    tableHead.addEventListener('click',e=>{
      const editBtn=e.target.closest('[data-edit-custom-col]');
      if(editBtn){editCustomColumn(editBtn.dataset.editCustomCol);return;}
      const btn=e.target.closest('[data-remove-custom-col]');
      if(!btn)return;
      removeCustomColumn(btn.dataset.removeCustomCol);
    });
  }

  document.addEventListener('click',e=>{
    const btn=e.target.closest('.quota-remove-city-btn[data-quota-city]');
    if(!btn)return;
    removeSelectedQuotaCity(btn.dataset.quotaCity);
  });

  document.getElementById('userSelect').onchange=e=>{activeUserId=e.target.value;generalMode=false;const u=activeUser();if(u&&!u.activeReportId)u.activeReportId=u.reports[0]?.id||'';render();};
  document.getElementById('generalStatsBtn').onclick=()=>{generalMode=true;render();};
  document.getElementById('addReportBtn').onclick=addReport;
  document.getElementById('addRowBtn').onclick=addRow;
  document.getElementById('addColumnBtn').onclick=addCustomColumn;
  const formulaManualBtn=document.getElementById('formulaManualBtn');if(formulaManualBtn)formulaManualBtn.onclick=openFormulaManual;
  const closeFormulaManualBtn=document.getElementById('closeFormulaManualBtn');if(closeFormulaManualBtn)closeFormulaManualBtn.onclick=closeFormulaManual;
  const formulaManualBackdrop=document.getElementById('formulaManualBackdrop');if(formulaManualBackdrop)formulaManualBackdrop.onclick=closeFormulaManual;
  const closeColumnBuilderBtn=document.getElementById('closeColumnBuilderBtn');if(closeColumnBuilderBtn)closeColumnBuilderBtn.onclick=closeColumnBuilder;
  const columnBuilderBackdrop=document.getElementById('columnBuilderBackdrop');if(columnBuilderBackdrop)columnBuilderBackdrop.onclick=closeColumnBuilder;
  const columnType=document.getElementById('columnType');if(columnType)columnType.onchange=syncColumnBuilderType;
  const columnPreset=document.getElementById('columnPreset');if(columnPreset)columnPreset.onchange=applyFormulaPreset;
  const saveColumnBuilderBtn=document.getElementById('saveColumnBuilderBtn');if(saveColumnBuilderBtn)saveColumnBuilderBtn.onclick=saveCustomColumnFromBuilder;
  const openFormulaManualFromBuilder=document.getElementById('openFormulaManualFromBuilder');if(openFormulaManualFromBuilder)openFormulaManualFromBuilder.onclick=openFormulaManual;
  document.getElementById('saveBtn').onclick=()=>persistActiveReport(true);
  document.getElementById('deleteReportBtn').onclick=deleteReport;
  document.getElementById('exportCsvBtn').onclick=exportCsv;
  document.getElementById('exportGeneralCsvBtn').onclick=exportGeneralCsv;
  document.getElementById('printBtn').onclick=()=>window.print();
  document.getElementById('reportTitle').onchange=e=>updateReportField('title',e.target.value);
  document.getElementById('reportDate').onchange=e=>updateReportField('date',e.target.value);
  document.getElementById('vatInput').oninput=e=>updateReportField('vat',e.target.value);
  document.getElementById('visibilitySelect').onchange=e=>updateReportField('visibility',e.target.value);
  document.getElementById('zoomSelect').onchange=e=>updateReportField('zoom',e.target.value);
  const exportBackupBtn=document.getElementById('exportBackupBtn');if(exportBackupBtn)exportBackupBtn.onclick=exportBackup;
  const importBackupBtn=document.getElementById('importBackupBtn');if(importBackupBtn)importBackupBtn.onclick=triggerImportBackup;
  const importBackupInput=document.getElementById('importBackupInput');if(importBackupInput)importBackupInput.onchange=e=>importBackupFile(e.target.files[0]);
}

window.addEventListener('oprosy-auth-ready',initApp);
window.addEventListener('oprosy-profile-updated',initApp);
window.addEventListener('oprosy-workspace-refresh',initApp);


function flushActiveReportOnPageHide(){
  try{
    const r=activeReport();
    if(!r?.editable)return;
    syncVisibleInputsToState();
    const payload=JSON.stringify({action:'saveReport',report:r});
    fetch('/api/app',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      credentials:'same-origin',
      body:payload,
      keepalive:true
    }).catch(()=>{});
  }catch(_){}
}

window.addEventListener('beforeunload',flushActiveReportOnPageHide);
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden') flushActiveReportOnPageHide();
});

bindMainEvents();
// ===== QUOTAS MODULE =====
// Исправленная версия с поиском по всем городам/регионам.
const QUOTA_DEFAULT_DATA = {
  'приморский край': {main:161.14, age18:161.14, age25:161.14, convMain:0, conv18:0, conv25:0},
  'смоленская область': {main:161.14, age18:161.14, age25:161.14, convMain:0, conv18:0, conv25:0},
  'смоленск': {main:161.14, age18:161.14, age25:161.14, convMain:0, conv18:0, conv25:0, basedOn:'смоленская область'},
  'скфо': {main:161.14, age18:161.14, age25:161.14, convMain:0, conv18:0, conv25:0},
  'дфо': {main:161.14, age18:161.14, age25:161.14, convMain:0, conv18:0, conv25:0},
  'москва': {main:161.14, age18:161.14, age25:161.14, convMain:0, conv18:0, conv25:0},
  'санкт-петербург': {main:161.14, age18:161.14, age25:161.14, convMain:0, conv18:0, conv25:0},
  'спб': {main:161.14, age18:161.14, age25:161.14, convMain:0, conv18:0, conv25:0}
};

const QUOTA_DATA_KEY = 'manualPollBudget_quotaDataEngine_v2_fixed_search';
let lastQuotaCalculation = null;
let selectedQuotaCityKeys = [];

function normalizeCityName(v){
  return String(v || '').trim().toLowerCase();
}

function displayCityName(key){
  return String(key || '').replace(/\b\p{L}/gu, ch => ch.toUpperCase());
}

function getQuotaData(){
  const raw = localStorage.getItem(QUOTA_DATA_KEY);
  if(raw){
    try{return JSON.parse(raw)}catch(e){}
  }
  return {...QUOTA_DEFAULT_DATA};
}

function saveQuotaData(data){
  localStorage.setItem(QUOTA_DATA_KEY, JSON.stringify(data));
}

function resetQuotaData(){
  if(!confirm('Снести все данные справочника квот? История основной таблицы останется, но справочник городов/цен/конверсий будет очищен.')){
    return;
  }
  localStorage.removeItem(QUOTA_DATA_KEY);
  selectedQuotaCityKeys = [];
  lastQuotaCalculation = null;
  refreshQuotaLists();
  const result = document.getElementById('quotaResult');
  if(result) result.innerHTML = '';
  const preview = document.getElementById('quotaDataPreview');
  if(preview) preview.innerHTML = '';
  setQuotaDataStatus('Данные справочника снесены. Можно загрузить новый файл или добавить вручную.', true);
}

function getSurveyMarkup(){
  const type = document.getElementById('surveyLengthSelect')?.value || 'standard';
  if(type === 'long50') return 0.20;
  if(type === 'long70') return 0.30;
  if(type === 'custom') return parseNumber(document.getElementById('customMarkupInput')?.value) / 100;
  return 0;
}

function applySurveyMarkup(price){
  return parseNumber(price) * (1 + getSurveyMarkup());
}

function refreshQuotaLists(){
  const data = getQuotaData();
  const keys = Object.keys(data);
  selectedQuotaCityKeys = selectedQuotaCityKeys.filter(k => keys.includes(k));

  const base = document.getElementById('manualBaseSelect');
  if(base){
    base.innerHTML = `<option value="">Не брать основу</option>` + keys
      .sort((a,b)=>a.localeCompare(b,'ru'))
      .map(k => `<option value="${escapeHtml(k)}">${escapeHtml(displayCityName(k))}</option>`)
      .join('');
  }

  renderSelectedQuotaCities();
  renderCitySuggestions(false);
  renderQuotaDataPreview();
}

function getSelectedQuotaCities(){
  return selectedQuotaCityKeys.slice();
}

function addSelectedQuotaCity(key){
  key = normalizeCityName(key);
  const data = getQuotaData();
  if(!data[key]) return;

  if(!selectedQuotaCityKeys.includes(key)){
    selectedQuotaCityKeys.push(key);
  }

  const input = document.getElementById('quotaCitySearchInput');
  if(input) input.value = '';

  renderSelectedQuotaCities();
  renderCitySuggestions(false);
}

function removeSelectedQuotaCity(key){
  selectedQuotaCityKeys = selectedQuotaCityKeys.filter(k => k !== key);
  renderSelectedQuotaCities();
  renderCitySuggestions(false);
}

function renderSelectedQuotaCities(){
  const wrap = document.getElementById('selectedQuotaCities');
  if(!wrap) return;

  if(!selectedQuotaCityKeys.length){
    wrap.innerHTML = '<span class="search-empty">Пока ничего не выбрано</span>';
    return;
  }

  wrap.innerHTML = selectedQuotaCityKeys.map(k => `
    <span class="city-pill">
      ${escapeHtml(displayCityName(k))}
      <button type="button" class="quota-remove-city-btn" data-quota-city="${escapeHtml(k)}">×</button>
    </span>
  `).join('');
}

function renderCitySuggestions(open = true){
  const box = document.getElementById('quotaCitySuggestions');
  const input = document.getElementById('quotaCitySearchInput');
  if(!box || !input) return;

  const data = getQuotaData();
  const query = normalizeCityName(input.value);

  const keys = Object.keys(data)
    .filter(k => !selectedQuotaCityKeys.includes(k))
    .filter(k => !query || k.includes(query) || displayCityName(k).toLowerCase().includes(query))
    .sort((a,b)=>a.localeCompare(b,'ru'))
    .slice(0,120);

  if(!open && !query){
    box.classList.remove('open');
    box.innerHTML = '';
    return;
  }

  if(!keys.length){
    box.classList.add('open');
    box.innerHTML = '<div class="search-empty">Ничего не найдено. Можно добавить город во вкладке «Ручной ввод».</div>';
    return;
  }

  box.classList.add('open');
  box.innerHTML = keys.map(k => `
    <div class="city-suggestion" data-key="${escapeHtml(k)}">
      ${escapeHtml(displayCityName(k))}
    </div>
  `).join('');

  box.querySelectorAll('.city-suggestion').forEach(el=>{
    el.onclick = () => addSelectedQuotaCity(el.dataset.key);
  });
}

function openQuotaModal(){
  refreshQuotaLists();
  document.getElementById('quotaModal').classList.remove('hidden');
}

function closeQuotaModal(){
  document.getElementById('quotaModal').classList.add('hidden');
}

function switchQuotaTab(tab){
  document.querySelectorAll('.quota-tab').forEach(btn=>btn.classList.toggle('active', btn.dataset.tab === tab));
  const calc = document.getElementById('quotaTabCalc');
  const data = document.getElementById('quotaTabData');
  const manual = document.getElementById('quotaTabManual');
  if(calc) calc.classList.toggle('hidden', tab !== 'calc');
  if(data) data.classList.toggle('hidden', tab !== 'data');
  if(manual) manual.classList.toggle('hidden', tab !== 'manual');
  refreshQuotaLists();
}

function calculateQuotas(){
  const data = getQuotaData();
  const cities = getSelectedQuotaCities();

  if(!cities.length){
    document.getElementById('quotaResult').innerHTML = `<div class="quota-note warn">Выберите один или несколько городов/регионов через поиск.</div>`;
    return;
  }

  const mainCount = parseNumber(document.getElementById('quotaMainInput').value);
  const age18Count = parseNumber(document.getElementById('quotaAge18Input').value);
  const age25Count = parseNumber(document.getElementById('quotaAge25Input').value);
  const markup = getSurveyMarkup();

  const allRows = [];
  let grandTotal = 0;
  let grandCount = 0;

  cities.forEach(cityKey=>{
    const prices = data[cityKey] || {main:161.14, age18:161.14, age25:161.14, convMain:0, conv18:0, conv25:0};

    const rows = [
      {city:displayCityName(cityKey), audience:'Общая', basePrice:prices.main, conv:prices.convMain, count:mainCount},
      {city:displayCityName(cityKey), audience:'18-24', basePrice:prices.age18, conv:prices.conv18, count:age18Count},
      {city:displayCityName(cityKey), audience:'25-34', basePrice:prices.age25, conv:prices.conv25, count:age25Count}
    ].map(r => {
      const finalPrice = applySurveyMarkup(parseNumber(r.basePrice));
      const cost = finalPrice * parseNumber(r.count);
      return {...r, finalPrice, cost};
    });

    rows.forEach(r=>{
      allRows.push(r);
      grandTotal += r.cost;
      grandCount += r.count;
    });
  });

  lastQuotaCalculation = {cities, rows:allRows, total:grandTotal, totalCount:grandCount, markup};

  const html = `
    <h3>Итоговая таблица квот</h3>
    <table class="quota-table">
      <thead>
        <tr>
          <th>Город / регион</th>
          <th>Аудитория</th>
          <th>Базовая цена</th>
          <th>Длина опроса</th>
          <th>Итоговая цена</th>
          <th>Конверсия</th>
          <th>Выборка</th>
          <th>Стоимость</th>
        </tr>
      </thead>
      <tbody>
        ${allRows.map(r => `
          <tr>
            <td>${escapeHtml(r.city)}</td>
            <td>${r.audience}</td>
            <td>${money(r.basePrice)}</td>
            <td>+${Math.round(markup*100)}%</td>
            <td>${money(r.finalPrice)}</td>
            <td>${r.conv ? percent(r.conv) : '—'}</td>
            <td>${num(r.count)}</td>
            <td>${money(r.cost)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div class="quota-total">Финал: ${num(grandCount)} анкет · ${money(grandTotal)}</div>
    <div class="quota-note">
      Правило длины опроса: от 50 вопросов +20%, от 70 вопросов +30%, либо своя надбавка.
      Конверсии хранятся в справочнике города и выводятся для контроля.
    </div>
  `;

  document.getElementById('quotaResult').innerHTML = html;
}

function addQuotaToMainTable(){
  if(!lastQuotaCalculation) calculateQuotas();
  if(!lastQuotaCalculation) return;

  const r = activeReport();
  if(!r || !r.editable){
    alert('Чтобы добавить квоты в таблицу, откройте свою статистику. Чужие статистики доступны только для просмотра.');
    return;
  }

  lastQuotaCalculation.rows.forEach(q=>{
    if(q.count > 0){
      r.rows.push({
        social: `${q.city} — ${q.audience}`,
        collected: 0,
        spent: 0,
        need: q.count,
        status: 'РАБОТАЕТ'
      });
    }
  });

  saveState();
  render();
  closeQuotaModal();
}

function saveManualCity(){
  const data = getQuotaData();

  const city = normalizeCityName(document.getElementById('manualCityInput').value);
  const baseKey = normalizeCityName(document.getElementById('manualBaseSelect').value);

  if(!city){
    setManualStatus('Введите город / регион', false);
    return;
  }

  const base = baseKey && data[baseKey] ? data[baseKey] : {main:161.14, age18:161.14, age25:161.14, convMain:0, conv18:0, conv25:0};

  const main = parseOptionalNumber(document.getElementById('manualPriceMainInput').value, base.main);
  const age18 = parseOptionalNumber(document.getElementById('manualPrice18Input').value, base.age18);
  const age25 = parseOptionalNumber(document.getElementById('manualPrice25Input').value, base.age25);

  const convMain = parseOptionalNumber(document.getElementById('manualConvMainInput').value, base.convMain || 0);
  const conv18 = parseOptionalNumber(document.getElementById('manualConv18Input').value, base.conv18 || 0);
  const conv25 = parseOptionalNumber(document.getElementById('manualConv25Input').value, base.conv25 || 0);

  data[city] = {main, age18, age25, convMain, conv18, conv25, basedOn:baseKey || ''};
  saveQuotaData(data);
  refreshQuotaLists();
  addSelectedQuotaCity(city);

  setManualStatus(`${displayCityName(city)} сохранен и добавлен в расчет.`, true);
  document.getElementById('manualCityInput').value = '';
}

function parseOptionalNumber(value, fallback){
  const s = String(value || '').trim();
  if(!s) return fallback;
  return parseNumber(s);
}

function setManualStatus(text, ok){
  const el = document.getElementById('manualCityStatus');
  if(!el) return;
  el.textContent = text;
  el.style.color = ok ? '#baffd5' : '#ffb8b8';
}

function setQuotaDataStatus(text, ok){
  const el = document.getElementById('quotaDataStatus');
  if(!el) return;
  el.textContent = text;
  el.style.color = ok ? '#baffd5' : '#ffb8b8';
}

async function loadQuotaFile(){
  const input = document.getElementById('quotaFileInput');
  const file = input?.files?.[0];

  if(!file){
    setQuotaDataStatus('Выберите файл', false);
    return;
  }

  try{
    const ext = file.name.split('.').pop().toLowerCase();
    let rows = [];

    if(ext === 'json'){
      rows = JSON.parse(await file.text());
      if(!Array.isArray(rows)) rows = Object.entries(rows).map(([city,v])=>({city,...v}));
    }else if(ext === 'csv'){
      rows = parseCsv(await file.text());
    }else if(['xlsx','xls'].includes(ext)){
      if(typeof XLSX === 'undefined'){
        setQuotaDataStatus('Для XLSX нужна библиотека SheetJS. Интернет/CDN недоступен. Сохрани файл как CSV и загрузи его.', false);
        return;
      }
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, {type:'array'});
      const sheet = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(sheet, {defval:''});
    }else{
      setQuotaDataStatus('Поддерживаются CSV, JSON, XLSX', false);
      return;
    }

    const parsed = rowsToQuotaData(rows);
    const merged = {...getQuotaData(), ...parsed};
    saveQuotaData(merged);
    refreshQuotaLists();

    setQuotaDataStatus(`Файл загружен. Добавлено/обновлено записей: ${Object.keys(parsed).length}. Всего в справочнике: ${Object.keys(merged).length}`, true);
  }catch(e){
    setQuotaDataStatus('Ошибка загрузки файла: ' + String(e), false);
  }
}

function parseCsv(text){
  const lines = text.replace(/^\ufeff/,'').split(/\r?\n/).filter(Boolean);
  if(!lines.length) return [];

  const sep = lines[0].includes(';') ? ';' : ',';
  const headers = splitCsvLine(lines[0], sep).map(h=>h.trim());

  return lines.slice(1).map(line=>{
    const cells = splitCsvLine(line, sep);
    const obj = {};
    headers.forEach((h,i)=>obj[h]=cells[i] || '');
    return obj;
  });
}

function splitCsvLine(line, sep){
  const out = [];
  let cur = '';
  let quote = false;

  for(let i=0;i<line.length;i++){
    const ch = line[i];
    if(ch === '"'){ quote = !quote; continue; }
    if(ch === sep && !quote){ out.push(cur); cur=''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function getField(obj, names){
  const keys = Object.keys(obj);
  for(const n of names){
    const found = keys.find(k=>normalizeHeader(k) === normalizeHeader(n));
    if(found) return obj[found];
  }
  return '';
}

function normalizeHeader(v){
  return String(v || '').toLowerCase().replace(/\s/g,'').replace(/[ё]/g,'е').replace(/[–—-]/g,'-');
}

function rowsToQuotaData(rows){
  const data = {};

  rows.forEach(row=>{
    const city = normalizeCityName(getField(row, ['город','регион','город/регион','область','субъект','название','city','region']));
    if(!city) return;

    const main = parseNumber(getField(row, ['цена общая','цена анкеты','общая','main','price','price main'])) || 161.14;
    const age18 = parseNumber(getField(row, ['цена 18-24','18-24','price 18-24','age18'])) || main;
    const age25 = parseNumber(getField(row, ['цена 25-34','25-34','price 25-34','age25'])) || main;

    const convMain = parseNumber(getField(row, ['конверсия общая','конверсия','conv main','conversion']));
    const conv18 = parseNumber(getField(row, ['конверсия 18-24','conv 18-24','conversion 18-24']));
    const conv25 = parseNumber(getField(row, ['конверсия 25-34','conv 25-34','conversion 25-34']));

    data[city] = {main, age18, age25, convMain, conv18, conv25};
  });

  return data;
}

function renderQuotaDataPreview(){
  const data = getQuotaData();
  const el = document.getElementById('quotaDataPreview');
  if(!el) return;

  const rows = Object.entries(data).sort((a,b)=>a[0].localeCompare(b[0],'ru')).slice(0,80);

  el.innerHTML = `
    <h3>Текущий справочник: ${Object.keys(data).length} записей</h3>
    <table class="quota-table">
      <thead>
        <tr>
          <th>Город / регион</th>
          <th>Общая</th>
          <th>18–24</th>
          <th>25–34</th>
          <th>Конв. общая</th>
          <th>Конв. 18–24</th>
          <th>Конв. 25–34</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(([city,v])=>`
          <tr>
            <td>${escapeHtml(displayCityName(city))}</td>
            <td>${money(v.main)}</td>
            <td>${money(v.age18)}</td>
            <td>${money(v.age25)}</td>
            <td>${v.convMain ? percent(v.convMain) : '—'}</td>
            <td>${v.conv18 ? percent(v.conv18) : '—'}</td>
            <td>${v.conv25 ? percent(v.conv25) : '—'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

(function initQuotaModule(){
  const btn = document.getElementById('quotaBtn');
  if(btn) btn.onclick = openQuotaModal;

  const closeBtn = document.getElementById('closeQuotaBtn');
  if(closeBtn) closeBtn.onclick = closeQuotaModal;

  const backdrop = document.getElementById('quotaBackdrop');
  if(backdrop) backdrop.onclick = closeQuotaModal;

  document.querySelectorAll('.quota-tab').forEach(btn=>{
    btn.onclick = () => switchQuotaTab(btn.dataset.tab);
  });

  const calcBtn = document.getElementById('calculateQuotaBtn');
  if(calcBtn) calcBtn.onclick = calculateQuotas;

  const addBtn = document.getElementById('addQuotaToTableBtn');
  if(addBtn) addBtn.onclick = addQuotaToMainTable;

  const saveManualBtn = document.getElementById('saveManualCityBtn');
  if(saveManualBtn) saveManualBtn.onclick = saveManualCity;

  const loadFileBtn = document.getElementById('loadQuotaFileBtn');
  if(loadFileBtn) loadFileBtn.onclick = loadQuotaFile;

  const resetBtn = document.getElementById('resetQuotaDataBtn');
  if(resetBtn) resetBtn.onclick = resetQuotaData;

  const searchInput = document.getElementById('quotaCitySearchInput');
  if(searchInput){
    searchInput.addEventListener('input', () => renderCitySuggestions(true));
    searchInput.addEventListener('focus', () => renderCitySuggestions(true));
    searchInput.addEventListener('keydown', e=>{
      if(e.key === 'Enter'){
        e.preventDefault();
        const first = document.querySelector('#quotaCitySuggestions .city-suggestion');
        if(first) addSelectedQuotaCity(first.dataset.key);
      }
    });
  }

  document.addEventListener('click', e=>{
    const box = document.getElementById('quotaCitySuggestions');
    const input = document.getElementById('quotaCitySearchInput');
    if(box && input && !box.contains(e.target) && e.target !== input){
      box.classList.remove('open');
    }
  });

  refreshQuotaLists();
})();


const exportBackupBtn = document.getElementById('exportBackupBtn');
if(exportBackupBtn) exportBackupBtn.onclick = exportBackup;

const importBackupBtn = document.getElementById('importBackupBtn');
if(importBackupBtn) importBackupBtn.onclick = triggerImportBackup;

const importBackupInput = document.getElementById('importBackupInput');
if(importBackupInput) importBackupInput.onchange = e => importBackupFile(e.target.files[0]);
