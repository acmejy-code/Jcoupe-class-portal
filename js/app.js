import { firebaseConfig } from "./firebase-config.js?v=1.8.4";
import { PORTAL_CONFIG } from "./portal-config.js?v=1.8.4";
import { DRIVE_BRIDGE_CONFIG, isDriveBridgeConfigured } from "./drive-bridge-config.js?v=1.8.4";

const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const pad=n=>String(n).padStart(2,"0");
const toYmd=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseLocalDate=s=>new Date(`${s}T12:00:00`);
const calendarWeekdays=["일","월","화","수","목","금","토"];
const urlParams=new URLSearchParams(location.search);
const projectId=urlParams.get("project")||PORTAL_CONFIG.defaultProjectId;
const adminPreviewMode=urlParams.get("adminPreview")==="1";
const previewRunParam=urlParams.get("previewRun")||"";
const classKey=`class_portal_selected_${projectId}`;

let meta=null;
let classDocs={};
let materials=[];
let notices=[];
let noticeType="전체";
let noticeQuery="";
let selectedClass=localStorage.getItem(classKey)||"";
let currentView="progress";
let studentCalendarMonth=new Date();
let studentCalendarInitialized=false;
let materialCategory="전체";
let materialQuery="";
let publicAssessments=[];
let selectedAssessmentId=null;
let fb=null;
let authUser=null;
let assessmentContent=null;
let activeAttempt=null;
let assessmentAnswers={};
let assessmentDirty=false;
let assessmentSaving=false;
let adminPreviewData=null;
let activeAttemptUnsubscribe=null;
let assessmentTimerHandle=null;
let assessmentAutosaveHandle=null;
let assessmentServerOffsetMs=0;
let assessmentAutoSubmitBusy=false;
let assessmentSubmitRequested=false;
let assessmentLastUrgentSaveMs=0;
let assessmentEditRevision=0;
let assessmentLastClientEditAtMs=0;
let assessmentRecoveryAvailable=false;
let assessmentLastServerSaveMs=0;
let assessmentLastPresenceWriteMs=0;
let assessmentAutosaveIntervalCurrent=0;
let assessmentHiddenSinceMs=0;
let assessmentHiddenTimer=null;
let assessmentHiddenEventRecorded=false;
let lastFocusEventMs=0;
let pendingMonitorEvents=[];
let wasOfflineDuringAttempt=false;

// v1.8.4 연결 복구 · Drive 업로드 안정화 + 교사 PDF 열람 안정화 + 구조화 찬반 입론서
let activeTwoStagePhase=null; // PHASE2 | MATERIAL | PHASE3
let twoStageAttempt=null;
let twoStageContent=null;
let twoStagePhase2={};
let twoStagePhase3Outline={};
let twoStagePhase3Essay=""; // 구조화 답안을 조합한 호환용 텍스트
let twoStagePhase3LegacyEssay="";
let twoStageDirty=false;
let twoStageSaving=false;
let twoStageSaveHandle=null;
let twoStageLastServerSaveMs=0;
const TWO_STAGE_SERVER_BACKUP_MS=5*60*1000;
let twoStageMonitorEvents=[];
let twoStageReplaceMaterialId=null;
let twoStageHiddenSince=0;
let twoStageHiddenTimer=null;
let twoStageHiddenRecorded=false;

function setStatus(text,type=""){
  $("syncStatus").textContent=text;
  $("statusDot").className=`status-dot ${type}`.trim();
}
function fmtDate(s){
  if(!s)return "-";
  const d=new Date(`${s}T12:00:00`);
  if(Number.isNaN(d.getTime()))return s;
  return `${d.getMonth()+1}월 ${d.getDate()}일`;
}
function fmtDateTime(v){
  if(!v)return "-";
  try{
    const d=v?.toDate?v.toDate():new Date(v);
    if(Number.isNaN(d.getTime()))return "-";
    return `${d.getFullYear()}.${d.getMonth()+1}.${d.getDate()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  }catch{return "-";}
}
function fmtMaterialDate(v){
  if(!v)return "-";
  const d=new Date(v);
  if(Number.isNaN(d.getTime()))return String(v).slice(0,10)||"-";
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,"0")}.${String(d.getDate()).padStart(2,"0")}`;
}
function classes(){
  return (meta?.classes&&Array.isArray(meta.classes)&&meta.classes.length)?meta.classes:PORTAL_CONFIG.fallbackClasses;
}
function setView(name){
  currentView=name;
  document.querySelectorAll(".portal-view").forEach(v=>v.classList.toggle("active",v.id===`view-${name}`));
  document.querySelectorAll(".portal-tab").forEach(b=>b.classList.toggle("active",b.dataset.view===name));
  if(name==="progress"){ renderSelected(); renderStudentCalendar(); }
  if(name==="materials") renderMaterials();
  if(name==="notices") renderNotices();
  if(name==="assessment") renderAssessmentPortal();
}
function renderMeta(){
  $("portalTitle").textContent=meta?.portalTitle||PORTAL_CONFIG.fallbackTitle;
  $("portalSubtitle").textContent=meta?.portalSubtitle||PORTAL_CONFIG.fallbackSubtitle;
  const vb=$("portalVersionBadge");if(vb)vb.textContent=`v${PORTAL_CONFIG.version}`;
  renderClassTabs();
}
function renderClassTabs(){
  const list=classes();
  if(!selectedClass||!list.includes(selectedClass)) selectedClass=list[0]||"";
  if(selectedClass&&!adminPreviewMode) localStorage.setItem(classKey,selectedClass);
  $("classTabs").innerHTML=list.map(c=>`<button class="class-btn ${c===selectedClass?"active":""}" data-class="${esc(c)}">${esc(c)}반</button>`).join("");
  document.querySelectorAll(".class-btn").forEach(b=>b.onclick=()=>{
    selectedClass=b.dataset.class;
    if(!adminPreviewMode)localStorage.setItem(classKey,selectedClass);
    renderClassTabs();
    renderSelected();
    renderStudentCalendar();
    renderMaterials();
    if(currentView==="assessment")renderAssessmentPortal();
  });
}
function calendarInSemester(date){
  if(!meta)return false;
  const start=String(meta.semesterStart||"0000-01-01");
  const end=String(meta.semesterEnd||"9999-12-31");
  return date>=start&&date<=end;
}
function calendarNoClassDate(date){
  return (Array.isArray(meta?.noClassDates)?meta.noClassDates:[]).map(String).includes(date);
}
function calendarEventsOn(date){
  return (Array.isArray(meta?.academicEvents)?meta.academicEvents:[]).filter(e=>String(e?.date||"")===date);
}
function calendarScheduledSlots(date,className=selectedClass){
  if(!meta||!className||!calendarInSemester(date)||calendarNoClassDate(date))return [];
  const day=String(parseLocalDate(date).getDay());
  const rows=meta.weeklyTimetable?.[day]||meta.weeklyTimetable?.[Number(day)]||[];
  return (Array.isArray(rows)?rows:[])
    .filter(s=>String(s?.className||"")===String(className))
    .map(s=>({className:String(s.className),period:Number(s.period||0)}))
    .filter(s=>s.period>0)
    .sort((a,b)=>a.period-b.period);
}
function calendarClassData(){ return selectedClass?classDocs[selectedClass]:null; }
function calendarRecords(){
  const data=calendarClassData();
  const rows=Array.isArray(data?.calendarRecords)?data.calendarRecords:(Array.isArray(data?.recent)?[...data.recent].reverse():[]);
  return rows.slice().sort((a,b)=>String(a?.date||"").localeCompare(String(b?.date||""))||Number(a?.period||0)-Number(b?.period||0));
}
function calendarRecordsOn(date){ return calendarRecords().filter(r=>String(r?.date||"")===date); }
function calendarSkipKeys(){
  const skips=Array.isArray(calendarClassData()?.scheduleSkips)?calendarClassData().scheduleSkips:[];
  return new Set(skips.map(x=>`${String(x?.date||"")}|${Number(x?.period||0)}`));
}
function nextStudentScheduledSlotAfterRecord(record){
  if(!record||!selectedClass||!meta)return null;
  const end=String(meta.semesterEnd||record.date||"");
  let d=parseLocalDate(String(record.date||""));
  if(Number.isNaN(d.getTime()))return null;
  const skips=calendarSkipKeys();
  for(let i=0;i<370;i++){
    const date=toYmd(d);
    if(end&&date>end)break;
    for(const slot of calendarScheduledSlots(date,selectedClass)){
      if(date===record.date&&Number(slot.period)<=Number(record.period||0))continue;
      if(skips.has(`${date}|${Number(slot.period)}`))continue;
      return {date,period:Number(slot.period)};
    }
    d.setDate(d.getDate()+1);
  }
  return null;
}
function nextStartPreviewForStudentSlot(date,period){
  const rows=calendarRecords().filter(r=>String(r.date)<date||(String(r.date)===date&&Number(r.period||0)<Number(period)));
  const prev=rows[rows.length-1];
  if(!prev?.nextStart)return "";
  const next=nextStudentScheduledSlotAfterRecord(prev);
  return next&&next.date===date&&Number(next.period)===Number(period)?String(prev.nextStart):"";
}
function syncStudentCalendarMonth(){
  if(studentCalendarInitialized)return;
  const today=toYmd(new Date());
  let target=new Date();
  const start=String(meta?.semesterStart||"");
  const end=String(meta?.semesterEnd||"");
  if(start&&today<start)target=parseLocalDate(start);
  else if(end&&today>end)target=parseLocalDate(end);
  studentCalendarMonth=new Date(target.getFullYear(),target.getMonth(),1);
  studentCalendarInitialized=true;
}
function shiftStudentCalendarMonth(delta){
  studentCalendarMonth=new Date(studentCalendarMonth.getFullYear(),studentCalendarMonth.getMonth()+delta,1);
  studentCalendarInitialized=true;
  renderStudentCalendar();
}
function renderStudentCalendar(){
  const cal=$("studentCalendar");
  if(!cal)return;
  if(!meta){
    $("studentMonthTitle").textContent="-";
    cal.innerHTML=`<div class="student-calendar-empty">학사일정 정보를 불러오는 중입니다.</div>`;
    return;
  }
  syncStudentCalendarMonth();
  const y=studentCalendarMonth.getFullYear(),m=studentCalendarMonth.getMonth();
  $("studentMonthTitle").textContent=`${y}년 ${m+1}월`;
  $("studentCalendarTitle").textContent=selectedClass?`${selectedClass}반 수업 달력`:"수업 달력";
  $("studentCalendarSubtitle").textContent=selectedClass?`${selectedClass}반 수업 일정과 학교 학사일정을 함께 확인할 수 있습니다.`:"반을 선택하면 수업 일정과 학교 학사일정을 함께 확인할 수 있습니다.";
  cal.innerHTML="";
  calendarWeekdays.forEach(x=>cal.insertAdjacentHTML("beforeend",`<div class="student-cal-dow">${x}</div>`));
  if(!selectedClass){
    cal.insertAdjacentHTML("beforeend",`<div class="student-calendar-empty">먼저 반을 선택해 주세요.</div>`);
    return;
  }
  const first=new Date(y,m,1).getDay(),last=new Date(y,m+1,0).getDate(),prevLast=new Date(y,m,0).getDate();
  const today=toYmd(new Date());
  const skips=calendarSkipKeys();
  for(let i=0;i<42;i++){
    let day,mm=m,yy=y,muted=false;
    if(i<first){day=prevLast-first+i+1;mm=m-1;muted=true;if(mm<0){mm=11;yy--;}}
    else if(i>=first+last){day=i-first-last+1;mm=m+1;muted=true;if(mm>11){mm=0;yy++;}}
    else day=i-first+1;
    const date=`${yy}-${pad(mm+1)}-${pad(day)}`;
    const cell=document.createElement("div");
    cell.className=`student-cal-day${muted?" muted":""}${date===today?" is-today":""}${calendarNoClassDate(date)?" no-class":""}`;
    cell.innerHTML=`<div class="student-cal-date"><span>${day}</span>${date===today?"<b>오늘</b>":""}</div>`;
    for(const e of calendarEventsOn(date)){
      const ev=document.createElement("div");ev.className="student-cal-academic";ev.textContent=String(e.title||"");
      if(e.detail)ev.title=String(e.detail);cell.appendChild(ev);
    }
    const records=calendarRecordsOn(date);
    const recordKeys=new Set(records.map(r=>`${date}|${Number(r.period||0)}`));
    records.forEach(r=>{
      const el=document.createElement("div");el.className="student-cal-record";
      el.innerHTML=`<strong>${Number(r.period||0)?`${Number(r.period)}교시 · `:""}${esc(r.type||r.session||"수업")}</strong><span>${esc(r.title||r.detail||"수업 기록")}</span>${r.nextStart?`<small>다음: ${esc(r.nextStart)}</small>`:""}`;
      cell.appendChild(el);
    });
    calendarScheduledSlots(date,selectedClass).forEach(slot=>{
      const key=`${date}|${Number(slot.period)}`;
      if(recordKeys.has(key)||skips.has(key))return;
      const preview=nextStartPreviewForStudentSlot(date,slot.period);
      const el=document.createElement("div");el.className="student-cal-scheduled";
      el.innerHTML=`<strong>예정 · ${Number(slot.period)}교시</strong>${preview?`<small>↪ 다음: ${esc(preview)}</small>`:""}`;
      cell.appendChild(el);
    });
    cal.appendChild(cell);
  }
}

function renderSelected(){
  if(!selectedClass){ $("emptyNotice").classList.add("show"); return; }
  const data=classDocs[selectedClass];
  $("currentClassLabel").textContent=`${selectedClass}반 현재 진도`;
  $("historySubtitle").textContent=`${selectedClass}반 최근 공개 수업 기록`;

  if(!data||!data.current){
    $("currentTitle").textContent="아직 공개된 진도가 없습니다.";
    $("currentSession").textContent="";
    $("lastDate").textContent="-";
    $("lastType").textContent="-";
    $("detail").textContent="수업 진도가 공개되면 이곳에 표시됩니다.";
    $("nextStart").textContent="-";
    $("updatedAt").textContent=`최종 업데이트: ${data?.updatedAt?fmtDateTime(data.updatedAt):"-"}`;
    $("historyList").innerHTML=`<div class="empty">공개된 최근 수업 기록이 없습니다.</div>`;
    $("emptyNotice").classList.add("show");
    renderStudentCalendar();
    return;
  }

  $("emptyNotice").classList.remove("show");
  $("currentTitle").textContent=data.current?.title||data.current?.type||"수업 진도";
  $("currentSession").textContent=data.current?.session||"";
  $("lastDate").textContent=fmtDate(data.current?.date);
  $("lastType").textContent=data.current?.type||"-";
  $("detail").textContent=data.current?.detail||"수업 내용이 등록되어 있습니다.";
  $("nextStart").textContent=data.current?.nextStart||"다음 시작점 안내 없음";
  $("updatedAt").textContent=`최종 업데이트: ${fmtDateTime(data.updatedAt||data.current?.updatedAt)}`;

  const recent=Array.isArray(data.recent)?data.recent.slice(0,PORTAL_CONFIG.recentLimit):[];
  $("historyList").innerHTML=recent.length?recent.map(r=>`
    <div class="history-row">
      <div class="history-date">${esc(fmtDate(r.date))}</div>
      <div><div class="history-title">${esc(r.title||r.type||"수업")}</div><div class="history-detail">${esc(r.detail||"")}</div>${r.nextStart?`<div class="history-next">다음: ${esc(r.nextStart)}</div>`:""}</div>
      <div class="history-session">${esc(r.session||r.type||"")}</div>
    </div>`).join(""):`<div class="empty">공개된 최근 수업 기록이 없습니다.</div>`;
  renderStudentCalendar();
}
function renderMaterials(){
  $("materialClassLabel").textContent="수업 자료실";
  $("materialsSubtitle").textContent="모든 반이 함께 사용하는 공통 수업 자료입니다.";
  $("materialFilters").innerHTML=PORTAL_CONFIG.materialCategories.map(c=>`<button class="filter-btn ${materialCategory===c?"active":""}" data-category="${esc(c)}">${esc(c)}</button>`).join("");
  document.querySelectorAll("[data-category]").forEach(b=>b.onclick=()=>{materialCategory=b.dataset.category;renderMaterials();});

  const q=materialQuery.trim().toLowerCase();
  const rows=materials
    .filter(m=>m.isPublished!==false)
    .filter(m=>materialCategory==="전체"||m.category===materialCategory)
    .filter(m=>!q||[m.title,m.description,m.category,m.fileType].join(" ").toLowerCase().includes(q))
    .sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));
  $("materialCount").textContent=`${rows.length}개`;
  $("materialsList").innerHTML=rows.length?rows.map(m=>`
    <article class="material-item">
      <div class="material-item-top">
        <div class="material-badges"><span class="badge category">${esc(m.category||"수업자료")}</span><span class="badge type">${esc(m.fileType||"기타")}</span></div>
        <time>${esc(fmtMaterialDate(m.updatedAt||m.createdAt))}</time>
      </div>
      <h3>${esc(m.title||"수업 자료")}</h3>
      ${m.description?`<p>${esc(m.description)}</p>`:"<p class=\"muted-text\">자료 설명이 없습니다.</p>"}
      <div class="material-item-actions">
        ${m.previewUrl||m.driveUrl?`<a class="action-btn secondary" href="${esc(m.previewUrl||m.driveUrl)}" target="_blank" rel="noopener">미리 보기</a>`:""}
        ${m.downloadUrl?`<a class="action-btn primary" href="${esc(m.downloadUrl)}" target="_blank" rel="noopener">다운로드</a>`:""}
      </div>
    </article>`).join(""):`<div class="materials-empty"><b>등록된 자료가 없습니다.</b><span>선생님이 자료를 공개하면 이곳에 표시됩니다.</span></div>`;
}



const NOTICE_LABELS={ASSESSMENT:"수행평가 공지",GENERAL:"일반 공지"};
function renderNotices(){
  const filters=["전체","수행평가 공지","일반 공지"];
  $("noticeFilters").innerHTML=filters.map(c=>`<button class="filter-btn ${noticeType===c?"active":""}" data-notice-filter="${esc(c)}">${esc(c)}</button>`).join("");
  document.querySelectorAll("[data-notice-filter]").forEach(b=>b.onclick=()=>{noticeType=b.dataset.noticeFilter;renderNotices();});
  const q=noticeQuery.trim().toLowerCase();
  const rows=notices.filter(n=>noticeType==="전체"||(NOTICE_LABELS[n.type]||"일반 공지")===noticeType).filter(n=>!q||[n.title,n.body,NOTICE_LABELS[n.type]||""].join(" ").toLowerCase().includes(q)).sort((a,b)=>{
    const av=a.updatedAt?.seconds?Number(a.updatedAt.seconds):Date.parse(a.updatedAt||0)||0,bv=b.updatedAt?.seconds?Number(b.updatedAt.seconds):Date.parse(b.updatedAt||0)||0;return bv-av;
  });
  $("noticeCount").textContent=`${rows.length}개`;
  $("noticeList").innerHTML=rows.length?rows.map(n=>`<article class="student-notice-item"><div class="student-notice-top"><span class="student-notice-badge ${n.type==="ASSESSMENT"?"assessment":"general"}">${esc(NOTICE_LABELS[n.type]||"일반 공지")}</span><time>${esc(fmtDateTime(n.updatedAt||n.createdAt))}</time></div><h3>${esc(n.title||"공지")}</h3><div class="student-notice-body">${esc(n.body||"")}</div>${Array.isArray(n.attachments)&&n.attachments.length?`<div class="student-notice-files"><b>첨부파일</b>${n.attachments.map(a=>`<a href="${esc(a.url||"#")}" target="_blank" rel="noopener"><span>📎 ${esc(a.name||"첨부파일")}</span><small>${a.size?esc(formatNoticeBytes(a.size)):"열기"}</small></a>`).join("")}</div>`:""}</article>`).join(""):`<div class="materials-empty"><b>등록된 공지가 없습니다.</b><span>새 공지가 게시되면 이곳에 표시됩니다.</span></div>`;
}
function formatNoticeBytes(bytes){const n=Number(bytes||0);if(n<1024)return `${n}B`;if(n<1024*1024)return `${(n/1024).toFixed(1)}KB`;return `${(n/1024/1024).toFixed(1)}MB`;}

function normalizeNameKey(v){return String(v||"").replace(/\s+/g,"").trim();}
function timestampMs(v){
  try{
    if(!v)return 0;
    if(typeof v.toMillis==="function")return v.toMillis();
    if(typeof v.toDate==="function")return v.toDate().getTime();
    const d=new Date(v);return Number.isNaN(d.getTime())?0:d.getTime();
  }catch{return 0;}
}
function correctedNow(){return Date.now()+Number(assessmentServerOffsetMs||0);}
function assessmentDeadlineMs(a,attempt=activeAttempt){
  let started=timestampMs(a?.startedAt);
  if(!started)started=timestampMs(attempt?.startedAt)||Number(attempt?.startedAtLocal||0);
  if(!started||!Number(a?.durationMinutes||0))return 0;
  return started+(Number(a.durationMinutes||0)+Number(a.timeExtensionMinutes||0)+Number(attempt?.extraMinutes||0))*60000;
}
function formatRemaining(ms){
  if(!Number.isFinite(ms)||ms<=0)return "00:00";
  const total=Math.ceil(ms/1000),m=Math.floor(total/60),sec=total%60;
  return `${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
}
function assessmentTargetsSelectedClass(a){
  if(adminPreviewMode)return true;
  const targets=Array.isArray(a?.targetClasses)?a.targetClasses.map(String):[];
  if(!selectedClass)return true;
  return targets.includes(String(selectedClass));
}
function openAssessments(){
  if(adminPreviewData?.assessment)return [{...adminPreviewData.assessment}];
  return publicAssessments.filter(a=>{
    if(!assessmentTargetsSelectedClass(a))return false;
    if(isTwoStageAssessment(a))return ["PHASE2_OPEN","MATERIAL_WINDOW","PHASE3_OPEN"].includes(selectedClassStage(a));
    return ["WAITING","OPEN"].includes(a.status);
  }).sort((a,b)=>String(b.updatedAt?.seconds||b.updatedAt||"").localeCompare(String(a.updatedAt?.seconds||a.updatedAt||"")));
}
function assessmentById(id){
  if(adminPreviewData?.assessment&&String(adminPreviewData.assessment.id)===String(id))return {...adminPreviewData.assessment};
  return publicAssessments.find(a=>a.id===id)||null;
}
function applyAdminPreviewPayload(data){
  if(!adminPreviewMode||!data?.assessment||!data?.student)return;
  if(previewRunParam&&String(data.previewRun||"")!==String(previewRunParam))return;
  if(adminPreviewData&&String(adminPreviewData.previewRun||"")===String(data.previewRun||""))return;
  adminPreviewData=data;
  $("adminPreviewBanner")?.classList.remove("hidden");
  selectedClass=String(data.student.className||selectedClass||"");
  const start=data.startAt||"list";
  if(start==="login"){selectedAssessmentId=data.assessment.id;}
  if(start==="exam"){
    selectedAssessmentId=data.assessment.id;
    assessmentContent={assessmentId:data.assessment.id,title:data.assessment.title,instructions:data.assessment.instructions||"",questions:data.assessment.questions||[]};
    activeAttempt={studentId:String(data.student.studentId),studentName:String(data.student.name),status:"IN_PROGRESS",preview:true,startedAtLocal:Date.now()};
  }
  renderAssessmentPortal();
}
function adminPreviewHost(){
  if(window.opener&&!window.opener.closed)return window.opener;
  if(window.parent&&window.parent!==window)return window.parent;
  return null;
}
function notifyAdminPreviewReady(){
  const host=adminPreviewHost();
  if(!host)return;
  try{host.postMessage({type:"JCOUP_PREVIEW_READY"},location.origin);}catch{}
}
window.addEventListener("message",e=>{
  if(!adminPreviewMode||e.origin!==location.origin)return;
  const host=adminPreviewHost();
  if(host&&e.source!==host)return;
  if(e.data?.type==="JCOUP_ADMIN_PREVIEW")applyAdminPreviewPayload(e.data.payload);
});

function assessmentBackupKey(assessmentId,studentId){return `doktogul_assessment_backup_${projectId}_${assessmentId}_${studentId}`;}
function assessmentBackupMetaKey(assessmentId,studentId){return `${assessmentBackupKey(assessmentId,studentId)}_meta`;}
function assessmentArchiveKey(assessmentId,studentId){return `${assessmentBackupKey(assessmentId,studentId)}_archive`;}
function readLocalAssessmentBackup(assessmentId,studentId){
  try{return JSON.parse(localStorage.getItem(assessmentBackupKey(assessmentId,studentId))||"{}")||{};}catch{return {};}
}
function readLocalAssessmentMeta(assessmentId,studentId){
  try{return JSON.parse(localStorage.getItem(assessmentBackupMetaKey(assessmentId,studentId))||"{}")||{};}catch{return {};}
}
function writeLocalAssessmentMeta(assessmentId,studentId){
  if(adminPreviewMode)return;
  try{localStorage.setItem(assessmentBackupMetaKey(assessmentId,studentId),JSON.stringify({assessmentId:String(assessmentId),studentId:String(studentId),projectId:String(projectId),revision:Number(assessmentEditRevision||0),lastClientEditAt:assessmentLastClientEditAtMs?new Date(assessmentLastClientEditAtMs).toISOString():null,updatedAt:new Date().toISOString()}));}catch{}
}
function archiveAssessmentBackup(assessmentId,studentId,answers,reason="SUBMITTED"){
  if(adminPreviewMode)return;
  try{localStorage.setItem(assessmentArchiveKey(assessmentId,studentId),JSON.stringify({assessmentId:String(assessmentId),studentId:String(studentId),answers:answers||{},reason,archivedAt:new Date().toISOString(),expiresAt:Date.now()+48*60*60*1000}));}catch{}
}
function cleanupOldAssessmentArchives(){
  try{for(let i=localStorage.length-1;i>=0;i--){const k=localStorage.key(i);if(!k||!k.includes(`doktogul_assessment_backup_${projectId}_`)||!k.endsWith("_archive"))continue;try{const v=JSON.parse(localStorage.getItem(k)||"{}");if(Number(v.expiresAt||0)&&Date.now()>Number(v.expiresAt))localStorage.removeItem(k);}catch{}}}catch{}
}
function answersDiffer(a,b){
  const keys=new Set([...Object.keys(a||{}),...Object.keys(b||{})]);
  for(const k of keys)if(String(a?.[k]??"")!==String(b?.[k]??""))return true;
  return false;
}
async function uploadRecoveryDraftToSession(assessmentId,studentId,localAnswers,serverAnswers,reason="FORCED_FINALIZE"){
  if(adminPreviewMode||!fb?.auth?.currentUser||!assessmentId||!studentId)return false;
  const meta=readLocalAssessmentMeta(assessmentId,studentId);
  try{
    const sessionRef=fb.fsMod.doc(fb.db,"publicCourses",projectId,"assessments",String(assessmentId),"sessions",fb.auth.currentUser.uid);
    await fb.fsMod.setDoc(sessionRef,{
      recoveryPending:true,recoveryStudentId:String(studentId),recoveryAnswers:{...(localAnswers||{})},
      recoveryReason:String(reason||"FORCED_FINALIZE"),recoveryClientEditAt:meta.lastClientEditAt||null,
      recoveryClientRevision:Number(meta.revision||0),recoveryDetectedAt:fb.fsMod.serverTimestamp(),
      recoveryServerAnswers:{...(serverAnswers||{})},recoverySource:"LOCAL_BACKUP_AFTER_FORCED_FINALIZE"
    },{merge:true});
    localStorage.removeItem(`${assessmentBackupKey(assessmentId,studentId)}_recoveryUploadPending`);
    return true;
  }catch(err){
    console.warn("기기 최종답안 복구 스냅샷 업로드 실패",err);
    try{localStorage.setItem(`${assessmentBackupKey(assessmentId,studentId)}_recoveryUploadPending`,"1");}catch{}
    return false;
  }
}
async function preserveForcedFinalizationRecovery(next,studentId){
  const assessmentId=selectedAssessmentId;
  if(!assessmentId||!studentId)return false;
  const localAnswers=readLocalAssessmentBackup(assessmentId,studentId),serverAnswers=next?.answers||{};
  if(!Object.keys(localAnswers).length)return false;
  archiveAssessmentBackup(assessmentId,studentId,localAnswers,"FORCED_FINALIZE");
  const differs=answersDiffer(localAnswers,serverAnswers);
  if(!differs){
    try{localStorage.removeItem(assessmentBackupKey(assessmentId,studentId));localStorage.removeItem(assessmentBackupMetaKey(assessmentId,studentId));localStorage.removeItem(`${assessmentBackupKey(assessmentId,studentId)}_pendingSubmit`);}catch{}
    return false;
  }
  assessmentRecoveryAvailable=true;
  try{localStorage.setItem(`${assessmentBackupKey(assessmentId,studentId)}_recoveryUploadPending`,"1");}catch{}
  uploadRecoveryDraftToSession(assessmentId,studentId,localAnswers,serverAnswers,next?.submissionReason||"FORCED_FINALIZE").catch(()=>{});
  return true;
}
async function scanAndSyncRecoveryBackups(){
  if(adminPreviewMode||!fb?.auth?.currentUser)return;
  cleanupOldAssessmentArchives();
  const metas=[];
  try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(!k||!k.startsWith(`doktogul_assessment_backup_${projectId}_`)||!k.endsWith("_meta"))continue;try{const m=JSON.parse(localStorage.getItem(k)||"{}");if(m.assessmentId&&m.studentId)metas.push(m);}catch{}}}catch{}
  for(const m of metas){
    const localAnswers=readLocalAssessmentBackup(m.assessmentId,m.studentId);if(!Object.keys(localAnswers).length)continue;
    try{
      const ref=fb.fsMod.doc(fb.db,"publicCourses",projectId,"assessments",String(m.assessmentId),"attempts",String(m.studentId));
      const snap=await fb.fsMod.getDoc(ref);if(!snap.exists())continue;const at=snap.data();
      if(at.status==="SUBMITTED"&&at.forcedFinalized&&answersDiffer(localAnswers,at.answers||{}))await uploadRecoveryDraftToSession(m.assessmentId,m.studentId,localAnswers,at.answers||{},at.submissionReason||"FORCED_FINALIZE");
    }catch{}
  }
}
function setAssessmentFocusMode(enabled){document.body.classList.toggle("assessment-focus-mode",!!enabled);}
function stopAttemptWatch(){
  try{activeAttemptUnsubscribe?.();}catch{}
  activeAttemptUnsubscribe=null;
}
function stopAssessmentTimer(){
  if(assessmentTimerHandle)clearInterval(assessmentTimerHandle);
  assessmentTimerHandle=null;
}

const TWO_STAGE_MODE="ARGUMENT_TWO_STAGE";
const TWO_STAGE_LABELS={PHASE2_READY:"2차시 준비",PHASE2_OPEN:"2차시 평가",MATERIAL_WINDOW:"추가자료 사전등록",PHASE3_OPEN:"3차시 최종 작성",CLOSED:"완료"};
function isTwoStageAssessment(a){return a?.mode===TWO_STAGE_MODE;}
function selectedClassStage(a){return String(a?.classStages?.[selectedClass]?.stage||"PHASE2_READY");}
function twoStagePhaseForStage(stage){return stage==="PHASE2_OPEN"?"PHASE2":stage==="MATERIAL_WINDOW"?"MATERIAL":stage==="PHASE3_OPEN"?"PHASE3":null;}
function twoStageLocalKey(assessmentId,studentId,phase){return `jcoup_two_stage_${projectId}_${assessmentId}_${studentId}_${phase}`;}
function readTwoStageLocal(assessmentId,studentId,phase,fallback){try{return JSON.parse(localStorage.getItem(twoStageLocalKey(assessmentId,studentId,phase))||"")||fallback;}catch{return fallback;}}
function writeTwoStageLocal(assessmentId,studentId,phase,value){try{localStorage.setItem(twoStageLocalKey(assessmentId,studentId,phase),JSON.stringify(value));}catch{}}
function clearTwoStageLocal(assessmentId,studentId,phase){try{localStorage.removeItem(twoStageLocalKey(assessmentId,studentId,phase));}catch{}}
function twoStageTopic(){return (twoStageContent?.topicSets||[]).find(t=>String(t.id)===String(twoStagePhase2.topicId))||null;}
function twoStageProposition(){const t=twoStageTopic();return (t?.propositions||[]).find(p=>String(p.id)===String(twoStagePhase2.propositionId))||null;}
function normalizePreviewUrl(raw){
  const url=String(raw||"").trim();if(!url)return "";
  const m=url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([-\w]+)/i)||url.match(/[?&]id=([-\w]+)/i);
  if(m?.[1])return `https://drive.google.com/file/d/${m[1]}/preview`;
  return url;
}
function closeTwoStageViewer(){
  const el=$("twoStageViewerOverlay");if(el)el.remove();
}
function openSafeNewTab_(url){
  const target=String(url||"").trim();
  if(!target)return;
  const w=window.open(target,"_blank","noopener,noreferrer");
  if(!w){
    const a=document.createElement("a");a.href=target;a.target="_blank";a.rel="noopener noreferrer";a.style.display="none";
    document.body.appendChild(a);a.click();setTimeout(()=>a.remove(),0);
  }
}
function openTwoStageUrlViewer(title,url){
  closeTwoStageViewer();
  const originalUrl=String(url||"").trim(),src=normalizePreviewUrl(originalUrl);if(!src)return;
  const allowExternal=activeTwoStagePhase==="PHASE2";
  const overlay=document.createElement("div");overlay.id="twoStageViewerOverlay";overlay.className="two-stage-viewer-overlay";
  const sandbox=allowExternal
    ?"allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox"
    :"allow-scripts allow-same-origin allow-forms allow-downloads";
  overlay.innerHTML=`<div class="two-stage-viewer teacher-material-viewer ${allowExternal?"phase2-external":"phase3-locked"}">
    <div class="two-stage-viewer-head">
      <div><b>${esc(title||"자료 보기")}</b><small>${allowExternal?"2차시 · 새 탭 열기 허용":"3차시 · 새 탭/외부 이동 제한"}</small></div>
      <div class="two-stage-viewer-actions">${allowExternal?`<button type="button" id="openTwoStageNewTab">새 탭에서 보기</button>`:""}<button type="button" id="closeTwoStageViewer">닫기</button></div>
    </div>
    <div class="two-stage-viewer-frame-wrap">
      <iframe src="${esc(src)}" sandbox="${sandbox}" referrerpolicy="no-referrer" title="교사 제공 PDF"></iframe>
      ${allowExternal?"":`<div class="drive-popout-guard" title="3차시에는 새 탭 열기가 제한됩니다." aria-hidden="true"></div>`}
    </div>
  </div>`;
  document.body.appendChild(overlay);
  $("closeTwoStageViewer").onclick=closeTwoStageViewer;
  if(allowExternal&&$("openTwoStageNewTab"))$("openTwoStageNewTab").onclick=()=>openSafeNewTab_(originalUrl);
  overlay.onclick=e=>{if(e.target===overlay)closeTwoStageViewer();};
}
function assertDriveBridgeConfigured(){
  if(!isDriveBridgeConfigured())throw new Error("추가자료 Drive 연동 주소가 아직 설정되지 않았습니다. 선생님께 알려 주세요.");
}
function appendBridgeField_(form,name,value){const i=document.createElement("input");i.type="hidden";i.name=name;i.value=String(value??"");form.appendChild(i);}
function submitBridgeForm_(iframe,fields){
  const form=document.createElement("form");form.method="POST";form.action=DRIVE_BRIDGE_CONFIG.webAppUrl;form.target=iframe.name;form.style.display="none";
  Object.entries(fields||{}).forEach(([k,v])=>appendBridgeField_(form,k,v));document.body.appendChild(form);form.submit();setTimeout(()=>form.remove(),1000);
}
async function getDriveBridgeToken_(){const user=await ensureAssessmentAuth();return user.getIdToken();}
async function driveBridgeBaseFields_(role="student"){
  assertDriveBridgeConfigured();
  return {idToken:await getDriveBridgeToken_(),projectId,assessmentId:selectedAssessmentId,studentId:String(twoStageAttempt?.studentId||""),role};
}
async function driveBridgeRequest_(action,extra={},timeoutMs=65000){
  const base=await driveBridgeBaseFields_("student"),requestId=crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve,reject)=>{
    const iframe=document.createElement("iframe");iframe.name=`jcoupDriveBridge_${requestId.replace(/[^A-Za-z0-9_]/g,"")}`;iframe.style.display="none";document.body.appendChild(iframe);
    let done=false;const cleanup=()=>{window.removeEventListener("message",onMessage);try{iframe.remove();}catch{}};
    const timer=setTimeout(()=>{if(done)return;done=true;cleanup();reject(new Error("Drive 서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요."));},timeoutMs);
    // Apps Script HtmlService는 Google의 중간 프레임을 거칠 수 있어 e.source가
    // 우리가 만든 iframe.contentWindow와 정확히 일치하지 않을 수 있습니다.
    // 보안상 예측 불가능한 requestId + 고정 source 값을 함께 검증합니다.
    const onMessage=e=>{const d=e.data;if(done||!d||d.source!=="JCOUPE_DRIVE_BRIDGE"||String(d.requestId)!==String(requestId))return;done=true;clearTimeout(timer);cleanup();if(d.ok)resolve(d);else reject(new Error(d.error||"Drive 처리에 실패했습니다."));};
    window.addEventListener("message",onMessage);
    submitBridgeForm_(iframe,{action,requestId,...base,...extra});
  });
}
function arrayBufferToBase64_(buffer){
  const bytes=new Uint8Array(buffer),chunk=0x8000;let binary="";
  for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,Math.min(i+chunk,bytes.length)));
  return btoa(binary);
}

async function fetchTwoStageExtraMaterials_(){
  if(!fb||!selectedAssessmentId||!twoStageAttempt?.studentId)return [];
  const ref=fb.fsMod.doc(fb.db,"publicCourses",projectId,"assessments",selectedAssessmentId,"attempts",String(twoStageAttempt.studentId));
  const snap=await fb.fsMod.getDoc(ref);
  if(!snap.exists())return [];
  const data=snap.data()||{};
  const materials=Array.isArray(data.extraMaterials)?data.extraMaterials:[];
  twoStageAttempt={...twoStageAttempt,...data,extraMaterials:materials};
  return materials;
}
async function waitForExtraMaterialState_(materialId,shouldExist=true,timeoutMs=18000){
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    try{
      const materials=await fetchTwoStageExtraMaterials_();
      const exists=materials.some(x=>String(x?.id)===String(materialId));
      if(exists===shouldExist)return {ok:true,reconciled:true,extraMaterials:materials};
    }catch(err){console.warn("추가자료 서버 확인 재시도",err);}
    await new Promise(r=>setTimeout(r,1200));
  }
  return null;
}
async function openTwoStageDriveViewer(file){
  if(!file?.id)return;
  try{
    const base=await driveBridgeBaseFields_("student");closeTwoStageViewer();
    const overlay=document.createElement("div");overlay.id="twoStageViewerOverlay";overlay.className="two-stage-viewer-overlay";
    const frameName=`jcoupDriveView_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    overlay.innerHTML=`<div class="two-stage-viewer canvas-mode"><div class="two-stage-viewer-head"><div><b>${esc(file.name||"추가자료")}</b><small>선생님 Google Drive 원본 · 읽기 전용 · 외부 링크 비활성화</small></div><button type="button" id="closeTwoStageViewer">닫기</button></div><iframe id="twoStageDriveViewerFrame" name="${esc(frameName)}" title="추가자료 PDF" sandbox="allow-scripts allow-same-origin" style="width:100%;height:min(78vh,900px);border:0;background:#eef2f7"></iframe></div>`;
    document.body.appendChild(overlay);$("closeTwoStageViewer").onclick=closeTwoStageViewer;overlay.onclick=e=>{if(e.target===overlay)closeTwoStageViewer();};
    const iframe=$("twoStageDriveViewerFrame");iframe.srcdoc='<div style="font-family:sans-serif;padding:30px">PDF를 불러오는 중입니다…</div>';
    submitBridgeForm_(iframe,{action:"view",requestId:`view-${Date.now()}`,...base,materialId:file.id});
  }catch(err){alert(`자료를 열 수 없습니다. ${err.message||err}`);}
}
function phase2RequiredKeys(){return ["topicId","propositionId","selectionReason","passageConnection","conflictAnalysis","propositionChoiceReason","proGround","conGround","stanceReason"];}
function twoStageIdentity(){return `<div class="assessment-identity"><b>${esc(twoStageAttempt?.studentId||"")}</b> ${esc(twoStageAttempt?.studentName||"")} · ${esc(twoStageAttempt?.className||selectedClass)}반</div>`;}

const PHASE3_OUTLINE_FIELDS=[
  ["proClaim","찬성 측 주장"],
  ["proGround1","찬성 측 첫째 근거"],["proSource1","찬성 측 첫째 근거 자료·출처"],["proEvidence1","찬성 측 첫째 근거의 객관적 자료·사례 및 설명"],
  ["proGround2","찬성 측 둘째 근거"],["proSource2","찬성 측 둘째 근거 자료·출처"],["proEvidence2","찬성 측 둘째 근거의 객관적 자료·사례 및 설명"],
  ["proCounter","반대 측에서 제기할 예상 반론 또는 교차조사 질문"],["proRebuttal","예상 반론에 대한 찬성 측 반박"],["proSummary","찬성 측 내용 요약·정리"],
  ["conClaim","반대 측 주장"],
  ["conGround1","반대 측 첫째 근거"],["conSource1","반대 측 첫째 근거 자료·출처"],["conEvidence1","반대 측 첫째 근거의 객관적 자료·사례 및 설명"],
  ["conGround2","반대 측 둘째 근거"],["conSource2","반대 측 둘째 근거 자료·출처"],["conEvidence2","반대 측 둘째 근거의 객관적 자료·사례 및 설명"],
  ["conCounter","찬성 측에서 제기할 예상 반론 또는 교차조사 질문"],["conRebuttal","예상 반론에 대한 반대 측 반박"],["conSummary","반대 측 내용 요약·정리"]
];
function emptyPhase3Outline(){return Object.fromEntries(PHASE3_OUTLINE_FIELDS.map(([k])=>[k,""]));}
function normalizePhase3Outline(value){const out=emptyPhase3Outline(),src=value&&typeof value==="object"?value:{};PHASE3_OUTLINE_FIELDS.forEach(([k])=>out[k]=String(src[k]??""));return out;}
function phase3OutlineHasContent(outline=twoStagePhase3Outline){return PHASE3_OUTLINE_FIELDS.some(([k])=>String(outline?.[k]||"").trim());}
function phase3OutlineMissing(outline=twoStagePhase3Outline){return PHASE3_OUTLINE_FIELDS.filter(([k])=>!String(outline?.[k]||"").trim());}
function phase3OutlineCharCount(outline=twoStagePhase3Outline){return PHASE3_OUTLINE_FIELDS.reduce((n,[k])=>n+String(outline?.[k]||"").length,0);}
function phase3OutlineFilledCount(outline=twoStagePhase3Outline){return PHASE3_OUTLINE_FIELDS.filter(([k])=>String(outline?.[k]||"").trim()).length;}
function buildPhase3Essay(outline=twoStagePhase3Outline){
  const o=normalizePhase3Outline(outline);
  return [
    "[찬성 입론]",
    `1. 주장\n${o.proClaim}`,
    `2. 첫째 근거\n${o.proGround1}\n- 자료·출처: ${o.proSource1}\n- 객관적 자료·사례 및 설명: ${o.proEvidence1}`,
    `3. 둘째 근거\n${o.proGround2}\n- 자료·출처: ${o.proSource2}\n- 객관적 자료·사례 및 설명: ${o.proEvidence2}`,
    `4. 반대 측 예상 반론 또는 교차조사 질문\n${o.proCounter}`,
    `5. 예상 반론에 대한 찬성 측 반박\n${o.proRebuttal}`,
    `6. 찬성 측 내용 요약·정리\n${o.proSummary}`,
    "",
    "[반대 입론]",
    `1. 주장\n${o.conClaim}`,
    `2. 첫째 근거\n${o.conGround1}\n- 자료·출처: ${o.conSource1}\n- 객관적 자료·사례 및 설명: ${o.conEvidence1}`,
    `3. 둘째 근거\n${o.conGround2}\n- 자료·출처: ${o.conSource2}\n- 객관적 자료·사례 및 설명: ${o.conEvidence2}`,
    `4. 찬성 측 예상 반론 또는 교차조사 질문\n${o.conCounter}`,
    `5. 예상 반론에 대한 반대 측 반박\n${o.conRebuttal}`,
    `6. 반대 측 내용 요약·정리\n${o.conSummary}`
  ].join("\n\n");
}
function phase3SideHtml(side,submitted){
  const pro=side==="pro",prefix=pro?"pro":"con",sideLabel=pro?"찬성":"반대",oppLabel=pro?"반대":"찬성",sideClass=pro?"pro":"con",o=twoStagePhase3Outline,dis=submitted?"disabled":"";
  const txt=(key,placeholder,extra="")=>`<textarea data-phase3-key="${key}" data-two-stage-final="1" ${dis} placeholder="${esc(placeholder)}" ${extra}>${esc(o[key]||"")}</textarea>`;
  const inp=(key,placeholder)=>`<input type="text" data-phase3-key="${key}" data-two-stage-final="1" ${dis} placeholder="${esc(placeholder)}" value="${esc(o[key]||"")}">`;
  return `<section class="phase3-side ${sideClass}"><div class="phase3-side-head"><div class="phase3-side-title">${sideLabel} 입론</div><span>필수 6개 항목</span></div>
    <div class="phase3-form-section"><div class="phase3-section-title"><span>1</span>${sideLabel} 측 주장</div><p>논제에 ${sideLabel}하는 입장을 한 문장으로 명확하게 표현하세요.</p>${txt(prefix+"Claim",`${sideLabel} 측 주장을 작성하세요.`)}</div>
    <div class="phase3-reason-grid">
      <div class="phase3-form-section"><div class="phase3-section-title"><span>2</span>첫째 근거</div>${txt(prefix+"Ground1",`${sideLabel} 측 주장을 뒷받침하는 첫째 근거`)}<label class="phase3-source-label">근거 자료·출처${inp(prefix+"Source1","원지문 / 교사 보조자료 / 추가자료 등")}</label>${txt(prefix+"Evidence1","위 근거를 입증하는 객관적 자료·수치·사례와 그 의미를 설명하세요.")}</div>
      <div class="phase3-form-section"><div class="phase3-section-title"><span>3</span>둘째 근거</div>${txt(prefix+"Ground2",`${sideLabel} 측 주장을 뒷받침하는 둘째 근거`)}<label class="phase3-source-label">근거 자료·출처${inp(prefix+"Source2","원지문 / 교사 보조자료 / 추가자료 등")}</label>${txt(prefix+"Evidence2","위 근거를 입증하는 객관적 자료·수치·사례와 그 의미를 설명하세요.")}</div>
    </div>
    <div class="phase3-form-section"><div class="phase3-section-title"><span>4</span>${oppLabel} 측에서 제기할 예상 반론 또는 교차조사 질문</div>${txt(prefix+"Counter",`${oppLabel} 측은 ${sideLabel} 측 주장에 어떤 문제를 제기할 수 있는가?`)}</div>
    <div class="phase3-form-section"><div class="phase3-section-title"><span>5</span>예상 반론에 대한 ${sideLabel} 측 반박</div>${txt(prefix+"Rebuttal",`상대 주장의 한계를 짚고 ${sideLabel} 측 입장을 다시 방어하세요.`)}</div>
    <div class="phase3-form-section"><div class="phase3-section-title"><span>6</span>${sideLabel} 측 내용 요약·정리</div>${txt(prefix+"Summary",`${sideLabel} 측의 주장과 핵심 근거를 요약하여 전체 내용을 정리하세요.`)}</div>
  </section>`;
}
function updatePhase3ProgressUi(){
  const el=$("phase3Progress");if(el)el.textContent=`${phase3OutlineFilledCount()}/${PHASE3_OUTLINE_FIELDS.length}칸 작성 · ${phase3OutlineCharCount()}자`;
}

function pushTwoStageMonitorEvent(type,detail=""){if(activeTwoStagePhase!=="PHASE3"||twoStageAttempt?.phase3Status==="SUBMITTED")return;twoStageMonitorEvents.push({type,at:new Date().toISOString(),detail:String(detail||"").slice(0,120)});if(twoStageMonitorEvents.length>30)twoStageMonitorEvents=twoStageMonitorEvents.slice(-30);twoStageDirty=true;scheduleTwoStageSave();}
function scheduleTwoStageSave(){
  if(twoStageSaveHandle||!twoStageDirty||!twoStageAttempt||!activeTwoStagePhase||activeTwoStagePhase==="MATERIAL")return;
  const elapsed=Date.now()-(twoStageLastServerSaveMs||Date.now()),delay=Math.max(1000,TWO_STAGE_SERVER_BACKUP_MS-elapsed);
  twoStageSaveHandle=setTimeout(async()=>{
    twoStageSaveHandle=null;
    if(!twoStageDirty||!twoStageAttempt)return;
    if(activeTwoStagePhase==="PHASE2")await saveTwoStagePhase2(false);
    if(activeTwoStagePhase==="PHASE3")await saveTwoStagePhase3(false);
    if(twoStageDirty)scheduleTwoStageSave();
  },delay);
}
function markTwoStagePhase2Dirty(){twoStageDirty=true;writeTwoStageLocal(selectedAssessmentId,twoStageAttempt.studentId,"phase2",twoStagePhase2);const st=$("twoStageSaveState");if(st)st.textContent="이 기기에 저장됨 · 서버는 약 5분 간격 백업";scheduleTwoStageSave();}
function markTwoStagePhase3Dirty(){
  twoStageDirty=true;twoStagePhase3Essay=buildPhase3Essay(twoStagePhase3Outline);
  writeTwoStageLocal(selectedAssessmentId,twoStageAttempt.studentId,"phase3",{outline:twoStagePhase3Outline,essay:twoStagePhase3Essay,updatedAt:new Date().toISOString()});
  const st=$("twoStageSaveState");if(st)st.textContent="이 기기에 저장됨 · 서버는 약 5분 간격 백업";updatePhase3ProgressUi();scheduleTwoStageSave();
}
async function waitTwoStageSaveIdle(maxMs=8000){
  const started=Date.now();
  while(twoStageSaving&&Date.now()-started<maxMs)await new Promise(r=>setTimeout(r,120));
  return !twoStageSaving;
}
function twoStageMonitorPayload(){
  if(!twoStageMonitorEvents.length)return {};
  // 재시도 시 increment 중복 집계를 피하기 위해 이벤트 자체만 arrayUnion으로 저장합니다.
  // 관리자 화면의 이탈/붙여넣기 횟수는 eventLog에서 계산합니다.
  return {phase3EventLog:fb.fsMod.arrayUnion(...twoStageMonitorEvents)};
}
async function saveTwoStagePhase2(submit=false){
  if(submit&&twoStageSaving)await waitTwoStageSaveIdle();
  if(twoStageSaving||!fb||!twoStageAttempt||activeTwoStagePhase!=="PHASE2")return false;
  if(submit&&twoStageSaveHandle){clearTimeout(twoStageSaveHandle);twoStageSaveHandle=null;}
  twoStageSaving=true;
  const st=$("twoStageSaveState");if(st)st.textContent=submit?"2차시 제출 중…":"서버 백업 중…";
  try{
    const ref=fb.fsMod.doc(fb.db,"publicCourses",projectId,"assessments",selectedAssessmentId,"attempts",twoStageAttempt.studentId),topic=twoStageTopic(),prop=twoStageProposition();
    const phase2={...twoStagePhase2,topicTitle:topic?.title||twoStagePhase2.topicTitle||"",propositionText:prop?.text||twoStagePhase2.propositionText||""};
    const payload={phase2,phase2Status:submit?"SUBMITTED":"IN_PROGRESS",phase2LastSavedAt:fb.fsMod.serverTimestamp(),lastSeenAt:fb.fsMod.serverTimestamp(),updatedAt:fb.fsMod.serverTimestamp()};
    if(submit)payload.phase2SubmittedAt=fb.fsMod.serverTimestamp();
    await assessmentOpWithRetry(submit?"2차시 최종 제출":"2차시 서버 백업",()=>fb.fsMod.setDoc(ref,payload,{merge:true}),{tries:2,timeoutMs:8000});twoStagePhase2=phase2;twoStageAttempt={...twoStageAttempt,...payload,phase2Status:payload.phase2Status};twoStageLastServerSaveMs=Date.now();twoStageDirty=false;if(twoStageSaveHandle)clearTimeout(twoStageSaveHandle);twoStageSaveHandle=null;
    if(st)st.textContent=submit?"2차시 제출 완료":`서버 백업 완료 ${new Date().toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})}`;
    if(submit){clearTwoStageLocal(selectedAssessmentId,twoStageAttempt.studentId,"phase2");renderAssessmentPortal();}return true;
  }catch(err){console.error(err);if(st)st.textContent="서버 저장 지연 · 답안은 이 기기에 보관됨";return false;}finally{twoStageSaving=false;}
}
async async function saveTwoStagePhase3(submit=false){
  if(submit&&twoStageSaving)await waitTwoStageSaveIdle();
  if(twoStageSaving||!fb||!twoStageAttempt||activeTwoStagePhase!=="PHASE3")return false;
  if(submit&&twoStageSaveHandle){clearTimeout(twoStageSaveHandle);twoStageSaveHandle=null;}
  twoStageSaving=true;
  const st=$("twoStageSaveState");if(st)st.textContent=submit?"최종 제출 중…":"서버 백업 중…";const events=[...twoStageMonitorEvents];
  try{
    const ref=fb.fsMod.doc(fb.db,"publicCourses",projectId,"assessments",selectedAssessmentId,"attempts",twoStageAttempt.studentId);
    twoStagePhase3Essay=buildPhase3Essay(twoStagePhase3Outline);
    const payload={phase3Outline:normalizePhase3Outline(twoStagePhase3Outline),phase3Essay:twoStagePhase3Essay,phase3Status:submit?"SUBMITTED":"IN_PROGRESS",phase3LastSavedAt:fb.fsMod.serverTimestamp(),lastSeenAt:fb.fsMod.serverTimestamp(),updatedAt:fb.fsMod.serverTimestamp(),...twoStageMonitorPayload()};
    if(submit)payload.phase3SubmittedAt=fb.fsMod.serverTimestamp();
    await assessmentOpWithRetry(submit?"3차시 최종 제출":"3차시 서버 백업",()=>fb.fsMod.setDoc(ref,payload,{merge:true}),{tries:2,timeoutMs:8000});twoStageMonitorEvents.splice(0,events.length);twoStageAttempt={...twoStageAttempt,phase3Status:payload.phase3Status,phase3Outline:payload.phase3Outline,phase3Essay:twoStagePhase3Essay};twoStageLastServerSaveMs=Date.now();twoStageDirty=false;if(twoStageSaveHandle)clearTimeout(twoStageSaveHandle);twoStageSaveHandle=null;
    if(st)st.textContent=submit?"최종 제출 완료":`서버 백업 완료 ${new Date().toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})}`;
    if(submit){clearTwoStageLocal(selectedAssessmentId,twoStageAttempt.studentId,"phase3");renderAssessmentPortal();}return true;
  }catch(err){console.error(err);if(st)st.textContent="서버 저장 지연 · 글은 이 기기에 보관됨";return false;}finally{twoStageSaving=false;}
}
function leaveTwoStageAssessment(){
  if(twoStageSaveHandle)clearTimeout(twoStageSaveHandle);twoStageSaveHandle=null;if(twoStageHiddenTimer)clearTimeout(twoStageHiddenTimer);twoStageHiddenTimer=null;closeTwoStageViewer();
  activeTwoStagePhase=null;twoStageAttempt=null;twoStageContent=null;twoStagePhase2={};twoStagePhase3Outline=emptyPhase3Outline();twoStagePhase3Essay="";twoStagePhase3LegacyEssay="";twoStageDirty=false;twoStageLastServerSaveMs=0;twoStageSaving=false;twoStageMonitorEvents=[];twoStageReplaceMaterialId=null;setAssessmentFocusMode(false);selectedAssessmentId=null;renderAssessmentPortal();
}
function renderAssessmentPortal(){
  const root=$("assessmentPortalBody");if(!root)return;
  const opens=openAssessments();$("openAssessmentCount").textContent=`${opens.length}개`;
  setAssessmentFocusMode(!!activeAttempt || (activeTwoStagePhase&&activeTwoStagePhase!=="MATERIAL"));
  if(activeTwoStagePhase&&twoStageAttempt&&twoStageContent){renderTwoStageActive(root);return;}
  if(activeAttempt?.status==="WAITING"){renderAssessmentWaiting(root);return;}
  if(activeAttempt&&assessmentContent){renderAssessmentExam(root);return;}
  stopAssessmentTimer();
  if(selectedAssessmentId){
    const a=assessmentById(selectedAssessmentId);
    if(a&&assessmentTargetsSelectedClass(a)){
      if(isTwoStageAssessment(a)&&["PHASE2_OPEN","MATERIAL_WINDOW","PHASE3_OPEN"].includes(selectedClassStage(a))){renderTwoStageLogin(root,a);return;}
      if(!isTwoStageAssessment(a)&&["WAITING","OPEN"].includes(a.status)){renderAssessmentLogin(root,a);return;}
    }
    selectedAssessmentId=null;
  }
  root.innerHTML=opens.length?`<div class="assessment-open-list">${opens.map(a=>{
    if(isTwoStageAssessment(a)){
      const stage=selectedClassStage(a),label=TWO_STAGE_LABELS[stage]||"수행평가",action=stage==="PHASE2_OPEN"?"2차시 입장":stage==="MATERIAL_WINDOW"?"추가자료 등록":"3차시 입장";
      const sub=stage==="MATERIAL_WINDOW"?"2차시 제출 학생은 3차시 시작 전까지 추가자료 PDF를 등록·교체·삭제할 수 있습니다.":stage==="PHASE3_OPEN"?"추가자료는 잠겼습니다. 포털에 허용된 자료만 확인하며 최종 입론서를 작성합니다.":"지문과 논제를 선택하고 사고 과정을 기록합니다.";
      return `<article class="assessment-open-item two-stage-open"><div><span class="assessment-open-badge">${esc(label)}</span><h3>${esc(a.title||"수행평가2")}</h3><p>${esc(sub)}</p><small>${esc(selectedClass)}반 · 2단계 입론서형${stage==="MATERIAL_WINDOW"?" · 응시코드 불필요":" · 응시코드 필요"}</small></div><button class="action-btn primary" data-assessment-enter="${esc(a.id)}">${esc(action)}</button></article>`;
    }
    const deadline=a.status==="OPEN"?assessmentDeadlineMs(a,null):0,remaining=deadline?formatRemaining(deadline-correctedNow()):"",waiting=a.status==="WAITING";
    return `<article class="assessment-open-item"><div><span class="assessment-open-badge">${waiting?"입장 대기":"응시 가능"}</span><h3>${esc(a.title||"수행평가")}</h3><p>${esc(a.description||"수행평가 시간에 선생님의 안내에 따라 응시하세요.")}</p><small>${esc((a.targetClasses||[]).join(" · "))}반 · ${Number(a.questionCount||0)}문항${a.durationMinutes?` · 시험 ${Number(a.durationMinutes)+Number(a.timeExtensionMinutes||0)}분`:""}${waiting?" · 문항은 시험 시작 후 공개":remaining?` · 현재 남은 ${remaining}`:""}</small></div><button class="action-btn primary" data-assessment-enter="${esc(a.id)}">${waiting?"대기실 입장":"응시하기"}</button></article>`;
  }).join("")}</div>`:`<div class="materials-empty"><b>현재 이용 가능한 수행평가 단계가 없습니다.</b><span>선생님이 해당 반의 2차시·자료등록·3차시 단계를 열면 이곳에 표시됩니다.</span></div>`;
  root.querySelectorAll("[data-assessment-enter]").forEach(b=>b.onclick=()=>{selectedAssessmentId=b.dataset.assessmentEnter;renderAssessmentPortal();});
}
function preflightChecks(){
  let storageOk=true;
  try{const k="__jcoup_preflight__";localStorage.setItem(k,"1");localStorage.removeItem(k);}catch{storageOk=false;}
  return [
    {label:"인터넷 연결",ok:navigator.onLine},
    {label:"자동 저장",ok:storageOk},
    {label:"화면 이탈 감지",ok:"visibilityState" in document}
  ];
}
function renderAssessmentWaiting(root){
  const a=assessmentById(selectedAssessmentId)||{};
  stopAssessmentTimer();
  root.innerHTML=`<div class="assessment-login assessment-waiting-room"><div class="assessment-login-title"><span class="assessment-open-badge">대기실 입장 완료</span><h3>${esc(a.title||"수행평가")}</h3><p><b>${esc(activeAttempt?.studentId||"")}</b> ${esc(activeAttempt?.studentName||"")} 학생의 인증이 완료되었습니다.</p></div><div class="materials-empty"><b>선생님이 시험을 시작할 때까지 기다리세요.</b><span>아직 문항은 공개되지 않았으며 시험시간도 흐르지 않습니다.<br>창을 닫아도 대기 중에는 같은 학생 정보로 다른 기기에서 다시 입장할 수 있습니다.</span></div><div class="waiting-room-actions"><button class="action-btn secondary" id="leaveWaitingRoomBtn">대기실 나가기</button></div><div class="save-state">대기실 접속 유지 중</div></div>`;
  const leaveBtn=$("leaveWaitingRoomBtn");
  if(leaveBtn)leaveBtn.onclick=leaveWaitingRoom;
}

async function maybeStartWaitingAssessment(){
  if(!activeAttempt||activeAttempt.status!=="WAITING"||!selectedAssessmentId)return;
  const a=assessmentById(selectedAssessmentId);
  if(!a||a.status!=="OPEN")return;
  if(adminPreviewMode&&adminPreviewData){
    assessmentContent={assessmentId:a.id,title:a.title,instructions:a.instructions||"",questions:a.questions||[]};
    activeAttempt={...activeAttempt,status:"IN_PROGRESS",startedAtLocal:Date.now()};
    renderAssessmentPortal();
    return;
  }
  if(!fb||!fb.auth.currentUser)return;
  try{
    const contentRef=fb.fsMod.doc(fb.db,"publicCourses",projectId,"assessments",a.id,"content","main");
    const attemptRef=fb.fsMod.doc(fb.db,"publicCourses",projectId,"assessments",a.id,"attempts",activeAttempt.studentId);
    const contentSnap=await fb.fsMod.getDoc(contentRef);
    if(!contentSnap.exists())return;
    assessmentContent={id:contentSnap.id,...contentSnap.data()};
    await fb.fsMod.setDoc(attemptRef,{
      authUid:fb.auth.currentUser.uid,status:"IN_PROGRESS",waitingActive:true,
      startedAt:fb.fsMod.serverTimestamp(),lastSeenAt:fb.fsMod.serverTimestamp(),lastSavedAt:fb.fsMod.serverTimestamp()
    },{merge:true});
    activeAttempt={...activeAttempt,status:"IN_PROGRESS"};
    assessmentLastServerSaveMs=Date.now();assessmentLastPresenceWriteMs=Date.now();
    renderAssessmentPortal();
    sendAssessmentHeartbeat({force:true});
  }catch(err){console.warn("시험 시작 전환 대기",err);}
}


function renderTwoStageLogin(root,a){
  const stage=selectedClassStage(a),material=stage==="MATERIAL_WINDOW";
  const title=stage==="PHASE2_OPEN"?"2차시 평가 입장":material?"추가자료 사전등록":"3차시 평가 입장";
  const desc=material?"2차시 제출이 완료된 학생만 본인 확인 후 추가자료 PDF를 등록할 수 있습니다. 응시코드는 필요하지 않습니다.":"교실에서 선생님이 안내한 학번·이름·응시코드를 입력하세요.";
  root.innerHTML=`<div class="assessment-login two-stage-login"><button class="back-link" id="assessmentBackBtn">← 평가 목록</button><div class="assessment-login-title"><span class="assessment-open-badge">${esc(title)}</span><h3>${esc(a.title)}</h3><p>${esc(desc)}</p></div><form id="twoStageLoginForm"><label>학번<input id="assessmentStudentId" inputmode="numeric" autocomplete="off" required maxlength="5" placeholder="예: 20101 / 0101"></label><label>이름<input id="assessmentStudentName" autocomplete="off" required placeholder="본인 이름"></label>${material?"":`<label>응시코드<input id="assessmentCode" autocomplete="off" required placeholder="교실 공통 응시코드"></label>`}<button class="action-btn primary assessment-enter-btn" type="submit" ${navigator.onLine?"":"disabled"}>${material?"추가자료 등록 화면 열기":"입장"}</button><div class="assessment-message" id="assessmentLoginMessage">${navigator.onLine?"":"인터넷 연결을 확인한 뒤 다시 시도하세요."}</div></form></div>`;
  $("assessmentBackBtn").onclick=()=>{selectedAssessmentId=null;renderAssessmentPortal();};$("twoStageLoginForm").onsubmit=enterTwoStageAssessment;
}
async function createTwoStageSession(a,user,inputStudentId,studentName,code,stage){
  const sessionRef=fb.fsMod.doc(fb.db,"publicCourses",projectId,"assessments",a.id,"sessions",user.uid);let lastErr=null;
  for(const candidate of studentIdCandidates(inputStudentId)){
    try{
      // 보안 규칙이 학번·이름·학급·단계를 이미 검증하므로 성공 직후 session을 다시 읽지 않습니다.
      // 2단계형의 불필요한 Firestore read를 학생/단계당 1회 줄입니다.
      await assessmentOpWithRetry("본인 확인 저장",()=>fb.fsMod.setDoc(sessionRef,{authUid:user.uid,studentId:candidate,loginStudentId:inputStudentId,studentName,nameKey:normalizeNameKey(studentName),className:selectedClass,mode:TWO_STAGE_MODE,purpose:stage,phase2Submitted:stage==="MATERIAL_WINDOW",accessCodeProof:stage==="MATERIAL_WINDOW"?"":code,lastSeenAt:fb.fsMod.serverTimestamp(),createdAt:fb.fsMod.serverTimestamp()},{merge:true}));
      return {sessionRef,studentId:String(candidate)};
    }catch(err){lastErr=err;}
  }
  throw lastErr||new Error("학생 정보를 확인할 수 없습니다.");
}
async function enterTwoStageAssessment(e){
  e.preventDefault();const btn=e.submitter,msg=$("assessmentLoginMessage"),a=assessmentById(selectedAssessmentId),stage=selectedClassStage(a);if(!a||!isTwoStageAssessment(a))return;
  const inputStudentId=$("assessmentStudentId").value.trim(),studentName=$("assessmentStudentName").value.trim(),code=stage==="MATERIAL_WINDOW"?"":($("assessmentCode")?.value.trim()||"");
  if(!/^\d{4,5}$/.test(inputStudentId)){msg.textContent="학번은 4자리 또는 5자리 숫자로 입력하세요.";return;}
  btn.disabled=true;msg.textContent="본인 확인 중…";
  try{
    const user=await ensureAssessmentAuth(),{studentId}=await createTwoStageSession(a,user,inputStudentId,studentName,code,stage);
    const attemptRef=fb.fsMod.doc(fb.db,"publicCourses",projectId,"assessments",a.id,"attempts",studentId),contentRef=fb.fsMod.doc(fb.db,"publicCourses",projectId,"assessments",a.id,"content","main");
    const attemptSnap=await assessmentOpWithRetry("기존 기록 확인",()=>fb.fsMod.getDoc(attemptRef));
    let attemptData=attemptSnap.exists()?{id:attemptSnap.id,...attemptSnap.data(),studentId}:null;
    if(stage==="PHASE2_OPEN"&&!attemptData){
      const initialAttempt={studentId,studentName,className:selectedClass,authUid:user.uid,mode:TWO_STAGE_MODE,phase2Status:"IN_PROGRESS",phase2:{},extraMaterials:[],phase3Status:"NOT_STARTED"};
      await assessmentOpWithRetry("2차시 기록 생성",()=>fb.fsMod.setDoc(attemptRef,{...initialAttempt,createdAt:fb.fsMod.serverTimestamp(),updatedAt:fb.fsMod.serverTimestamp()}));
      // 생성 직후 같은 문서를 다시 읽지 않고 이미 알고 있는 초기값을 사용합니다.
      attemptData={id:studentId,...initialAttempt};
    }
    if(!attemptData)throw new Error("2차시 제출 기록이 없습니다. 선생님께 확인해 주세요.");
    twoStageAttempt=attemptData;
    if(stage==="MATERIAL_WINDOW"&&twoStageAttempt.phase2Status!=="SUBMITTED")throw new Error("2차시 제출이 완료되지 않아 추가자료를 등록할 수 없습니다.");
    if(stage==="PHASE3_OPEN"&&twoStageAttempt.phase2Status!=="SUBMITTED")throw new Error("2차시 제출 기록이 없어 3차시에 입장할 수 없습니다.");
    const contentSnap=await assessmentOpWithRetry("평가 자료 불러오기",()=>fb.fsMod.getDoc(contentRef));if(!contentSnap.exists())throw new Error("평가 자료를 불러올 수 없습니다.");twoStageContent={id:contentSnap.id,...contentSnap.data()};
    if(stage==="PHASE2_OPEN"){
      activeTwoStagePhase="PHASE2";twoStageLastServerSaveMs=timestampMs(twoStageAttempt.phase2LastSavedAt)||Date.now();const local=readTwoStageLocal(a.id,studentId,"phase2",{});twoStagePhase2=twoStageAttempt.phase2Status==="SUBMITTED"?{...(twoStageAttempt.phase2||{})}:{...(twoStageAttempt.phase2||{}),...local};twoStageDirty=Object.keys(local).length>0&&twoStageAttempt.phase2Status!=="SUBMITTED";
    }else if(stage==="MATERIAL_WINDOW"){
      activeTwoStagePhase="MATERIAL";twoStageLastServerSaveMs=0;twoStagePhase2={...(twoStageAttempt.phase2||{})};
    }else if(stage==="PHASE3_OPEN"){
      activeTwoStagePhase="PHASE3";twoStageLastServerSaveMs=timestampMs(twoStageAttempt.phase3LastSavedAt)||Date.now();twoStagePhase2={...(twoStageAttempt.phase2||{})};const local=readTwoStageLocal(a.id,studentId,"phase3",{});const serverOutline=normalizePhase3Outline(twoStageAttempt.phase3Outline||{});twoStagePhase3Outline=twoStageAttempt.phase3Status==="SUBMITTED"?serverOutline:normalizePhase3Outline(local.outline??serverOutline);twoStagePhase3LegacyEssay=String(twoStageAttempt.phase3Essay||local.essay||"");twoStagePhase3Essay=phase3OutlineHasContent(twoStagePhase3Outline)?buildPhase3Essay(twoStagePhase3Outline):twoStagePhase3LegacyEssay;twoStageDirty=Boolean(local.outline&&phase3OutlineHasContent(local.outline))&&twoStageAttempt.phase3Status!=="SUBMITTED";
      if(twoStageAttempt.phase3Status!=="SUBMITTED"&&twoStageAttempt.phase3Status!=="IN_PROGRESS"){
        await assessmentOpWithRetry("3차시 시작 기록",()=>fb.fsMod.setDoc(attemptRef,{phase3Status:"IN_PROGRESS",phase3StartedAt:fb.fsMod.serverTimestamp(),lastSeenAt:fb.fsMod.serverTimestamp(),updatedAt:fb.fsMod.serverTimestamp()},{merge:true}));twoStageAttempt.phase3Status="IN_PROGRESS";
      }
    }
    msg.textContent="";renderAssessmentPortal();if(twoStageDirty)scheduleTwoStageSave();
  }catch(err){console.error(err);const m=String(err?.message||err||"");msg.textContent=m.includes("2차시")||m.includes("3차시")?m:"입장할 수 없습니다. 학번·이름과 현재 단계의 응시코드를 확인하세요.";}finally{btn.disabled=false;}
}
function renderTeacherMaterialButtons(topic){
  const mats=topic?.teacherMaterials||[];return mats.length?`<div class="two-stage-material-buttons">${mats.map((m,i)=>`<button type="button" class="action-btn secondary" data-teacher-material="${i}">📄 ${esc(m.title||`교사 자료 ${i+1}`)}</button>`).join("")}</div>`:`<div class="materials-empty compact"><span>교사 제공 자료가 아직 연결되지 않았습니다.</span></div>`;
}
function bindTeacherMaterialButtons(root,topic){root.querySelectorAll("[data-teacher-material]").forEach(b=>{const m=topic?.teacherMaterials?.[Number(b.dataset.teacherMaterial)];b.onclick=()=>openTwoStageUrlViewer(m?.title,m?.url);});}
function phase2Field(label,key,placeholder){return `<label class="two-stage-answer-field"><b>${esc(label)}</b><textarea data-phase2-key="${esc(key)}" placeholder="${esc(placeholder)}">${esc(twoStagePhase2[key]||"")}</textarea></label>`;}
function renderTwoStagePhase2(root,a){
  const submitted=twoStageAttempt.phase2Status==="SUBMITTED",topics=twoStageContent?.topicSets||[],topic=twoStageTopic(),prop=twoStageProposition();
  root.innerHTML=`<div class="assessment-exam two-stage-phase"><div class="assessment-exam-head"><div><span class="assessment-open-badge">${submitted?"2차시 제출 완료":"2차시 · 사고과정 평가"}</span><h3>${esc(twoStageContent.title||a.title)}</h3><div class="assessment-instructions">많이 쓰는 평가가 아니라, 자료를 읽은 흔적과 생각이 연결되는지를 봅니다.</div></div><div class="save-state" id="twoStageSaveState">${submitted?"제출 완료":"이 기기에 즉시 저장"}</div></div>${twoStageIdentity()}<section class="two-stage-block"><h4>1. 지문 선택</h4><div class="two-stage-topic-select">${topics.map(t=>`<button type="button" class="topic-choice ${String(t.id)===String(twoStagePhase2.topicId)?"active":""}" data-topic-choice="${esc(t.id)}" ${submitted?"disabled":""}>${esc(t.title)}</button>`).join("")}</div></section>${topic?`<section class="two-stage-block"><h4>2. 교사 제공 자료 확인</h4>${renderTeacherMaterialButtons(topic)}</section><section class="two-stage-block"><h4>3. 논제 선택</h4><div class="proposition-list">${(topic.propositions||[]).map((p,i)=>`<label class="proposition-choice ${String(p.id)===String(twoStagePhase2.propositionId)?"active":""}"><input type="radio" name="twoStageProp" value="${esc(p.id)}" ${String(p.id)===String(twoStagePhase2.propositionId)?"checked":""} ${submitted?"disabled":""}><span><b>논제 ${i+1}</b>${esc(p.text)}</span></label>`).join("")}</div></section>`:""}<section class="two-stage-block"><h4>4. 사고 과정 기록</h4><div class="two-stage-answer-grid">${phase2Field("이 지문을 선택한 이유","selectionReason","관심을 가진 이유를 구체적으로 적으세요.")}${phase2Field("선택 논제와 원지문의 연결","passageConnection","원지문의 어떤 내용에서 이 논제가 나올 수 있는지 설명하세요.")}${phase2Field("핵심 쟁점·충돌 관점","conflictAnalysis","무엇과 무엇이 충돌하는 문제인지 자신의 말로 정리하세요.")}${phase2Field("다른 두 논제가 아니라 이 논제를 선택한 이유","propositionChoiceReason","세 논제를 비교해 선택 이유를 적으세요.")}${phase2Field("찬성 측 핵심 근거","proGround","찬성 측에서 가장 중요하다고 보는 근거를 적으세요.")}${phase2Field("반대 측 핵심 근거","conGround","반대 측에서 가장 중요하다고 보는 근거를 적으세요.")}${phase2Field("현재 자신의 입장과 이유","stanceReason","찬성/반대 입장과 그 이유를 적으세요.")}</div></section>${submitted?`<div class="submitted-box"><b>2차시 답안이 제출되었습니다.</b><span>이 답안은 수정할 수 없습니다. 선생님이 2차시를 종료하면 추가자료 사전등록 단계가 열립니다.</span><button class="action-btn secondary" id="leaveTwoStageBtn">포털로 돌아가기</button></div>`:`<div class="assessment-submit-bar"><span>입력 내용은 브라우저에 즉시 저장되고 서버에는 약 5분 간격으로 백업됩니다.</span><button class="action-btn primary" id="submitTwoStagePhase2Btn">2차시 최종 제출</button></div>`}</div>`;
  bindTeacherMaterialButtons(root,topic);
  root.querySelectorAll("[data-topic-choice]").forEach(b=>b.onclick=()=>{twoStagePhase2.topicId=b.dataset.topicChoice;twoStagePhase2.propositionId="";markTwoStagePhase2Dirty();renderTwoStagePhase2(root,a);});
  root.querySelectorAll('input[name="twoStageProp"]').forEach(r=>r.onchange=()=>{twoStagePhase2.propositionId=r.value;markTwoStagePhase2Dirty();renderTwoStagePhase2(root,a);});
  root.querySelectorAll("[data-phase2-key]").forEach(t=>{t.disabled=submitted;t.oninput=()=>{twoStagePhase2[t.dataset.phase2Key]=t.value;markTwoStagePhase2Dirty();};});
  if(submitted){$("leaveTwoStageBtn").onclick=leaveTwoStageAssessment;}else $("submitTwoStagePhase2Btn").onclick=async()=>{const missing=phase2RequiredKeys().filter(k=>!String(twoStagePhase2[k]||"").trim());if(missing.length){alert("지문·논제 선택과 모든 사고 과정 항목을 작성한 뒤 제출해 주세요.");return;}if(!confirm("2차시 답안을 최종 제출할까요? 제출 후에는 수정할 수 없습니다."))return;await saveTwoStagePhase2(true);};
}
function renderTwoStageMaterial(root,a){
  const topic=twoStageTopic(),files=Array.isArray(twoStageAttempt.extraMaterials)?twoStageAttempt.extraMaterials:[],max=Number(twoStageContent?.extraMaterialMaxFiles??a.extraMaterialMaxFiles??3),maxMb=Math.round(Number(twoStageContent?.extraMaterialMaxBytes||5*1024*1024)/1024/1024),atLimit=files.length>=max;
  root.innerHTML=`<div class="two-stage-material-page"><button class="back-link" id="leaveTwoStageBtn">← 포털로 돌아가기</button><div class="assessment-login-title"><span class="assessment-open-badge">추가자료 사전등록</span><h3>${esc(a.title)}</h3><p>2차시에서 선택한 논제에 사용할 추가자료가 있는 학생만 등록하세요. 교사 제공 자료만으로도 수행평가를 완료할 수 있습니다.</p></div>${twoStageIdentity()}<section class="two-stage-block selected-proposition"><h4>선택 논제</h4><p>${esc(twoStagePhase2.propositionText||twoStageProposition()?.text||"")}</p></section><section class="two-stage-block"><h4>추가자료 등록</h4><div class="template-download-box"><a class="action-btn secondary" href="./assets/material-registration-template.docx" download>추가자료 등록 서식(DOCX)</a><span>서식에 <b>제목 · 출처 · 본문</b>을 작성한 뒤 PDF로 저장하여 올리세요.</span></div><div class="pdf-help"><b>DOCX → PDF</b><span>Word: 파일 → 다른 이름으로 저장 → PDF</span><span>한글: 파일 → PDF로 저장하기</span><span>Google Docs: 파일 → 다운로드 → PDF 문서(.pdf)</span></div><input id="extraMaterialFileInput" class="sr-only-file" type="file" accept="application/pdf,.pdf"><button type="button" class="pdf-upload-box ${atLimit?"disabled":""}" id="extraMaterialAddBtn" ${atLimit?"disabled":""}><b>${atLimit?"등록 한도 도달":"PDF 선택"}</b><span>최대 ${max}개 · 파일당 ${maxMb}MB 이하${atLimit?" · 기존 파일은 교체 가능":""}</span></button><div id="extraUploadState" class="save-state"></div><div class="extra-material-list">${files.length?files.map((f,i)=>`<article><div><b>${esc(f.name||`추가자료 ${i+1}.pdf`)}</b><small>${Math.max(1,Math.round(Number(f.size||0)/1024))}KB</small></div><div><button type="button" class="action-btn secondary" data-extra-view="${esc(f.id)}">보기</button><button type="button" class="action-btn secondary" data-extra-replace="${esc(f.id)}">교체</button><button type="button" class="action-btn danger-lite" data-extra-delete="${esc(f.id)}">삭제</button></div></article>`).join(""):`<div class="materials-empty compact"><b>등록된 추가자료가 없습니다.</b><span>추가자료가 필요하지 않다면 아무것도 올리지 않아도 됩니다.</span></div>`}</div><p class="small muted">3차시 시작 버튼을 선생님이 누르는 순간 등록 자료가 잠기며 이후 추가·교체·삭제할 수 없습니다.</p></section></div>`;
  $("leaveTwoStageBtn").onclick=leaveTwoStageAssessment;const input=$("extraMaterialFileInput"),addBtn=$("extraMaterialAddBtn");
  if(addBtn)addBtn.onclick=()=>{if(atLimit)return;twoStageReplaceMaterialId=null;input?.click();};
  if(input)input.onchange=e=>{const f=e.target.files?.[0];e.target.value="";const replaceId=twoStageReplaceMaterialId;twoStageReplaceMaterialId=null;if(f)uploadExtraMaterialPdf(f,replaceId);};
  root.querySelectorAll("[data-extra-view]").forEach(b=>b.onclick=()=>openTwoStageDriveViewer(files.find(f=>String(f.id)===String(b.dataset.extraView))));
  root.querySelectorAll("[data-extra-replace]").forEach(b=>b.onclick=()=>{twoStageReplaceMaterialId=b.dataset.extraReplace;input?.click();});
  root.querySelectorAll("[data-extra-delete]").forEach(b=>b.onclick=()=>deleteExtraMaterialPdf(b.dataset.extraDelete));
}
async function uploadExtraMaterialPdf(file,replaceId=null){
  const a=assessmentById(selectedAssessmentId),stage=selectedClassStage(a),state=$("extraUploadState");if(stage!=="MATERIAL_WINDOW"){alert("추가자료 등록기간이 종료되었습니다.");renderAssessmentPortal();return;}
  if(file.type!=="application/pdf"&&!file.name.toLowerCase().endsWith(".pdf")){alert("PDF 파일만 등록할 수 있습니다.");return;}
  const maxBytes=Number(twoStageContent?.extraMaterialMaxBytes||5*1024*1024);if(file.size>maxBytes){alert(`파일은 ${Math.round(maxBytes/1024/1024)}MB 이하만 등록할 수 있습니다.`);return;}
  const files=Array.isArray(twoStageAttempt.extraMaterials)?[...twoStageAttempt.extraMaterials]:[],max=Number(twoStageContent?.extraMaterialMaxFiles??3);if(!replaceId&&files.length>=max){alert(`추가자료는 최대 ${max}개까지 등록할 수 있습니다.`);return;}
  const id=replaceId||crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try{
    if(state)state.textContent="PDF를 선생님 Drive에 업로드 중…";
    const fileBase64=arrayBufferToBase64_(await file.arrayBuffer());
    // 완료 메시지와 Firestore 실제 등록 확인을 동시에 기다립니다.
    // GAS 응답 메시지가 브라우저에서 유실되어도 서버 등록이 확인되면 성공 처리합니다.
    const bridgeWork=driveBridgeRequest_("upload",{materialId:id,fileName:file.name,fileSize:file.size,fileBase64},60000)
      .then(result=>({kind:"bridge",ok:true,result}))
      .catch(error=>({kind:"bridge",ok:false,error}));
    const verifyWork=waitForExtraMaterialState_(id,true,18000).then(result=>({kind:"verify",result}));
    let first=await Promise.race([bridgeWork,verifyWork]);
    let result=null;
    if(first?.kind==="verify"&&first.result){
      result=first.result;
    }else if(first?.kind==="bridge"&&first.ok){
      result=first.result;
    }else if(first?.kind==="bridge"&&!first.ok){
      const reconciled=await waitForExtraMaterialState_(id,true,4500);
      if(reconciled)result=reconciled;else throw first.error;
    }else{
      if(state)state.textContent="Drive 저장 결과 확인 중…";
      const later=await bridgeWork;
      if(later.ok)result=later.result;
      else{const reconciled=await waitForExtraMaterialState_(id,true,4500);if(reconciled)result=reconciled;else throw later.error;}
    }
    twoStageAttempt.extraMaterials=Array.isArray(result?.extraMaterials)?result.extraMaterials:await fetchTwoStageExtraMaterials_();
    if(state)state.textContent="Drive 등록 완료";renderTwoStageMaterial($("assessmentPortalBody"),a);
  }catch(err){
    console.error(err);
    // 마지막으로 실제 서버 상태를 한 번 더 확인해 성공했는데 실패로 표시되는 일을 막습니다.
    try{const reconciled=await waitForExtraMaterialState_(id,true,3000);if(reconciled){twoStageAttempt.extraMaterials=reconciled.extraMaterials;if(state)state.textContent="Drive 등록 완료";renderTwoStageMaterial($("assessmentPortalBody"),a);return;}}catch{}
    if(state)state.textContent="업로드 실패";alert(`PDF 업로드에 실패했습니다. ${err.message||err}`);
  }
}
async function deleteExtraMaterialPdf(id){
  const a=assessmentById(selectedAssessmentId);if(selectedClassStage(a)!=="MATERIAL_WINDOW"){alert("추가자료 등록기간이 종료되었습니다.");return;}const files=Array.isArray(twoStageAttempt.extraMaterials)?[...twoStageAttempt.extraMaterials]:[],target=files.find(f=>String(f.id)===String(id));if(!target||!confirm(`「${target.name}」을 삭제할까요?`))return;
  try{
    const bridgeWork=driveBridgeRequest_("delete",{materialId:id},45000).then(result=>({ok:true,result})).catch(error=>({ok:false,error}));
    const verifyWork=waitForExtraMaterialState_(id,false,15000);
    const first=await Promise.race([bridgeWork,verifyWork]);
    let result=null;
    if(first&&first.reconciled)result=first;
    else if(first&&first.ok)result=first.result;
    else if(first&&first.ok===false){const reconciled=await waitForExtraMaterialState_(id,false,3500);if(reconciled)result=reconciled;else throw first.error;}
    else{const later=await bridgeWork;if(later.ok)result=later.result;else{const reconciled=await waitForExtraMaterialState_(id,false,3500);if(reconciled)result=reconciled;else throw later.error;}}
    twoStageAttempt.extraMaterials=Array.isArray(result?.extraMaterials)?result.extraMaterials:files.filter(f=>String(f.id)!==String(id));
    renderTwoStageMaterial($("assessmentPortalBody"),a);
  }catch(err){alert(`삭제 실패: ${err.message||err}`);}
}
function renderPhase2Review(){
  const p=twoStagePhase2;return `<div class="phase2-review"><div><b>선택 지문</b><span>${esc(p.topicTitle||"")}</span></div><div><b>선택 논제</b><span>${esc(p.propositionText||"")}</span></div><div><b>지문 선택 이유</b><span>${esc(p.selectionReason||"")}</span></div><div><b>원지문 연결</b><span>${esc(p.passageConnection||"")}</span></div><div><b>핵심 쟁점</b><span>${esc(p.conflictAnalysis||"")}</span></div><div><b>논제 선택 이유</b><span>${esc(p.propositionChoiceReason||"")}</span></div><div><b>찬성 근거</b><span>${esc(p.proGround||"")}</span></div><div><b>반대 근거</b><span>${esc(p.conGround||"")}</span></div><div><b>나의 입장</b><span>${esc(p.stanceReason||"")}</span></div></div>`;
}
function renderTwoStagePhase3(root,a){
  const submitted=twoStageAttempt.phase3Status==="SUBMITTED",topic=twoStageTopic(),files=Array.isArray(twoStageAttempt.extraMaterials)?twoStageAttempt.extraMaterials:[];
  const legacyNotice=twoStagePhase3LegacyEssay&&!phase3OutlineHasContent(twoStagePhase3Outline)?`<div class="phase3-legacy-notice"><b>이전 버전의 단일 답안이 저장되어 있습니다.</b><span>${submitted?"기존 제출 답안을 아래에서 확인할 수 있습니다.":"기존 내용은 참고만 하고, 새 구조의 찬성·반대 항목을 모두 작성해 주세요."}</span><details><summary>이전 단일 답안 보기</summary><pre>${esc(twoStagePhase3LegacyEssay)}</pre></details></div>`:"";
  root.innerHTML=`<div class="assessment-exam two-stage-phase3"><div class="assessment-exam-head"><div><span class="assessment-open-badge">${submitted?"최종 제출 완료":"3차시 · 찬성·반대 토론 입론서 작성"}</span><h3>${esc(a.title)}</h3><div class="assessment-instructions">같은 논제에 대해 찬성과 반대 양쪽을 모두 작성합니다. 이 화면에 표시된 교사 제공 자료, 2차시 기록, 사전 등록 PDF만 활용하세요.</div></div><div><div class="save-state" id="twoStageSaveState">${submitted?"제출 완료":"이 기기에 즉시 저장"}</div><div class="phase3-progress" id="phase3Progress">${phase3OutlineFilledCount()}/${PHASE3_OUTLINE_FIELDS.length}칸 작성 · ${phase3OutlineCharCount()}자</div></div></div>${twoStageIdentity()}<div class="two-stage-phase3-layout"><aside class="two-stage-reference-panel"><section><h4>선택 논제</h4><p class="selected-proposition-text">${esc(twoStagePhase2.propositionText||"")}</p></section><section><h4>2차시 사고 기록</h4>${renderPhase2Review()}</section><section><h4>교사 제공 자료</h4>${renderTeacherMaterialButtons(topic)}</section><section><h4>사전 등록 추가자료</h4>${files.length?files.map((f,i)=>`<button type="button" class="action-btn secondary full-btn" data-extra-view="${esc(f.id)}">📄 ${esc(f.name||`추가자료 ${i+1}.pdf`)}</button>`).join(""):`<span class="small muted">등록한 추가자료 없음</span>`}</section></aside><main class="two-stage-writing-panel phase3-structured-panel"><div class="phase3-form-guide"><b>작성 방식</b><span>찬성·반대 각각 주장 → 근거 2개와 객관적 자료·사례 → 예상 반론/교차조사 → 반박 → 내용 요약·정리 순서로 작성합니다.</span></div>${legacyNotice}${phase3SideHtml("pro",submitted)}${phase3SideHtml("con",submitted)}${submitted?`<div class="submitted-box"><b>찬성·반대 입론서가 제출되었습니다.</b><span>제출 후에는 수정할 수 없습니다.</span><button class="action-btn secondary" id="leaveTwoStageBtn">포털로 돌아가기</button></div>`:`<div class="assessment-submit-bar"><span>찬성·반대의 모든 필수 입력칸을 작성해야 제출할 수 있습니다. 화면이 3초 이상 숨겨진 경우와 입력칸의 실제 붙여넣기는 감독 참고 기록으로 남습니다.</span><button class="action-btn primary" id="submitTwoStagePhase3Btn">최종 제출</button></div>`}</main></div></div>`;
  bindTeacherMaterialButtons(root,topic);root.querySelectorAll("[data-extra-view]").forEach(b=>b.onclick=()=>openTwoStageDriveViewer(files.find(f=>String(f.id)===String(b.dataset.extraView))));
  root.querySelectorAll("[data-phase3-key]").forEach(el=>{if(submitted)return;el.oninput=()=>{twoStagePhase3Outline[el.dataset.phase3Key]=el.value;markTwoStagePhase3Dirty();};});
  updatePhase3ProgressUi();
  if(submitted)$("leaveTwoStageBtn").onclick=leaveTwoStageAssessment;else $("submitTwoStagePhase3Btn").onclick=async()=>{const missing=phase3OutlineMissing();if(missing.length){const labels=missing.slice(0,6).map(([,label])=>`• ${label}`).join("\n");alert(`찬성·반대의 모든 필수 항목을 작성한 뒤 제출해 주세요.\n\n미작성 ${missing.length}칸${labels?`\n${labels}${missing.length>6?"\n…":""}`:""}`);return;}if(!confirm("찬성·반대 양쪽 입론서를 최종 제출할까요? 제출 후에는 수정할 수 없습니다."))return;await saveTwoStagePhase3(true);};
}
function renderTwoStageActive(root){
  const a=assessmentById(selectedAssessmentId);if(!a){leaveTwoStageAssessment();return;}const stage=selectedClassStage(a),expected=twoStagePhaseForStage(stage);
  if(activeTwoStagePhase!==expected){root.innerHTML=`<div class="submitted-box"><b>현재 단계가 변경되었습니다.</b><span>선생님이 ${esc(TWO_STAGE_LABELS[stage]||stage)} 단계로 전환했습니다. 포털로 돌아가 다시 입장하세요.</span><button class="action-btn secondary" id="leaveTwoStageBtn">포털로 돌아가기</button></div>`;$("leaveTwoStageBtn").onclick=leaveTwoStageAssessment;return;}
  if(activeTwoStagePhase==="PHASE2")renderTwoStagePhase2(root,a);else if(activeTwoStagePhase==="MATERIAL")renderTwoStageMaterial(root,a);else renderTwoStagePhase3(root,a);
}

function renderAssessmentLogin(root,a){
  const ps=adminPreviewData?.student||{},prefill=adminPreviewMode&&adminPreviewData;
  const checks=preflightChecks();
  root.innerHTML=`<div class="assessment-login"><button class="back-link" id="assessmentBackBtn">← 평가 목록</button><div class="assessment-login-title"><span class="assessment-open-badge">${prefill?"관리자 테스트 · 응시 인증":"응시 인증"}</span><h3>${esc(a.title)}</h3><p>교실에서 안내받은 정보를 입력하세요. 4자리·5자리 학번을 모두 사용할 수 있습니다.</p></div><div class="assessment-preflight"><b>응시 전 기기 점검</b><div>${checks.map(c=>`<span class="${c.ok?"ok":"bad"}">${c.ok?"✓":"!"} ${esc(c.label)}</span>`).join("")}</div></div><form id="assessmentLoginForm"><label>학번<input id="assessmentStudentId" inputmode="numeric" autocomplete="off" required placeholder="예: 20101 / 0101 / 2101" maxlength="5" value="${esc(prefill?ps.studentId:"")}"></label><label>이름<input id="assessmentStudentName" autocomplete="off" required placeholder="본인 이름" value="${esc(prefill?ps.name:"")}"></label><label>응시코드<input id="assessmentCode" autocomplete="off" required placeholder="교실 공통 응시코드" value="${esc(prefill?(adminPreviewData.assessment.accessCode||""):"")}"></label><button class="action-btn primary assessment-enter-btn" type="submit" ${navigator.onLine?"":"disabled"}>수행평가 입장</button><div class="assessment-message" id="assessmentLoginMessage">${navigator.onLine?"":"인터넷 연결을 확인한 뒤 다시 시도하세요."}</div></form></div>`;
  $("assessmentBackBtn").onclick=()=>{selectedAssessmentId=null;activeAttempt=null;assessmentContent=null;stopAttemptWatch();renderAssessmentPortal();};$("assessmentLoginForm").onsubmit=enterAssessment;
}
async function ensureAssessmentAuth(){
  if(!fb)throw new Error("Firebase 연결이 아직 준비되지 않았습니다.");
  if(fb.auth.currentUser){authUser=fb.auth.currentUser;return authUser;}
  const cred=await fb.authMod.signInAnonymously(fb.auth);authUser=cred.user;return authUser;
}
function studentIdCandidates(input){
  const id=String(input||"").trim(),out=[id],grade=String(meta?.grade||"").replace(/\D/g,"");
  if(id.length===4&&grade){
    if(id[0]===grade){
      const cls=id.slice(1,2),num=id.slice(2);
      out.push(`${grade}${cls.padStart(2,"0")}${num}`);
    }
    out.push(`${grade}${id}`);
  }
  return [...new Set(out.filter(x=>/^\d{4,5}$/.test(x)))];
}
const sleepAssessmentNetwork=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function assessmentOpWithRetry(label,task,{tries=3,timeoutMs=7000}={}){
  let lastErr=null;
  for(let attempt=1;attempt<=tries;attempt++){
    try{
      return await Promise.race([
        Promise.resolve().then(task),
        new Promise((_,reject)=>setTimeout(()=>reject(new Error(`${label} 시간 초과`)),timeoutMs))
      ]);
    }catch(err){
      lastErr=err;
      if(attempt<tries)await sleepAssessmentNetwork(700*attempt);
    }
  }
  throw lastErr||new Error(`${label} 실패`);
}

async function createValidatedSession(a,user,inputStudentId,studentName,code){
  const sessionRef=fb.fsMod.doc(fb.db,"publicCourses",projectId,"assessments",a.id,"sessions",user.uid);
  let lastErr=null;
  for(const candidate of studentIdCandidates(inputStudentId)){
    try{
      await assessmentOpWithRetry("응시 인증 저장",()=>fb.fsMod.setDoc(sessionRef,{
        authUid:user.uid,studentId:candidate,loginStudentId:inputStudentId,studentName,nameKey:normalizeNameKey(studentName),
        accessCodeProof:code,lastSeenAt:fb.fsMod.serverTimestamp(),createdAt:fb.fsMod.serverTimestamp()
      },{merge:true}));
      const snap=await assessmentOpWithRetry("응시 인증 확인",()=>fb.fsMod.getDoc(sessionRef));
      const server=timestampMs(snap.data()?.lastSeenAt||snap.data()?.createdAt);
      if(server)assessmentServerOffsetMs=server-Date.now();
      return {sessionRef,studentId:String(snap.data()?.studentId||candidate)};
    }catch(err){lastErr=err;}
  }
  throw lastErr||new Error("학생 정보를 확인할 수 없습니다.");
}
function watchActiveAttempt(ref,studentId){
  stopAttemptWatch();
  activeAttemptUnsubscribe=fb.fsMod.onSnapshot(ref,async snap=>{
    if(!snap.exists())return;
    const next={id:snap.id,...snap.data(),studentId:String(studentId)};
    const prevStatus=activeAttempt?.status,prevExtra=Number(activeAttempt?.extraMinutes||0),prevReopen=Number(activeAttempt?.reopenCount||0);
    activeAttempt={...activeAttempt,...next};
    const seenMs=timestampMs(next.lastSeenAt),savedMs=timestampMs(next.lastSavedAt);
    if(seenMs)assessmentLastPresenceWriteMs=Math.max(assessmentLastPresenceWriteMs,seenMs);
    if(savedMs)assessmentLastServerSaveMs=Math.max(assessmentLastServerSaveMs,savedMs);
    if(next.status==="SUBMITTED"){
      const forced=next.forcedFinalized===true;
      if(forced)await preserveForcedFinalizationRecovery(next,studentId);
      else{
        const localAnswers=readLocalAssessmentBackup(selectedAssessmentId,studentId);
        if(Object.keys(localAnswers).length)archiveAssessmentBackup(selectedAssessmentId,studentId,localAnswers,next.autoSubmitted?"SELF_AUTO_SUBMIT":"MANUAL_SUBMIT");
        assessmentRecoveryAvailable=false;
        try{
          localStorage.removeItem(assessmentBackupKey(selectedAssessmentId,studentId));
          localStorage.removeItem(assessmentBackupMetaKey(selectedAssessmentId,studentId));
          localStorage.removeItem(`${assessmentBackupKey(selectedAssessmentId,studentId)}_pendingSubmit`);
          localStorage.removeItem(`${assessmentBackupKey(selectedAssessmentId,studentId)}_recoveryUploadPending`);
        }catch{}
      }
      assessmentAnswers={...(next.answers||{})};assessmentDirty=false;assessmentSubmitRequested=false;
      if(assessmentAutosaveHandle)clearTimeout(assessmentAutosaveHandle);assessmentAutosaveHandle=null;
      if(assessmentHiddenTimer)clearTimeout(assessmentHiddenTimer);assessmentHiddenTimer=null;
    }else if(!assessmentDirty&&next.answers){assessmentAnswers={...next.answers};assessmentRecoveryAvailable=false;}
    if(prevStatus!==next.status||prevExtra!==Number(next.extraMinutes||0)||prevReopen!==Number(next.reopenCount||0))renderAssessmentPortal();
  },err=>console.warn("응시 상태 동기화 실패",err));
}
async function enterAssessment(e){
  e.preventDefault();assessmentSubmitRequested=false;assessmentAutoSubmitBusy=false;assessmentLastUrgentSaveMs=0;assessmentEditRevision=0;assessmentLastClientEditAtMs=0;assessmentRecoveryAvailable=false;assessmentLastServerSaveMs=0;assessmentLastPresenceWriteMs=0;assessmentAutosaveIntervalCurrent=0;pendingMonitorEvents=[];wasOfflineDuringAttempt=false;lastFocusEventMs=0;assessmentHiddenSinceMs=0;assessmentHiddenEventRecorded=false;if(assessmentHiddenTimer)clearTimeout(assessmentHiddenTimer);assessmentHiddenTimer=null;
  const msg=$("assessmentLoginMessage"),btn=e.submitter;msg.textContent="인증 중...";btn.disabled=true;
  const inputStudentId=$("assessmentStudentId").value.trim(),studentName=$("assessmentStudentName").value.trim(),code=$("assessmentCode").value.trim();
  if(!/^\d{4,5}$/.test(inputStudentId)){msg.textContent="학번은 4자리 또는 5자리 숫자로 입력하세요.";btn.disabled=false;return;}
  try{
    const a=assessmentById(selectedAssessmentId);if(!a||!["WAITING","OPEN"].includes(a.status))throw new Error("현재 입장 가능한 평가가 아닙니다.");
    if(adminPreviewMode&&adminPreviewData){
      const ps=adminPreviewData.student||{};
      const accepted=studentIdCandidates(inputStudentId).includes(String(ps.studentId));
      if(!accepted||normalizeNameKey(studentName)!==normalizeNameKey(ps.name)||String(code)!==String(a.accessCode||""))throw new Error("테스트 정보가 일치하지 않습니다.");
      assessmentAnswers={};assessmentDirty=false;msg.textContent="";
      if(a.status==="WAITING"){
        assessmentContent=null;
        activeAttempt={studentId:String(ps.studentId),studentName,status:"WAITING",preview:true};
      }else{
        assessmentContent={assessmentId:a.id,title:a.title,instructions:a.instructions||"",questions:a.questions||[]};
        activeAttempt={studentId:String(ps.studentId),studentName,status:"IN_PROGRESS",preview:true,startedAtLocal:Date.now()};
      }
      renderAssessmentPortal();return;
    }
    const user=await ensureAssessmentAuth();
    const {studentId}=await createValidatedSession(a,user,inputStudentId,studentName,code);
    const contentRef=fb.fsMod.doc(fb.db,"publicCourses",projectId,"assessments",a.id,"content","main"),attemptRef=fb.fsMod.doc(fb.db,"publicCourses",projectId,"assessments",a.id,"attempts",studentId);
    const attemptSnap=await assessmentOpWithRetry("기존 응시 기록 확인",()=>fb.fsMod.getDoc(attemptRef));
    if(attemptSnap.exists()){
      activeAttempt={id:attemptSnap.id,...attemptSnap.data(),studentId};
      let backup={};try{backup=JSON.parse(localStorage.getItem(assessmentBackupKey(a.id,studentId))||"{}")||{};}catch{}
      assessmentAnswers={...(activeAttempt.answers||{}),...backup};
      assessmentDirty=Object.keys(backup).length>0&&activeAttempt.status!=="SUBMITTED";
      if(a.status==="WAITING"&&activeAttempt.status!=="SUBMITTED"){
        activeAttempt={...activeAttempt,status:"WAITING",authUid:user.uid,waitingActive:true};
        assessmentContent=null;
        await assessmentOpWithRetry("대기실 재입장 저장",()=>fb.fsMod.setDoc(attemptRef,{
          authUid:user.uid,studentName,status:"WAITING",waitingActive:true,
          lastSeenAt:fb.fsMod.serverTimestamp(),lastSavedAt:fb.fsMod.serverTimestamp()
        },{merge:true}));
      }
    }
    else{
      let backup={};try{backup=JSON.parse(localStorage.getItem(assessmentBackupKey(a.id,studentId))||"{}")||{};}catch{}
      assessmentAnswers=backup;
      const initialStatus=a.status==="WAITING"?"WAITING":"IN_PROGRESS";
      await assessmentOpWithRetry("응시 기록 생성",()=>fb.fsMod.setDoc(attemptRef,{
        studentId,studentName,authUid:user.uid,status:initialStatus,waitingActive:a.status==="WAITING",answers:assessmentAnswers,currentQuestion:1,
        startedAt:a.status==="OPEN"?fb.fsMod.serverTimestamp():null,lastSeenAt:fb.fsMod.serverTimestamp(),lastSavedAt:fb.fsMod.serverTimestamp(),
        extraMinutes:0,focusLossCount:0,copyCount:0,pasteCount:0,contextMenuCount:0,eventLog:[]
      }));
      const fresh=await assessmentOpWithRetry("응시 기록 확인",()=>fb.fsMod.getDoc(attemptRef));activeAttempt={id:fresh.id,...fresh.data(),studentId};
    }
    if(a.status==="OPEN"&&activeAttempt.status!=="SUBMITTED"){
      const contentSnap=await assessmentOpWithRetry("평가 문항 불러오기",()=>fb.fsMod.getDoc(contentRef));if(!contentSnap.exists())throw new Error("평가 문항을 불러올 수 없습니다.");
      assessmentContent={id:contentSnap.id,...contentSnap.data()};
      if(activeAttempt.status==="WAITING"){
        await assessmentOpWithRetry("시험 시작 상태 전환",()=>fb.fsMod.setDoc(attemptRef,{authUid:user.uid,status:"IN_PROGRESS",waitingActive:true,startedAt:fb.fsMod.serverTimestamp(),lastSeenAt:fb.fsMod.serverTimestamp()},{merge:true}));
        activeAttempt={...activeAttempt,authUid:user.uid,status:"IN_PROGRESS",waitingActive:true};
      }
    }else if(a.status==="WAITING"){
      assessmentContent=null;
    }
    assessmentLastServerSaveMs=timestampMs(activeAttempt?.lastSavedAt)||Date.now();
    assessmentLastPresenceWriteMs=timestampMs(activeAttempt?.lastSeenAt)||Date.now();
    watchActiveAttempt(attemptRef,studentId);
    renderAssessmentPortal();sendAssessmentHeartbeat({force:true});if(assessmentDirty&&activeAttempt.status==="IN_PROGRESS")scheduleAssessmentAutosave();
  }catch(err){console.error(err);const em=String(err?.message||err||"");msg.textContent=/시간 초과|network|offline|unavailable/i.test(em)?"연결이 지연되고 있습니다. 네트워크를 확인한 뒤 다시 입장해 주세요.":"입장할 수 없습니다. 학번·이름·응시코드를 다시 확인하세요.";}finally{btn.disabled=false;}
}
function assessmentAutosaveIntervalMs(remainingMs){
  if(!Number.isFinite(remainingMs)||remainingMs<=0)return 0;
  if(remainingMs<=60*1000)return 10*1000;      // 마지막 1분: 10초
  if(remainingMs<=2*60*1000)return 15*1000;    // 마지막 2~1분: 15초
  if(remainingMs<=5*60*1000)return 30*1000;    // 마지막 5~2분: 30초
  if(remainingMs<=10*60*1000)return 60*1000;   // 마지막 10~5분: 1분
  if(remainingMs<=20*60*1000)return 2*60*1000; // 마지막 20~10분: 2분
  return 10*60*1000;                           // 그 이전: 10분
}
function currentAssessmentRemainingMs(){
  const a=assessmentById(selectedAssessmentId)||{},deadline=assessmentDeadlineMs(a,activeAttempt);
  return deadline?deadline-correctedNow():Infinity;
}
function scheduleAssessmentAutosave(){
  if(assessmentAutosaveHandle)clearTimeout(assessmentAutosaveHandle);
  assessmentAutosaveHandle=null;
  if(!assessmentDirty||!activeAttempt||activeAttempt.status!=="IN_PROGRESS")return;
  if(adminPreviewMode){assessmentAutosaveHandle=setTimeout(()=>{assessmentAutosaveHandle=null;if(assessmentDirty)saveAssessmentAttempt();},1200);return;}
  const remaining=currentAssessmentRemainingMs(),interval=assessmentAutosaveIntervalMs(remaining);
  if(interval<=0)return;
  assessmentAutosaveIntervalCurrent=interval;
  const baseline=assessmentLastServerSaveMs||Date.now();
  const delay=Math.max(250,interval-(Date.now()-baseline));
  assessmentAutosaveHandle=setTimeout(async()=>{
    assessmentAutosaveHandle=null;
    if(!assessmentDirty||!activeAttempt||activeAttempt.status!=="IN_PROGRESS")return;
    if(assessmentSaving){scheduleAssessmentAutosave();return;}
    await saveAssessmentAttempt().catch(()=>false);
  },delay);
}
function renderAssessmentExam(root){
  const a=assessmentById(selectedAssessmentId)||{},submitted=activeAttempt?.status==="SUBMITTED",qs=assessmentContent?.questions||[];
  const submitReason=String(activeAttempt?.submissionReason||"");
  const submittedBadge=submitReason==="TEACHER_CLOSE"?"평가 종료 · 자동 제출":activeAttempt?.autoSubmitted?"시간 종료 · 자동 제출":"제출 완료";
  const baseSubmittedMessage=submitReason==="TEACHER_CLOSE"?"선생님이 평가를 종료하여 서버에 마지막으로 저장된 답안이 자동 제출되었습니다.":activeAttempt?.autoSubmitted?"시험 시간이 종료되어 서버에 마지막으로 저장된 답안이 자동 제출되었습니다.":"제출 시각이 서버에 기록되었습니다.";
  const submittedMessage=assessmentRecoveryAvailable?`${baseSubmittedMessage} 이 기기에서 서버 제출본과 다른 최종 입력 백업이 감지되어 복구용 자료를 보존했습니다. 브라우저 데이터를 지우지 말고 선생님께 알려 주세요.`:baseSubmittedMessage;
  const deadline=assessmentDeadlineMs(a,activeAttempt),remain=deadline?formatRemaining(deadline-correctedNow()):"";
  root.innerHTML=`<div class="assessment-exam"><div class="assessment-exam-head"><div><span class="assessment-open-badge">${submitted?submittedBadge:"응시 중"}</span><h3>${esc(assessmentContent.title||a.title||"수행평가")}</h3><div class="assessment-instructions">${esc(assessmentContent.instructions||"문항을 읽고 답안을 작성하세요.")}</div></div><div class="assessment-head-tools">${!submitted&&remain?`<div class="assessment-timer" id="assessmentTimer"><span>남은 시간</span><strong id="assessmentTimerValue">${remain}</strong><small id="assessmentTimerNotice"></small></div>`:""}<div class="save-state" id="assessmentSaveState">${submitted?(adminPreviewMode?"테스트 제출 완료":"최종 제출됨"):(adminPreviewMode?"테스트 저장 준비":"저장 준비")}</div></div></div><div class="assessment-identity"><b>${esc(activeAttempt.studentId)}</b> ${esc(activeAttempt.studentName||"")}${Number(activeAttempt.extraMinutes||0)?`<span>개인 추가시간 +${Number(activeAttempt.extraMinutes)}분</span>`:""}</div><div class="assessment-questions">${qs.map((q,i)=>`<label class="assessment-question"><strong>${i+1}. ${esc(q.prompt)}</strong><textarea data-answer-id="${esc(q.id)}" ${submitted?"disabled":""} placeholder="${esc(q.placeholder||"답안을 입력하세요.")}">${esc(assessmentAnswers[q.id]||"")}</textarea></label>`).join("")}</div>${submitted?`<div class="submitted-box"><b>최종 제출이 완료되었습니다.</b><span>${submittedMessage}</span><button class="action-btn secondary" id="leaveAssessmentBtn">포털로 돌아가기</button></div>`:`<div class="assessment-submit-bar"><span>${adminPreviewMode?"테스트 모드: 서버에는 저장되지 않습니다.":"답안은 이 기기에 즉시 보관되고, 시험 후반으로 갈수록 서버 저장 주기가 짧아집니다. 3초 이상 화면 숨김과 실제 복사·붙여넣기만 감독 참고 기록으로 남습니다."}</span><button class="action-btn primary" id="submitAssessmentBtn">최종 제출</button></div>`}</div>`;
  root.querySelectorAll("[data-answer-id]").forEach(t=>t.oninput=()=>{
    assessmentAnswers[t.dataset.answerId]=t.value;assessmentDirty=true;assessmentEditRevision++;assessmentLastClientEditAtMs=Date.now();
    if(!adminPreviewMode){localStorage.setItem(assessmentBackupKey(selectedAssessmentId,activeAttempt.studentId),JSON.stringify(assessmentAnswers));writeLocalAssessmentMeta(selectedAssessmentId,activeAttempt.studentId);}
    const state=$("assessmentSaveState");if(state)state.textContent=adminPreviewMode?"테스트 저장 대기":"기기에 저장됨 · 서버 자동 저장 대기";
    scheduleAssessmentAutosave();
  });
  if(submitted){stopAssessmentTimer();$("leaveAssessmentBtn").onclick=leaveAssessment;}else{
    $("submitAssessmentBtn").onclick=submitAssessment;startAssessmentTimer();
  }
}
function startAssessmentTimer(){
  stopAssessmentTimer();
  updateAssessmentTimer();
  assessmentTimerHandle=setInterval(updateAssessmentTimer,1000);
}
function updateAssessmentTimer(){
  if(!activeAttempt||activeAttempt.status==="SUBMITTED")return;
  const a=assessmentById(selectedAssessmentId)||{},deadline=assessmentDeadlineMs(a,activeAttempt);
  if(!deadline)return;
  const left=deadline-correctedNow(),value=$("assessmentTimerValue"),box=$("assessmentTimer"),notice=$("assessmentTimerNotice");
  if(value)value.textContent=formatRemaining(left);
  if(box){box.classList.toggle("warn",left>0&&left<=300000);box.classList.toggle("urgent",left>0&&left<=60000);box.classList.toggle("expired",left<=0);}
  if(notice){
    if(left<=0)notice.textContent="시험시간 종료 · 자동 제출 중";
    else if(left<=60000)notice.textContent="1분 이내";
    else if(left<=300000)notice.textContent="5분 이내";
    else if(left<=600000)notice.textContent="10분 이내";
    else notice.textContent="";
  }
  if(left>0&&assessmentDirty&&!adminPreviewMode){
    const nextInterval=assessmentAutosaveIntervalMs(left);
    if(nextInterval!==assessmentAutosaveIntervalCurrent){
      assessmentAutosaveIntervalCurrent=nextInterval;
      scheduleAssessmentAutosave();
    }
  }
  if(left<=0){
    freezeAssessmentEditing();
    autoSubmitAssessment();
  }
}
const sleepAssessment=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitForAssessmentSaveIdle(maxMs=12000){
  const started=Date.now();
  while(assessmentSaving&&Date.now()-started<maxMs)await sleepAssessment(80);
  return !assessmentSaving;
}
function freezeAssessmentEditing(message="시험시간 종료 · 답안 확정 중"){
  document.querySelectorAll("[data-answer-id]").forEach(t=>t.disabled=true);
  const btn=$("submitAssessmentBtn");if(btn){btn.disabled=true;btn.textContent="제출 처리 중";}
  const st=$("assessmentSaveState");if(st&&message)st.textContent=message;
}
async function submitAssessmentWithRetry(autoSubmit=false,maxAttempts=5){
  if(!activeAttempt||activeAttempt.status==="SUBMITTED")return true;
  if(assessmentAutosaveHandle){clearTimeout(assessmentAutosaveHandle);assessmentAutosaveHandle=null;}
  assessmentSubmitRequested=true;
  const delays=[0,400,900,1800,3200];
  for(let i=0;i<Math.max(1,maxAttempts);i++){
    if(delays[i])await sleepAssessment(delays[i]);
    if(activeAttempt?.status==="SUBMITTED")return true;
    const ok=await saveAssessmentAttempt({submit:true,autoSubmit,waitForBusy:true});
    if(ok)return true;
    const st=$("assessmentSaveState");if(st)st.textContent=`제출 재시도 중 · ${i+1}/${maxAttempts}`;
  }
  const st=$("assessmentSaveState");if(st)st.textContent="제출 지연 · 답안은 기기에 보관됨";
  return false;
}
async function autoSubmitAssessment(){
  if(assessmentAutoSubmitBusy||!activeAttempt||activeAttempt.status==="SUBMITTED")return;
  assessmentAutoSubmitBusy=true;
  freezeAssessmentEditing();
  try{
    const ok=await submitAssessmentWithRetry(true,5);
    if(!ok)setTimeout(()=>{assessmentAutoSubmitBusy=false;autoSubmitAssessment();},4000);
  }finally{
    if(activeAttempt?.status==="SUBMITTED")assessmentAutoSubmitBusy=false;
  }
}
function buildPendingMonitorPayload(events){
  if(!events?.length||!fb)return {};
  const counts={FOCUS_LOSS:0,COPY:0,PASTE:0};
  events.forEach(e=>{if(Object.prototype.hasOwnProperty.call(counts,e.type))counts[e.type]++;});
  const payload={eventLog:fb.fsMod.arrayUnion(...events),lastMonitorEventAt:fb.fsMod.serverTimestamp(),lastMonitorEventType:events[events.length-1]?.type||""};
  if(counts.FOCUS_LOSS)payload.focusLossCount=fb.fsMod.increment(counts.FOCUS_LOSS);
  if(counts.COPY)payload.copyCount=fb.fsMod.increment(counts.COPY);
  if(counts.PASTE)payload.pasteCount=fb.fsMod.increment(counts.PASTE);
  return payload;
}
function dropFlushedMonitorEvents(count){if(count>0)pendingMonitorEvents.splice(0,count);}

async function saveAssessmentAttempt({submit=false,autoSubmit=false,waitForBusy=false}={}){
  if(!activeAttempt||!selectedAssessmentId||activeAttempt.status==="SUBMITTED")return true;
  if(assessmentSaving){
    if(!submit&&!waitForBusy)return false;
    const idle=await waitForAssessmentSaveIdle();
    if(!idle)return false;
  }
  assessmentSaving=true;const saveRevision=assessmentEditRevision;const answersSnapshot={...assessmentAnswers};const clientEditIso=assessmentLastClientEditAtMs?new Date(assessmentLastClientEditAtMs).toISOString():null;const st=$("assessmentSaveState");if(st)st.textContent=adminPreviewMode?"테스트 저장 중...":submit?"제출 중...":"저장 중...";
  try{
    if(adminPreviewMode&&adminPreviewData){
      assessmentDirty=false;
      if(st)st.textContent=submit?"테스트 제출 완료 · 서버 저장 안 함":`테스트 저장 완료 ${new Date().toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}`;
      if(submit){activeAttempt={...activeAttempt,status:"SUBMITTED",submittedAt:new Date(),autoSubmitted:autoSubmit,submissionReason:autoSubmit?"TIME_EXPIRED":"MANUAL",answers:{...assessmentAnswers}};renderAssessmentPortal();}
      return true;
    }
    if(!fb)return false;
    const ref=fb.fsMod.doc(fb.db,"publicCourses",projectId,"assessments",selectedAssessmentId,"attempts",activeAttempt.studentId);
    const monitorBatch=[...pendingMonitorEvents];
    const payload={studentId:activeAttempt.studentId,studentName:activeAttempt.studentName||"",authUid:fb.auth.currentUser.uid,status:submit?"SUBMITTED":"IN_PROGRESS",answers:answersSnapshot,currentQuestion:1,lastSeenAt:fb.fsMod.serverTimestamp(),lastSavedAt:fb.fsMod.serverTimestamp(),lastClientEditAt:clientEditIso,clientEditRevision:saveRevision,...buildPendingMonitorPayload(monitorBatch)};
    if(submit){payload.submittedAt=fb.fsMod.serverTimestamp();payload.autoSubmitted=!!autoSubmit;payload.submissionReason=autoSubmit?"TIME_EXPIRED":"MANUAL";payload.forcedFinalized=false;}
    await fb.fsMod.setDoc(ref,payload,{merge:true});
    dropFlushedMonitorEvents(monitorBatch.length);
    assessmentLastServerSaveMs=Date.now();assessmentLastPresenceWriteMs=assessmentLastServerSaveMs;
    assessmentDirty=assessmentEditRevision!==saveRevision;if(st)st.textContent=submit?(autoSubmit?"시간 종료 · 자동 제출됨":"최종 제출됨"):`서버 저장 완료 ${new Date().toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}`;
    if(assessmentDirty&&!submit)scheduleAssessmentAutosave();
    if(submit){
      activeAttempt={...activeAttempt,status:"SUBMITTED",answers:answersSnapshot,autoSubmitted:!!autoSubmit,submissionReason:autoSubmit?"TIME_EXPIRED":"MANUAL",forcedFinalized:false};
      archiveAssessmentBackup(selectedAssessmentId,activeAttempt.studentId,answersSnapshot,autoSubmit?"SELF_AUTO_SUBMIT":"MANUAL_SUBMIT");
      try{localStorage.removeItem(assessmentBackupKey(selectedAssessmentId,activeAttempt.studentId));localStorage.removeItem(assessmentBackupMetaKey(selectedAssessmentId,activeAttempt.studentId));localStorage.removeItem(`${assessmentBackupKey(selectedAssessmentId,activeAttempt.studentId)}_recoveryUploadPending`);}catch{}
      assessmentRecoveryAvailable=false;renderAssessmentPortal();
    }
    return true;
  }catch(err){
    console.error(err);
    if(st)st.textContent=submit?"제출 대기 · 연결 복구 후 자동 재시도":"저장 실패 · 기기에 임시 보관";
    if(submit)localStorage.setItem(`${assessmentBackupKey(selectedAssessmentId,activeAttempt.studentId)}_pendingSubmit`,autoSubmit?"AUTO":"MANUAL");
    return false;
  }finally{assessmentSaving=false;}
}
async function sendAssessmentHeartbeat({force=false}={}){
  if(adminPreviewMode||!fb||!activeAttempt||activeAttempt.status==="SUBMITTED"||!selectedAssessmentId)return false;
  if(!force&&Date.now()-assessmentLastPresenceWriteMs<30000&&!pendingMonitorEvents.length)return true;
  const monitorBatch=[...pendingMonitorEvents];
  try{
    const ref=fb.fsMod.doc(fb.db,"publicCourses",projectId,"assessments",selectedAssessmentId,"attempts",activeAttempt.studentId);
    await fb.fsMod.updateDoc(ref,{lastSeenAt:fb.fsMod.serverTimestamp(),waitingActive:true,clientVisible:document.visibilityState==="visible",clientOnline:navigator.onLine,...buildPendingMonitorPayload(monitorBatch)});
    dropFlushedMonitorEvents(monitorBatch.length);assessmentLastPresenceWriteMs=Date.now();return true;
  }catch{return false;}
}
async function submitAssessment(){
  if(assessmentSubmitRequested)return;
  const required=(assessmentContent?.questions||[]).filter(q=>q.required!==false),missing=required.filter(q=>!String(assessmentAnswers[q.id]||"").trim());
  if(missing.length&&!confirm(`작성하지 않은 문항이 ${missing.length}개 있습니다. 그래도 최종 제출할까요?`))return;
  if(!missing.length&&!confirm("최종 제출하면 학생이 다시 수정할 수 없습니다. 제출할까요?"))return;
  assessmentSubmitRequested=true;
  freezeAssessmentEditing();
  const btn=$("submitAssessmentBtn");if(btn){btn.disabled=true;btn.textContent="제출 처리 중";}
  const ok=await submitAssessmentWithRetry(false,5);
  if(!ok){
    assessmentSubmitRequested=false;
    renderAssessmentPortal();
    alert("최종 제출이 지연되고 있습니다. 답안은 이 기기에 보관되어 있습니다. 네트워크 연결을 확인한 뒤 다시 눌러 주세요. 시험시간이 끝나면 마지막 서버 저장 답안이 자동 확정됩니다.");
  }
}
function pushMonitorEvent(type,detail=""){
  if(adminPreviewMode||!activeAttempt||activeAttempt.status==="SUBMITTED"||!selectedAssessmentId)return;
  const event={type,at:new Date().toISOString(),detail:String(detail||"").slice(0,120)};
  pendingMonitorEvents.push(event);
  if(pendingMonitorEvents.length>40)pendingMonitorEvents=pendingMonitorEvents.slice(-40);
}
async function flushPendingMonitorEvents(){
  if(!pendingMonitorEvents.length||!navigator.onLine)return false;
  return sendAssessmentHeartbeat({force:true});
}
function recordFocusLoss(detail){
  const now=Date.now();if(now-lastFocusEventMs<3000)return;lastFocusEventMs=now;pushMonitorEvent("FOCUS_LOSS",detail);
}
async function leaveWaitingRoom(){
  if(!activeAttempt||activeAttempt.status!=="WAITING"){leaveAssessment();return;}
  try{
    if(!adminPreviewMode&&fb&&selectedAssessmentId&&fb.auth?.currentUser){
      const attemptRef=fb.fsMod.doc(fb.db,"publicCourses",projectId,"assessments",selectedAssessmentId,"attempts",activeAttempt.studentId);
      const sessionRef=fb.fsMod.doc(fb.db,"publicCourses",projectId,"assessments",selectedAssessmentId,"sessions",fb.auth.currentUser.uid);
      await fb.fsMod.setDoc(attemptRef,{
        authUid:fb.auth.currentUser.uid,waitingActive:false,lastSeenAt:fb.fsMod.serverTimestamp()
      },{merge:true});
      try{await fb.fsMod.deleteDoc(sessionRef);}catch{}
    }
  }catch(err){console.warn("대기실 나가기 상태 기록 실패",err);}
  stopAttemptWatch();stopAssessmentTimer();
  activeAttempt=null;assessmentContent=null;assessmentAnswers={};assessmentDirty=false;selectedAssessmentId=null;assessmentLastServerSaveMs=0;assessmentLastPresenceWriteMs=0;assessmentAutosaveIntervalCurrent=0;pendingMonitorEvents=[];wasOfflineDuringAttempt=false;
  if(assessmentAutosaveHandle)clearTimeout(assessmentAutosaveHandle);assessmentAutosaveHandle=null;
  setAssessmentFocusMode(false);
  renderAssessmentPortal();
}
function leaveAssessment(){
  assessmentSubmitRequested=false;assessmentAutoSubmitBusy=false;assessmentLastUrgentSaveMs=0;assessmentLastServerSaveMs=0;assessmentLastPresenceWriteMs=0;assessmentAutosaveIntervalCurrent=0;
  if(assessmentAutosaveHandle)clearTimeout(assessmentAutosaveHandle);assessmentAutosaveHandle=null;
  if(assessmentHiddenTimer)clearTimeout(assessmentHiddenTimer);assessmentHiddenTimer=null;assessmentHiddenSinceMs=0;assessmentHiddenEventRecorded=false;
  stopAttemptWatch();stopAssessmentTimer();
  activeAttempt=null;assessmentContent=null;assessmentAnswers={};assessmentDirty=false;selectedAssessmentId=null;pendingMonitorEvents=[];wasOfflineDuringAttempt=false;renderAssessmentPortal();
}

async function init(){
  cleanupOldAssessmentArchives();
  document.querySelectorAll(".portal-tab").forEach(b=>b.onclick=()=>setView(b.dataset.view));
  $("materialSearch").oninput=e=>{materialQuery=e.target.value;renderMaterials();};
  $("noticeSearch").oninput=e=>{noticeQuery=e.target.value;renderNotices();};
  $("studentCalendarPrev").onclick=()=>shiftStudentCalendarMonth(-1);
  $("studentCalendarNext").onclick=()=>shiftStudentCalendarMonth(1);
  $("studentCalendarToday").onclick=()=>{const d=new Date();studentCalendarMonth=new Date(d.getFullYear(),d.getMonth(),1);studentCalendarInitialized=true;renderStudentCalendar();};
  renderMeta(); renderSelected(); renderStudentCalendar(); renderMaterials(); renderNotices();
  try{
    setStatus("수업 정보 연결 중");
    const [appMod,authMod,fsMod]=await Promise.all([
      import("https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js")
    ]);
    const appName="jcoupeStudentPortal";
    const app=appMod.getApps().find(x=>x.name===appName)||appMod.initializeApp(firebaseConfig,appName);
    const db=fsMod.getFirestore(app);
    let auth=null;
    if(!adminPreviewMode){
      try{auth=authMod.initializeAuth(app,{persistence:authMod.browserLocalPersistence});}catch{auth=authMod.getAuth(app);}
      authMod.onAuthStateChanged(auth,user=>{authUser=user||null;if(user)setTimeout(()=>scanAndSyncRecoveryBackups(),700);});
    }
    fb={app,db,auth,authMod,fsMod};

    fsMod.onSnapshot(fsMod.doc(db,"publicCourses",projectId),snap=>{
      if(snap.exists()){ meta={id:snap.id,...snap.data()}; setStatus("최신 정보 연결","online"); }
      else { meta=null; setStatus("공개 정보 준비 중"); }
      renderMeta(); renderSelected(); renderStudentCalendar(); renderMaterials(); renderNotices();
    },err=>{ console.error(err); setStatus("공개 데이터 접근 대기","error"); $("emptyNotice").classList.add("show"); });

    fsMod.onSnapshot(fsMod.collection(db,"publicCourses",projectId,"classes"),snap=>{
      classDocs={}; snap.forEach(d=>classDocs[d.id]={id:d.id,...d.data()}); renderSelected();
    },err=>{ console.error(err); setStatus("공개 데이터 접근 대기","error"); });

    fsMod.onSnapshot(fsMod.collection(db,"publicCourses",projectId,"materials"),snap=>{
      materials=[]; snap.forEach(d=>materials.push({id:d.id,...d.data()})); renderMaterials();
    },err=>{ console.error(err); setStatus("자료실 접근 대기","error"); });

    fsMod.onSnapshot(fsMod.collection(db,"publicCourses",projectId,"notices"),snap=>{
      notices=[]; snap.forEach(d=>notices.push({id:d.id,...d.data()})); renderNotices();
    },err=>{ console.error(err); setStatus("공지 접근 대기","error"); });

    fsMod.onSnapshot(fsMod.collection(db,"publicCourses",projectId,"assessments"),snap=>{
      publicAssessments=[]; snap.forEach(d=>publicAssessments.push({id:d.id,...d.data()})); renderAssessmentPortal();maybeStartWaitingAssessment();
    },err=>{ console.error(err); });

    if(adminPreviewMode){
      $("adminPreviewBanner")?.classList.remove("hidden");
      const closeBtn=$("closeAdminPreviewWindowBtn");
      if(closeBtn)closeBtn.onclick=()=>window.close();
      setView("assessment");
      notifyAdminPreviewReady();
      setTimeout(notifyAdminPreviewReady,250);
      setTimeout(notifyAdminPreviewReady,800);
      setStatus("관리자 테스트 모드","online");
    }
  }catch(err){
    console.error(err); setStatus("연결 오류","error"); $("emptyNotice").classList.add("show");
  }
}
document.addEventListener("visibilitychange",()=>{
  if(activeTwoStagePhase==="PHASE3"&&twoStageAttempt?.phase3Status!=="SUBMITTED"){
    if(document.visibilityState==="hidden"){
      twoStageHiddenSince=Date.now();twoStageHiddenRecorded=false;if(twoStageHiddenTimer)clearTimeout(twoStageHiddenTimer);
      twoStageHiddenTimer=setTimeout(()=>{twoStageHiddenTimer=null;if(activeTwoStagePhase==="PHASE3"&&document.visibilityState==="hidden"&&!twoStageHiddenRecorded){twoStageHiddenRecorded=true;pushTwoStageMonitorEvent("FOCUS_LOSS","화면이 3초 이상 숨겨짐");}},3000);
    }else{
      if(twoStageHiddenTimer)clearTimeout(twoStageHiddenTimer);twoStageHiddenTimer=null;const hiddenFor=twoStageHiddenSince?Date.now()-twoStageHiddenSince:0;if(hiddenFor>=3000&&!twoStageHiddenRecorded){twoStageHiddenRecorded=true;pushTwoStageMonitorEvent("FOCUS_LOSS",`화면 숨김 약 ${Math.max(3,Math.round(hiddenFor/1000))}초`);}twoStageHiddenSince=0;
    }
    return;
  }
  if(!activeAttempt||activeAttempt.status!=="IN_PROGRESS")return;
  if(document.visibilityState==="hidden"){
    assessmentHiddenSinceMs=Date.now();assessmentHiddenEventRecorded=false;
    if(assessmentHiddenTimer)clearTimeout(assessmentHiddenTimer);
    assessmentHiddenTimer=setTimeout(()=>{assessmentHiddenTimer=null;if(activeAttempt&&activeAttempt.status==="IN_PROGRESS"&&document.visibilityState==="hidden"&&!assessmentHiddenEventRecorded){assessmentHiddenEventRecorded=true;recordFocusLoss("화면이 3초 이상 숨겨짐");}},3000);
  }else{
    if(assessmentHiddenTimer)clearTimeout(assessmentHiddenTimer);assessmentHiddenTimer=null;
    const hiddenFor=assessmentHiddenSinceMs?Date.now()-assessmentHiddenSinceMs:0;
    if(hiddenFor>=3000&&!assessmentHiddenEventRecorded){assessmentHiddenEventRecorded=true;recordFocusLoss(`화면 숨김 약 ${Math.max(3,Math.round(hiddenFor/1000))}초`);}assessmentHiddenSinceMs=0;
  }
});
document.addEventListener("copy",e=>{if(activeTwoStagePhase==="PHASE3"&&e.target?.closest?.("[data-two-stage-final]")){pushTwoStageMonitorEvent("COPY","최종 입론서 입력칸에서 실제 복사 실행");return;}if(activeAttempt&&activeAttempt.status==="IN_PROGRESS"&&e.target?.closest?.("[data-answer-id]"))pushMonitorEvent("COPY","답안 입력칸에서 실제 복사 실행");});
document.addEventListener("paste",e=>{if(activeTwoStagePhase==="PHASE3"&&e.target?.closest?.("[data-two-stage-final]")){pushTwoStageMonitorEvent("PASTE","최종 입론서 입력칸에 실제 붙여넣기 실행");return;}if(activeAttempt&&activeAttempt.status==="IN_PROGRESS"&&e.target?.closest?.("[data-answer-id]"))pushMonitorEvent("PASTE","답안 입력칸에 실제 붙여넣기 실행");});
window.addEventListener("offline",()=>{
  if(activeTwoStagePhase){const st=$("twoStageSaveState")||$("extraUploadState");if(st)st.textContent="오프라인 · 작성 내용은 이 기기에 보관됨";return;}
  if(!activeAttempt||activeAttempt.status==="SUBMITTED")return;
  wasOfflineDuringAttempt=true;pendingMonitorEvents.push({type:"OFFLINE",at:new Date().toISOString(),detail:"네트워크 연결 끊김"});
  const st=$("assessmentSaveState");if(st)st.textContent="오프라인 · 답안은 이 기기에 임시 보관";
});
window.addEventListener("online",async()=>{
  if(activeTwoStagePhase){if(twoStageDirty&&!twoStageSaving){if(activeTwoStagePhase==="PHASE2")await saveTwoStagePhase2(false);if(activeTwoStagePhase==="PHASE3")await saveTwoStagePhase3(false);}return;}
  if(activeAttempt&&activeAttempt.status==="SUBMITTED"){if(activeAttempt.forcedFinalized)await preserveForcedFinalizationRecovery(activeAttempt,activeAttempt.studentId);await scanAndSyncRecoveryBackups();return;}
  if(!activeAttempt)return;
  if(wasOfflineDuringAttempt){pendingMonitorEvents.push({type:"ONLINE",at:new Date().toISOString(),detail:"네트워크 재연결"});wasOfflineDuringAttempt=false;}
  if(assessmentDirty&&!assessmentSaving)await saveAssessmentAttempt().catch(()=>false);else await sendAssessmentHeartbeat({force:true});
  const key=`${assessmentBackupKey(selectedAssessmentId,activeAttempt.studentId)}_pendingSubmit`;
  if(localStorage.getItem(key)){const auto=localStorage.getItem(key)==="AUTO";const ok=await submitAssessmentWithRetry(auto,5);if(ok)localStorage.removeItem(key);}await scanAndSyncRecoveryBackups();
});
// v1.8.2: 기존 시험형만 60초 heartbeat를 사용합니다. 2단계형은 heartbeat 없이 저빈도 답안 백업만 사용합니다.
setInterval(()=>{if(activeAttempt&&activeAttempt.status!=="SUBMITTED")sendAssessmentHeartbeat();},60000);
init();
