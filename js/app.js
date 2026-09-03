import { firebaseConfig } from "./firebase-config.js";
import { PORTAL_CONFIG } from "./portal-config.js";

const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const projectId=new URLSearchParams(location.search).get("project")||PORTAL_CONFIG.defaultProjectId;
const classKey=`jcoupe_portal_class_${projectId}`;

let meta=null;
let classDocs={};
let selectedClass=localStorage.getItem(classKey)||"";

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
function classes(){
  return (meta?.classes&&Array.isArray(meta.classes)&&meta.classes.length)
    ? meta.classes : PORTAL_CONFIG.fallbackClasses;
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
  });
}
function renderSelected(){
  if(!selectedClass){
    $("emptyNotice").classList.add("show");
    return;
  }
  const data=classDocs[selectedClass];
  $("currentClassLabel").textContent=`${selectedClass}반 현재 진도`;
  $("historySubtitle").textContent=`${selectedClass}반 최근 공개 수업 기록`;

  if(!data){
    $("currentTitle").textContent="아직 공개된 진도가 없습니다.";
    $("currentSession").textContent="";
    $("lastDate").textContent="-";
    $("lastType").textContent="-";
    $("detail").textContent="관리자 시스템에서 학생 공개용 진도를 발행하면 이곳에 표시됩니다.";
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
      <div>
        <div class="history-title">${esc(r.title||r.type||"수업")}</div>
        <div class="history-detail">${esc(r.detail||"")}</div>
        ${r.nextStart?`<div class="history-next">다음: ${esc(r.nextStart)}</div>`:""}
      </div>
      <div class="history-session">${esc(r.session||r.type||"")}</div>
    </div>
  `).join(""):`<div class="empty">공개된 최근 수업 기록이 없습니다.</div>`;
}

async function init(){
  renderMeta();
  renderSelected();
  try{
    setStatus("Firebase 연결 중");
    const [appMod,fsMod]=await Promise.all([
      import("https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js")
    ]);
    const app=appMod.initializeApp(firebaseConfig);
    const db=fsMod.getFirestore(app);

    const metaRef=fsMod.doc(db,"publicCourses",projectId);
    fsMod.onSnapshot(metaRef,snap=>{
      if(snap.exists()){
        meta={id:snap.id,...snap.data()};
        setStatus("실시간 연결","online");
      }else{
        meta=null;
        setStatus("공개 준비 중");
      }
      renderMeta();
      renderSelected();
    },err=>{
      console.error(err);
      setStatus("공개 데이터 접근 대기","error");
      $("emptyNotice").classList.add("show");
    });

    const classesRef=fsMod.collection(db,"publicCourses",projectId,"classes");
    fsMod.onSnapshot(classesRef,snap=>{
      classDocs={};
      snap.forEach(d=>classDocs[d.id]={id:d.id,...d.data()});
      renderSelected();
    },err=>{
      console.error(err);
      setStatus("공개 데이터 접근 대기","error");
    });
  }catch(err){
    console.error(err);
    setStatus("연결 오류","error");
    $("emptyNotice").classList.add("show");
  }
}
init();
