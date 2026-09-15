import { firebaseConfig } from "./firebase-config.js";
import { PORTAL_CONFIG } from "./portal-config.js";

const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const projectId=new URLSearchParams(location.search).get("project")||PORTAL_CONFIG.defaultProjectId;
const classKey=`class_portal_selected_${projectId}`;

let meta=null;
let classDocs={};
let materials=[];
let selectedClass=localStorage.getItem(classKey)||"";
let currentView="progress";
let materialCategory="전체";
let materialQuery="";

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
  if(name==="progress") renderSelected();
  if(name==="materials") renderMaterials();
}
function renderMeta(){
  $("portalTitle").textContent=meta?.portalTitle||PORTAL_CONFIG.fallbackTitle;
  $("portalSubtitle").textContent=meta?.portalSubtitle||PORTAL_CONFIG.fallbackSubtitle;
  renderClassTabs();
}
function renderClassTabs(){
  const list=classes();
  if(!selectedClass||!list.includes(selectedClass)) selectedClass=list[0]||"";
  if(selectedClass) localStorage.setItem(classKey,selectedClass);
  $("classTabs").innerHTML=list.map(c=>`<button class="class-btn ${c===selectedClass?"active":""}" data-class="${esc(c)}">${esc(c)}반</button>`).join("");
  document.querySelectorAll(".class-btn").forEach(b=>b.onclick=()=>{
    selectedClass=b.dataset.class;
    localStorage.setItem(classKey,selectedClass);
    renderClassTabs();
    renderSelected();
    renderMaterials();
  });
}
function renderSelected(){
  if(!selectedClass){ $("emptyNotice").classList.add("show"); return; }
  const data=classDocs[selectedClass];
  $("currentClassLabel").textContent=`${selectedClass}반 현재 진도`;
  $("historySubtitle").textContent=`${selectedClass}반 최근 공개 수업 기록`;

  if(!data){
    $("currentTitle").textContent="아직 공개된 진도가 없습니다.";
    $("currentSession").textContent="";
    $("lastDate").textContent="-";
    $("lastType").textContent="-";
    $("detail").textContent="수업 진도가 공개되면 이곳에 표시됩니다.";
    $("nextStart").textContent="-";
    $("updatedAt").textContent="최종 업데이트: -";
    $("historyList").innerHTML=`<div class="empty">공개된 최근 수업 기록이 없습니다.</div>`;
    $("emptyNotice").classList.add("show");
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

async function init(){
  document.querySelectorAll(".portal-tab").forEach(b=>b.onclick=()=>setView(b.dataset.view));
  $("materialSearch").oninput=e=>{materialQuery=e.target.value;renderMaterials();};
  renderMeta(); renderSelected(); renderMaterials();
  try{
    setStatus("수업 정보 연결 중");
    const [appMod,fsMod]=await Promise.all([
      import("https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js")
    ]);
    const app=appMod.initializeApp(firebaseConfig);
    const db=fsMod.getFirestore(app);

    fsMod.onSnapshot(fsMod.doc(db,"publicCourses",projectId),snap=>{
      if(snap.exists()){ meta={id:snap.id,...snap.data()}; setStatus("최신 정보 연결","online"); }
      else { meta=null; setStatus("공개 정보 준비 중"); }
      renderMeta(); renderSelected(); renderMaterials();
    },err=>{ console.error(err); setStatus("공개 데이터 접근 대기","error"); $("emptyNotice").classList.add("show"); });

    fsMod.onSnapshot(fsMod.collection(db,"publicCourses",projectId,"classes"),snap=>{
      classDocs={}; snap.forEach(d=>classDocs[d.id]={id:d.id,...d.data()}); renderSelected();
    },err=>{ console.error(err); setStatus("공개 데이터 접근 대기","error"); });

    fsMod.onSnapshot(fsMod.collection(db,"publicCourses",projectId,"materials"),snap=>{
      materials=[]; snap.forEach(d=>materials.push({id:d.id,...d.data()})); renderMaterials();
    },err=>{ console.error(err); setStatus("자료실 접근 대기","error"); });
  }catch(err){
    console.error(err); setStatus("연결 오류","error"); $("emptyNotice").classList.add("show");
  }
}
init();
