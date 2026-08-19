"use client";
import { useEffect, useMemo, useState } from "react";
import "./reporting.css";
import "./modal.css";
import "./workflow.css";
import "./operational.css";

type AnyRow = Record<string, any>;
type Snapshot = { profile: AnyRow; permissions: AnyRow; users: AnyRow[]; activations: AnyRow[]; outlets: AnyRow[]; templates: AnyRow[]; workbookTemplates: AnyRow[]; reports: AnyRow[]; photos: AnyRow[]; reviews: AnyRow[]; settings: AnyRow };
const roles = ["Administrator","Head of Operations","Manager","Supervisor","Field Executive","Viewer"];
const reportStatuses = ["Draft","Submitted","Under Review","Approved","Returned for Correction","Rejected","Completed"];
const fmt = (n:number) => Number(n || 0).toLocaleString(undefined,{maximumFractionDigits:1});
const percent = (a:number,b:number) => b ? a / b * 100 : 0;
const formValues = (form:HTMLFormElement) => Object.fromEntries(new FormData(form).entries());

function Modal(props:{title:string;onClose:()=>void;children:React.ReactNode;wide?:boolean}) {
  return <div className="modal-backdrop" onMouseDown={props.onClose}><section className={"report-modal " + (props.wide ? "wide" : "")} role="dialog" aria-modal="true" aria-label={props.title} onMouseDown={e=>e.stopPropagation()}><div className="modal-head"><div><p>REPORTFLOW</p><h2>{props.title}</h2></div><button onClick={props.onClose} aria-label="Close">×</button></div>{props.children}</section></div>;
}
function Field(props:{label:string;name:string;type?:string;required?:boolean;defaultValue?:any;children?:React.ReactNode;min?:number}) {
  return <label>{props.label}{props.children ? <select name={props.name} required={props.required} defaultValue={props.defaultValue || ""}>{props.children}</select> : props.type === "textarea" ? <textarea name={props.name} rows={3} defaultValue={props.defaultValue}/> : <input name={props.name} type={props.type || "text"} required={props.required} defaultValue={props.defaultValue} min={props.min}/>}</label>;
}
function Empty(props:{text:string}) { return <div className="empty-state"><strong>No records</strong><p>{props.text}</p></div>; }

export default function Home() {
  const [data,setData] = useState<Snapshot|null>(null);
  const [section,setSection] = useState("Overview");
  const [tab,setTab] = useState("Dashboard");
  const [modal,setModal] = useState("");
  const [editing,setEditing] = useState<AnyRow|null>(null);
  const [notice,setNotice] = useState("");
  const [search,setSearch] = useState("");
  const [week,setWeek] = useState("");
  const [campaign,setCampaign] = useState("");
  const [location,setLocation] = useState("");
  const [status,setStatus] = useState("");
  const [sort,setSort] = useState("createdAt:desc");
  const [page,setPage] = useState(1);
  const [files,setFiles] = useState<File[]>([]);
  const [profileOpen,setProfileOpen] = useState(false);

  async function load() {
    const response = await fetch("/api/platform");
    if (response.ok) setData(await response.json());
    else if(response.status===401)window.location.href="/signin";
    else setNotice("Unable to load operational data. Please sign in again.");
  }
  useEffect(()=>{ void load(); },[]);
  async function act(action:string,payload:AnyRow) {
    setNotice("Saving…");
    const response = await fetch("/api/platform",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:action,data:payload})});
    const result = await response.json().catch(()=>({}));
    if (!response.ok) { setNotice(result.error || "Action failed."); return null; }
    setNotice("Saved successfully.");
    await load();
    return result.item || true;
  }
  const reports = useMemo(()=>{
    if (!data) return [];
    const filtered = data.reports.filter(r=>
      (!week || r.week === Number(week)) &&
      (!campaign || r.activationId === Number(campaign)) &&
      (!location || r.location === location) &&
      (!status || r.status === status) &&
      (!search || [r.outletName,r.location,r.state,r.region,r.fieldExecutive,r.brand].join(" ").toLowerCase().includes(search.toLowerCase()))
    );
    const parts = sort.split(":");
    return filtered.slice().sort((a,b)=>String(a[parts[0]] || "").localeCompare(String(b[parts[0]] || ""),undefined,{numeric:true}) * (parts[1] === "asc" ? 1 : -1));
  },[data,week,campaign,location,status,search,sort]);
  const approved = reports.filter(r=>r.status === "Approved" || r.status === "Completed");
  const totals = approved.reduce((a,r)=>({salesTarget:a.salesTarget+r.salesTarget,actualSales:a.actualSales+r.actualSales,samplingTarget:a.samplingTarget+r.samplingTarget,actualSampled:a.actualSampled+r.actualSampled,consumers:a.consumers+r.consumersEngaged}),{salesTarget:0,actualSales:0,samplingTarget:0,actualSampled:0,consumers:0});
  const group = (key:string) => Object.values(approved.reduce<Record<string,AnyRow[]>>((a,r)=>{ const k=String(r[key]); (a[k] || (a[k]=[])).push(r); return a; },{})).map(rows=>({name:String(rows[0][key]),target:rows.reduce((s,r)=>s+r.salesTarget,0),actual:rows.reduce((s,r)=>s+r.actualSales,0),sampled:rows.reduce((s,r)=>s+r.actualSampled,0)})).sort((a,b)=>b.actual-a.actual);
  const distinctLocations = Array.from(new Set(data?.reports.map(r=>String(r.location)) || []));
  const distinctWeeks = Array.from(new Set(data?.reports.map(r=>Number(r.week)) || [])).sort((a,b)=>a-b);
  const pageRows = reports.slice((page-1)*10,page*10);
  function open(name:string,item:AnyRow|null=null) { setEditing(item); setFiles([]); setModal(name); setNotice(""); }
  function exportExcel() { window.location.href="/api/export-report"; }
  async function saveReport(event:React.FormEvent<HTMLFormElement>,nextStatus:string) {
    event.preventDefault();
    const payload = Object.assign({},formValues(event.currentTarget),{id:editing?.id,status:nextStatus});
    const item = await act(editing ? "updateReport" : "createReport",payload);
    if (item && files.length) {
      const body=new FormData();body.set("reportId",String(item.id));files.forEach(file=>body.append("files",file));
      const upload=await fetch("/api/evidence",{method:"POST",body:body});
      if(!upload.ok)setNotice((await upload.json()).error || "Report saved, but evidence upload failed.");
    }
    if(item){setModal("");await load();}
  }
  async function deleteReport(id:number) { if(!window.confirm("Delete this report? The action will be recorded in the audit trail."))return;await act("deleteReport",{id:id}); }
  async function resetWeek() {
    if(!week){setNotice("Select the week you want to reset first.");return;}
    const activationId=campaign?Number(campaign):(data?.activations.length===1?data.activations[0].id:0);
    if(!activationId){setNotice("Select the activation before resetting a week.");return;}
    const activationName=data?.activations.find(a=>a.id===activationId)?.campaignName||"this activation";
    if(!window.confirm(`Reset Week ${week} for ${activationName}? This removes all worker submissions for the week and restores the original Excel figures. The master workbook will not be deleted.`))return;
    setNotice(`Resetting Week ${week}.`);
    const response=await fetch("/api/platform",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"resetWeek",data:{week:Number(week),activationId}})});
    const result=await response.json().catch(()=>({}));
    if(!response.ok){setNotice(result.error||"Unable to reset the selected week.");return;}
    setNotice(`Week ${week} reset. ${result.resetCount} worker report${result.resetCount===1?"":"s"} removed; original Excel figures restored.`);
    await load();
  }
  async function activateWorkbook(id:number) {
    setNotice("Setting active Excel template…");
    const response=await fetch("/api/workbook-template",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id})});
    const result=await response.json().catch(()=>({}));
    setNotice(response.ok?"Active Excel template updated.":result.error||"Unable to activate the workbook.");
    if(response.ok)await load();
  }
  async function deleteWorkbook(id:number) {
    if(!window.confirm("Delete this uploaded Excel template? This cannot be undone."))return;
    setNotice("Deleting Excel template…");
    const response=await fetch("/api/workbook-template?id="+id,{method:"DELETE"});
    const result=await response.json().catch(()=>({}));
    setNotice(response.ok?"Excel template deleted.":result.error||"Unable to delete the workbook.");
    if(response.ok)await load();
  }
  async function importWorkbook(id:number) {
    setNotice("Reading the Excel workbook and updating the dashboard…");
    const response=await fetch("/api/workbook-template",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({id})});
    const result=await response.json().catch(()=>({}));
    setNotice(response.ok?`${result.imported.rows} Excel rows imported: ${result.imported.created} added and ${result.imported.updated} updated.`:result.error||"Unable to import workbook data.");
    if(response.ok)await load();
  }
  if(!data)return <main className="loading-screen"><div className="brand"><span>R</span><div>ReportFlow<small>Loading your workspace…</small></div></div></main>;
  const nav=["Overview","Reports","Activations","Templates","Team","Settings"];
  const kpis=[
    ["Total Sales Target",totals.salesTarget,"Approved reports"],
    ["Total Actual Sales",totals.actualSales,percent(totals.actualSales,totals.salesTarget).toFixed(0)+"% achieved"],
    ["Actual Sampled",totals.actualSampled,percent(totals.actualSampled,totals.samplingTarget).toFixed(0)+"% achieved"],
    ["Consumers Engaged",totals.consumers,new Set(approved.map(r=>r.outletName)).size+" outlets"],
    ["Reports Submitted",reports.length,reports.filter(r=>r.status==="Submitted").length+" awaiting review"],
    ["Best Outlet",group("outletName")[0]?.name || "—","By approved sales"]
  ];
  return <main className="app-shell">
    <aside className="sidebar"><div className="brand"><span>R</span><div>ReportFlow<small>Field reporting</small></div></div><nav aria-label="Main navigation">{nav.map((item,index)=><button key={item} className={section===item?"active":""} onClick={()=>{setSection(item);setPage(1)}}>{["▦","▤","◫","⌗","♙","⚙"][index]} <span>{item}</span>{item==="Reports"&&data.reports.filter(r=>r.status==="Submitted").length>0&&<b>{data.reports.filter(r=>r.status==="Submitted").length}</b>}</button>)}</nav><div className="sidebar-foot"><div className="user" onClick={()=>setProfileOpen(!profileOpen)}><i>{data.profile.name.slice(0,2).toUpperCase()}</i><div>{data.profile.name}<small>{data.profile.role}</small></div><button aria-label="Account menu">⋯</button></div>{profileOpen&&<div className="profile-menu"><strong>{data.profile.email}</strong><button onClick={()=>open("profile",data.profile)}>View profile</button><a href="/api/auth/logout">Sign out</a></div>}</div></aside>
    <section className="workspace"><header><div><p>{section.toUpperCase()}</p><h1>{section==="Overview"?(data.activations.find(a=>a.id===Number(campaign))?.campaignName || (data.activations.length===1?data.activations[0].campaignName:"Activation Reporting")):section}</h1><span>{section==="Overview"?"Live operational performance from saved reports":"Manage "+section.toLowerCase()+" and connected records"}</span></div><div className="actions">{(section==="Overview"||section==="Reports")&&data.permissions.canResetWeek&&<button className="secondary" style={{color:"#a33a32",borderColor:"#dfb9b5"}} disabled={!week} title={week?`Reset Week ${week} worker submissions`:"Select a week first"} onClick={resetWeek}>↺ Reset {week?`Week ${week}`:"selected week"}</button>}{(section==="Overview"||section==="Reports")&&data.permissions.canReview&&<button className="secondary" onClick={exportExcel}>⇩ Export Updated Excel</button>}{section==="Overview"&&<button className="primary" onClick={()=>open("report")}>＋ New report</button>}{section==="Activations"&&data.permissions.canManage&&<button className="primary" onClick={()=>open("activation")}>＋ New activation</button>}{section==="Templates"&&data.permissions.canManage&&<><button className="secondary" onClick={()=>open("workbook")}>⇧ Upload / Import Excel</button><button className="primary" onClick={()=>open("template")}>＋ New form template</button></>}</div></header>
    {notice&&<div className="notice" role="status">{notice}</div>}
    {(section==="Overview"||section==="Reports")&&<div className="filterbar"><input aria-label="Search reports" placeholder="Search reports…" value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}}/><select aria-label="Campaign filter" value={campaign} onChange={e=>setCampaign(e.target.value)}><option value="">All campaigns</option>{data.activations.map(a=><option value={a.id} key={a.id}>{a.campaignName}</option>)}</select><select aria-label="Week filter" value={week} onChange={e=>setWeek(e.target.value)}><option value="">All weeks</option>{distinctWeeks.map(w=><option value={w} key={w}>Week {w}</option>)}</select><select aria-label="Location filter" value={location} onChange={e=>setLocation(e.target.value)}><option value="">All locations</option>{distinctLocations.map(x=><option key={x}>{x}</option>)}</select><select aria-label="Status filter" value={status} onChange={e=>setStatus(e.target.value)}><option value="">All statuses</option>{reportStatuses.map(x=><option key={x}>{x}</option>)}</select></div>}
    {section==="Overview"&&<Overview tab={tab} setTab={setTab} kpis={kpis} reports={reports} approved={approved} data={data} group={group} week={week} onView={r=>open("view",r)} onEdit={r=>open("report",r)} onReview={r=>open("review",r)} onDelete={deleteReport}/>}
    {section==="Reports"&&<><div className="section-tools"><span>{reports.length} reports</span><select value={sort} onChange={e=>setSort(e.target.value)}><option value="createdAt:desc">Newest first</option><option value="createdAt:asc">Oldest first</option><option value="actualSales:desc">Highest sales</option><option value="outletName:asc">Outlet A–Z</option></select><button onClick={exportExcel}>Export all approved weeks</button></div><ReportsTable rows={pageRows} data={data} onView={r=>open("view",r)} onEdit={r=>open("report",r)} onDuplicate={r=>act("duplicateReport",{id:r.id,week:r.week,activationDate:r.activationDate,overrideDuplicate:true})} onDelete={deleteReport}/><div className="pagination"><button disabled={page===1} onClick={()=>setPage(page-1)}>Previous</button><span>Page {page} of {Math.max(1,Math.ceil(reports.length/10))}</span><button disabled={page*10>=reports.length} onClick={()=>setPage(page+1)}>Next</button></div></>}
    {section==="Activations"&&<ActivationSection data={data} onEdit={a=>open("activation",a)} onOutlet={a=>open("outlet",{activationId:a.id})} onOpen={a=>{setCampaign(String(a.id));setSection("Overview")}}/>}
    {section==="Templates"&&<TemplateSection data={data} onEdit={t=>open("template",t)} onUse={t=>open("report",{templateId:t.id})} onActivateWorkbook={activateWorkbook} onDeleteWorkbook={deleteWorkbook} onImportWorkbook={importWorkbook}/>} 
    {section==="Team"&&<TeamSection data={data} onEdit={u=>open("user",u)}/>}
    {section==="Settings"&&<SettingsSection data={data} onSave={d=>act("saveSettings",d)}/>}
    </section>
    {modal==="report"&&<ReportForm data={data} item={editing} files={files} setFiles={setFiles} notice={notice} onClose={()=>setModal("")} onSave={saveReport}/>}
    {modal==="activation"&&<ActivationForm item={editing} onClose={()=>setModal("")} onSave={async d=>{if(await act(editing?"updateActivation":"createActivation",d))setModal("")}}/>}
    {modal==="outlet"&&<OutletForm data={data} item={editing} onClose={()=>setModal("")} onSave={async d=>{if(await act(editing?.id?"updateOutlet":"createOutlet",d))setModal("")}}/>}
    {modal==="template"&&<TemplateForm item={editing} onClose={()=>setModal("")} onSave={async d=>{if(await act(editing?"updateTemplate":"createTemplate",d))setModal("")}}/>}
    {modal==="workbook"&&<WorkbookUploadForm onClose={()=>setModal("")} onUploaded={async message=>{setModal("");setNotice(message);await load();}}/>}
    {modal==="user"&&<UserForm item={editing!} own={false} onClose={()=>setModal("")} onSave={async d=>{if(await act("saveUser",d))setModal("")}}/>}
    {modal==="profile"&&<UserForm item={editing!} own={true} onClose={()=>setModal("")} onSave={()=>setModal("")}/>}
    {modal==="review"&&<ReviewForm item={editing!} onClose={()=>setModal("")} onSave={async d=>{if(await act("reviewReport",d))setModal("")}}/>}
    {modal==="view"&&<ReportView data={data} item={editing!} onClose={()=>setModal("")}/>}
  </main>;
}

function Chart(props:{title:string;rows:AnyRow[];metric:string}) {
  const max=Math.max(1,...props.rows.map(r=>r[props.metric]));
  return <article className="panel data-chart"><div className="panel-title"><div><h2>{props.title}</h2><p>Approved and completed reports</p></div></div>{props.rows.length?props.rows.slice(0,8).map(r=><div className="chart-row" key={r.name}><span>{String(r.name).match(/^[0-9]+$/)?"Week "+r.name:r.name}</span><div><i style={{width:(r[props.metric]/max*100)+"%"}}/></div><b>{fmt(r[props.metric])}</b></div>):<Empty text="Approved reports will appear here."/>}</article>;
}
function Overview(props:{tab:string;setTab:(x:string)=>void;kpis:any[][];reports:AnyRow[];approved:AnyRow[];data:Snapshot;group:(k:string)=>AnyRow[];week:string;onView:(r:AnyRow)=>void;onEdit:(r:AnyRow)=>void;onReview:(r:AnyRow)=>void;onDelete:(id:number)=>void}) {
  return <><div className="toolbar"><div className="tabs">{["Dashboard","Weekly Report","Cumulative","Analysis","Review"].map(x=><button key={x} className={props.tab===x?"selected":""} onClick={()=>props.setTab(x)}>{x}</button>)}</div></div>
  {props.tab==="Dashboard"&&<><section className="kpi-grid six">{props.kpis.map((k,i)=><article className={"kpi "+["green","blue","amber","violet","blue","green"][i]} key={k[0]}><div><span>{k[0]}</span><strong className={typeof k[1]==="string"?"word":""}>{typeof k[1]==="number"?fmt(k[1]):k[1]}</strong><small>{k[2]}</small></div></article>)}</section><section className="charts-grid"><Chart title="Weekly Sales Trend" rows={props.group("week")} metric="actual"/><Chart title="Sales by Location" rows={props.group("location")} metric="actual"/></section><section className="charts-grid"><Chart title="Weekly Sampling Trend" rows={props.group("week")} metric="sampled"/><Chart title="Team Performance" rows={props.group("fieldExecutive")} metric="actual"/></section></>}
  {props.tab==="Weekly Report"&&<Summary title={props.week?"Week "+props.week:"Select a week using the filter"} reports={props.week?props.reports:[]} groupKey="outletName"/>}
  {props.tab==="Cumulative"&&<Summary title="Cumulative Performance" reports={props.reports} groupKey="location"/>}
  {props.tab==="Analysis"&&<ReportsTable rows={props.reports} data={props.data} onView={props.onView} onEdit={props.onEdit} onDuplicate={()=>{}} onDelete={props.onDelete}/>}
  {props.tab==="Review"&&<ReviewPanel rows={props.reports.filter(r=>r.status!=="Draft"&&r.status!=="Completed")} data={props.data} onView={props.onView} onReview={props.onReview}/>}
  </>;
}
function Summary(props:{title:string;reports:AnyRow[];groupKey:string}) {
  const totals=props.reports.reduce((a,r)=>({st:a.st+r.salesTarget,sa:a.sa+r.actualSales,pt:a.pt+r.samplingTarget,pa:a.pa+r.actualSampled,ce:a.ce+r.consumersEngaged}),{st:0,sa:0,pt:0,pa:0,ce:0});
  const groups=Object.values(props.reports.reduce<Record<string,AnyRow[]>>((a,r)=>{(a[r[props.groupKey]]||(a[r[props.groupKey]]=[])).push(r);return a;},{}));
  return <><section className="kpi-grid"><article className="kpi green"><span>Sales Target</span><strong>{fmt(totals.st)}</strong></article><article className="kpi blue"><span>Actual Sales</span><strong>{fmt(totals.sa)}</strong><small>{percent(totals.sa,totals.st).toFixed(0)}%</small></article><article className="kpi amber"><span>Actual Sampled</span><strong>{fmt(totals.pa)}</strong><small>{percent(totals.pa,totals.pt).toFixed(0)}%</small></article><article className="kpi violet"><span>Consumers Engaged</span><strong>{fmt(totals.ce)}</strong></article></section><section className="panel table-panel"><div className="panel-title"><div><h2>{props.title}</h2><p>{new Set(props.reports.map(r=>r.outletName)).size} outlets covered</p></div></div><div className="sheet-wrap"><table><thead><tr><th>{props.groupKey==="outletName"?"OUTLET":"LOCATION"}</th><th>REPORTS</th><th>SALES TARGET</th><th>ACTUAL SALES</th><th>SALES %</th><th>SAMPLED</th><th>CHALLENGES / RECOMMENDATIONS</th></tr></thead><tbody>{groups.length?groups.map(rows=><tr key={rows[0][props.groupKey]}><td>{rows[0][props.groupKey]}</td><td>{rows.length}</td><td>{fmt(rows.reduce((s,r)=>s+r.salesTarget,0))}</td><td>{fmt(rows.reduce((s,r)=>s+r.actualSales,0))}</td><td className="percent">{percent(rows.reduce((s,r)=>s+r.actualSales,0),rows.reduce((s,r)=>s+r.salesTarget,0)).toFixed(0)}%</td><td>{fmt(rows.reduce((s,r)=>s+r.actualSampled,0))}</td><td>{rows.map(r=>r.challenges||r.recommendations).filter(Boolean).slice(0,2).join(" • ")||"—"}</td></tr>):<tr><td colSpan={7}>No reports match this period.</td></tr>}</tbody></table></div></section></>;
}
function ReportsTable(props:{rows:AnyRow[];data:Snapshot;onView:(r:AnyRow)=>void;onEdit:(r:AnyRow)=>void;onDuplicate:(r:AnyRow)=>void;onDelete:(id:number)=>void}) {
  return <section className="panel table-panel"><div className="panel-title"><div><h2>Detailed reports</h2><p>Saved operational records</p></div></div><div className="sheet-wrap"><table><thead><tr><th>WEEK</th><th>DATE</th><th>CAMPAIGN</th><th>OUTLET</th><th>LOCATION</th><th>SALES</th><th>SALES %</th><th>SAMPLED</th><th>SAMPLING %</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>{props.rows.length?props.rows.map(r=><tr key={r.id}><td>{r.week}</td><td>{r.activationDate}</td><td>{props.data.activations.find(a=>a.id===r.activationId)?.campaignName}</td><td>{r.outletName}</td><td>{r.location}</td><td>{fmt(r.actualSales)}</td><td className="percent">{percent(r.actualSales,r.salesTarget).toFixed(0)}%</td><td>{fmt(r.actualSampled)}</td><td className="percent">{percent(r.actualSampled,r.samplingTarget).toFixed(0)}%</td><td><span className={"status "+((r.status==="Approved"||r.status==="Completed")?"good":"watch")}>{r.status}</span></td><td><div className="row-actions"><button onClick={()=>props.onView(r)}>View</button><button onClick={()=>props.onEdit(r)}>Edit</button><button onClick={()=>props.onDuplicate(r)}>Duplicate</button><button className="danger" onClick={()=>props.onDelete(r.id)}>Delete</button></div></td></tr>):<tr><td colSpan={11}>No reports match the selected filters.</td></tr>}</tbody></table></div></section>;
}
function _LegacyReviewPanel(props:{rows:AnyRow[];data:Snapshot;onView:(r:AnyRow)=>void;onReview:(r:AnyRow)=>void}) {
  return <section className="panel table-panel"><div className="panel-title"><div><h2>Review queue</h2><p>Submitted reports and management decisions</p></div></div><div className="sheet-wrap"><table><thead><tr><th>REPORT</th><th>OUTLET</th><th>SUBMITTED BY</th><th>STATUS</th><th>LAST REVIEW</th><th>ACTION</th></tr></thead><tbody>{props.rows.length?props.rows.map(r=>{const review=props.data.reviews.find(x=>x.reportId===r.id);return <tr key={r.id}><td>Week {r.week} · {r.activationDate}</td><td>{r.outletName}</td><td>{props.data.users.find(u=>u.id===r.submittedBy)?.name}</td><td>{r.status}</td><td>{review?review.newStatus+": "+review.comment:"Not reviewed"}</td><td><div className="row-actions"><button onClick={()=>props.onView(r)}>Open</button><button disabled={!props.data.permissions.canReview} onClick={()=>props.onReview(r)}>Review</button></div></td></tr>}):<tr><td colSpan={6}>No reports awaiting review.</td></tr>}</tbody></table></div></section>;
}
function ReviewPanel(props:{rows:AnyRow[];data:Snapshot;onView:(r:AnyRow)=>void;onReview:(r:AnyRow)=>void}) {
  return <section className="panel table-panel">
    <div className="panel-title"><div><h2>Review queue</h2><p>Approve reports individually. “Export Updated Excel” downloads the complete workbook with all approved weeks and outlets.</p></div></div>
    <div className="sheet-wrap"><table><thead><tr><th>REPORT</th><th>OUTLET</th><th>SUBMITTED BY</th><th>STATUS</th><th>LAST REVIEW</th><th>ACTION</th></tr></thead>
      <tbody>{props.rows.length?props.rows.map(r=>{
        const review=props.data.reviews.find(x=>x.reportId===r.id);
        return <tr key={r.id}><td>Week {r.week} - {r.activationDate}</td><td>{r.outletName}</td><td>{props.data.users.find(u=>u.id===r.submittedBy)?.name}</td><td>{r.status}</td><td>{review?review.newStatus+": "+review.comment:"Not reviewed"}</td><td><div className="row-actions"><button onClick={()=>props.onView(r)}>Open</button><button disabled={!props.data.permissions.canReview} onClick={()=>props.onReview(r)}>Review</button></div></td></tr>;
      }):<tr><td colSpan={6}>No reports awaiting review.</td></tr>}</tbody>
    </table></div>
  </section>;
}
function ActivationSection(props:{data:Snapshot;onEdit:(a:AnyRow)=>void;onOutlet:(a:AnyRow)=>void;onOpen:(a:AnyRow)=>void}) {
  if(!props.data.activations.length)return <Empty text="Create your first campaign to begin reporting."/>;
  return <div className="cards-grid">{props.data.activations.map(a=><article className="management-card" key={a.id}><span className={"status "+(a.status==="Active"?"good":"watch")}>{a.status}</span><h2>{a.campaignName}</h2><p>{a.client} · {a.brand}</p><dl><dt>Period</dt><dd>{a.startDate} — {a.endDate}</dd><dt>Sales target</dt><dd>{fmt(a.salesTarget)}</dd><dt>Sampling target</dt><dd>{fmt(a.samplingTarget)}</dd><dt>Outlets</dt><dd>{props.data.outlets.filter(o=>o.activationId===a.id).length}</dd></dl><div className="card-actions"><button onClick={()=>props.onEdit(a)}>Edit</button><button onClick={()=>props.onOutlet(a)}>Add outlet</button><button onClick={()=>props.onOpen(a)}>Open dashboard</button></div></article>)}</div>;
}
function TemplateSection(props:{data:Snapshot;onEdit:(t:AnyRow)=>void;onUse:(t:AnyRow)=>void;onActivateWorkbook:(id:number)=>void;onDeleteWorkbook:(id:number)=>void;onImportWorkbook:(id:number)=>void}) {
  return <div className="template-stack">
    <section className="panel workbook-panel"><div className="panel-title"><div><h2>Master Excel workbook</h2><p>The active .xlsx is preserved as the base for every generated export.</p></div><span className="excel-chip">XLSX</span></div>
      {props.data.workbookTemplates.length?<div className="workbook-list">{props.data.workbookTemplates.map(w=><article className={w.isActive?"active":""} key={w.id}><div className="file-mark">X</div><div><strong>{w.name}</strong><span>{w.fileName}</span><small>{(w.sizeBytes/1_000_000).toFixed(2)} MB · Uploaded {new Date(w.uploadedAt).toLocaleDateString()} · {w.importedRows?`${w.importedRows} dashboard rows imported`:"Not yet imported"}</small></div><span className={"status "+(w.isActive?"good":"watch")}>{w.isActive?"Active master":"Stored"}</span><div className="card-actions">{props.data.permissions.canManage&&<button onClick={()=>props.onImportWorkbook(w.id)}>{w.importedRows?"Re-import data":"Import to dashboard"}</button>}<a className="button-link compact" href={"/api/workbook-template?id="+w.id}>Download</a>{!w.isActive&&props.data.permissions.canManage&&<button onClick={()=>props.onActivateWorkbook(w.id)}>Set active</button>}{props.data.permissions.canManage&&<button className="danger" onClick={()=>props.onDeleteWorkbook(w.id)}>Delete</button>}</div></article>)}</div>:<div className="workbook-empty"><strong>No Excel master uploaded yet</strong><p>Choose “Upload / Import Excel” above and select the existing report workbook from your computer.</p></div>}
    </section>
    <section><div className="subsection-title"><div><h2>Report form templates</h2><p>Control which fields the team fills for each type of activity.</p></div></div>{props.data.templates.length?<div className="cards-grid">{props.data.templates.map(t=><article className="management-card" key={t.id}><span className="status good">{t.status}</span><h2>{t.name}</h2><p>{t.activationType}</p><small>{JSON.parse(t.fieldsJson).length} optional fields enabled</small><div className="card-actions"><button onClick={()=>props.onEdit(t)}>Edit template</button><button onClick={()=>props.onUse(t)}>Use template</button></div></article>)}</div>:<Empty text="Create a reusable form format for your team."/>}</section>
  </div>;
}
function TeamSection(props:{data:Snapshot;onEdit:(u:AnyRow)=>void}) {
  return <section className="panel table-panel"><div className="panel-title"><div><h2>Team members</h2><p>Roles are enforced by the server</p></div></div><div className="sheet-wrap"><table><thead><tr><th>NAME</th><th>EMAIL</th><th>ROLE</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>{props.data.users.map(u=><tr key={u.id}><td>{u.name}</td><td>{u.email}</td><td>{u.role}</td><td>{u.status}</td><td><button disabled={props.data.profile.role!=="Administrator"} onClick={()=>props.onEdit(u)}>Manage</button></td></tr>)}</tbody></table></div></section>;
}
function SettingsSection(props:{data:Snapshot;onSave:(d:AnyRow)=>void}) {
  return <section className="panel settings-panel"><div className="panel-title"><div><h2>System settings</h2><p>Saved configuration used across ReportFlow</p></div></div><form onSubmit={e=>{e.preventDefault();props.onSave(formValues(e.currentTarget))}}><div className="form-grid three"><Field label="Company Name" name="companyName" defaultValue={props.data.settings.companyName}/><Field label="Reporting Year" name="reportingYear" type="number" defaultValue={props.data.settings.reportingYear||new Date().getFullYear()}/><Field label="Default Sales Target" name="defaultSalesTarget" type="number" min={0} defaultValue={props.data.settings.defaultSalesTarget}/><Field label="Default Sampling Target" name="defaultSamplingTarget" type="number" min={0} defaultValue={props.data.settings.defaultSamplingTarget}/><Field label="Regions" name="regions" defaultValue={props.data.settings.regions}/><Field label="States" name="states" defaultValue={props.data.settings.states}/><Field label="Locations" name="locations" defaultValue={props.data.settings.locations}/><Field label="Outlet Types" name="outletTypes" defaultValue={props.data.settings.outletTypes}/><Field label="Report Statuses" name="reportStatuses" defaultValue={props.data.settings.reportStatuses||reportStatuses.join(", ")}/></div><div className="form-actions"><button className="primary">Save settings</button></div></form></section>;
}
function _LegacyReportForm(props:{data:Snapshot;item:AnyRow|null;files:File[];setFiles:(f:File[])=>void;notice:string;onClose:()=>void;onSave:(e:React.FormEvent<HTMLFormElement>,s:string)=>void}) {
  return <Modal title={props.item?.id?"Edit field report":"New field report"} onClose={props.onClose} wide><form onSubmit={e=>props.onSave(e,"Submitted")}><div className="form-grid three">
    <Field label="Campaign / Activation" name="activationId" required defaultValue={props.item?.activationId}><option value="">Select campaign</option>{props.data.activations.filter(a=>a.status!=="Cancelled").map(a=><option value={a.id} key={a.id}>{a.campaignName}</option>)}</Field>
    <Field label="Template" name="templateId" defaultValue={props.item?.templateId}><option value="">Standard report</option>{props.data.templates.filter(t=>t.status==="Active").map(t=><option value={t.id} key={t.id}>{t.name}</option>)}</Field>
    <Field label="Reporting Week" name="week" type="number" min={1} required defaultValue={props.item?.week}/>
    <Field label="Activation Date" name="activationDate" type="date" required defaultValue={props.item?.activationDate}/>
    <Field label="Outlet" name="outletName" required defaultValue={props.item?.outletName}><option value="">Select outlet</option>{props.data.outlets.map(o=><option value={o.name} key={o.id}>{o.name} · {o.location}</option>)}</Field>
    <Field label="Outlet Type" name="outletType" required defaultValue={props.item?.outletType}/>
    <Field label="Location" name="location" required defaultValue={props.item?.location}/>
    <Field label="State" name="state" required defaultValue={props.item?.state}/>
    <Field label="Region" name="region" required defaultValue={props.item?.region}/>
    <Field label="Field Executive" name="fieldExecutive" required defaultValue={props.item?.fieldExecutive||props.data.profile.name}/>
    <Field label="Supervisor" name="supervisor" defaultValue={props.item?.supervisor}/>
    <Field label="Sales Target" name="salesTarget" type="number" min={0} required defaultValue={props.item?.salesTarget}/>
    <Field label="Actual Sales" name="actualSales" type="number" min={0} required defaultValue={props.item?.actualSales}/>
    <Field label="Sampling Target" name="samplingTarget" type="number" min={0} required defaultValue={props.item?.samplingTarget}/>
    <Field label="Actual Sampled" name="actualSampled" type="number" min={0} required defaultValue={props.item?.actualSampled}/>
    <Field label="Consumers Engaged" name="consumersEngaged" type="number" min={0} required defaultValue={props.item?.consumersEngaged}/>
    <Field label="Opening Stock" name="openingStock" type="number" min={0} required defaultValue={props.item?.openingStock}/>
    <Field label="Closing Stock" name="closingStock" type="number" min={0} required defaultValue={props.item?.closingStock}/>
    <Field label="Bottles Sold" name="bottlesSold" type="number" min={0} required defaultValue={props.item?.bottlesSold}/>
    <Field label="Cases Sold" name="casesSold" type="number" min={0} defaultValue={props.item?.casesSold}/>
  </div><div className="form-grid two text-fields">
    <Field label="Consumer Feedback" name="consumerFeedback" type="textarea" defaultValue={props.item?.consumerFeedback}/>
    <Field label="Key Observations" name="keyObservations" type="textarea" defaultValue={props.item?.keyObservations}/>
    <Field label="Challenges" name="challenges" type="textarea" defaultValue={props.item?.challenges}/>
    <Field label="Competitor Activities" name="competitorActivities" type="textarea" defaultValue={props.item?.competitorActivities}/>
    <Field label="Recommendations" name="recommendations" type="textarea" defaultValue={props.item?.recommendations}/>
    <Field label="Corrective / Next Action" name="correctiveAction" type="textarea" defaultValue={props.item?.correctiveAction}/>
    <Field label="General Comments" name="generalComments" type="textarea" defaultValue={props.item?.generalComments}/>
    <label>Photo / Evidence Upload<input type="file" accept="image/*" multiple onChange={e=>props.setFiles(Array.from(e.target.files||[]))}/><small>{props.files.length} file(s) selected · maximum 10, 8 MB each</small></label>
  </div>{props.notice&&<div className="form-message">{props.notice}</div>}<div className="form-actions"><button type="button" onClick={props.onClose}>Cancel</button><button type="button" className="secondary" onClick={e=>props.onSave({preventDefault:()=>{},currentTarget:e.currentTarget.closest("form")!} as any,"Draft")}>Save Draft</button><button type="submit" className="primary">Submit Report</button></div></form></Modal>;
}
function ReportForm(props:{data:Snapshot;item:AnyRow|null;files:File[];setFiles:(f:File[])=>void;notice:string;onClose:()=>void;onSave:(e:React.FormEvent<HTMLFormElement>,s:string)=>void}) {
  const [activationId,setActivationId]=useState(String(props.item?.activationId||""));
  const [outletName,setOutletName]=useState(String(props.item?.outletName||""));
  const [activationDate,setActivationDate]=useState(String(props.item?.activationDate||""));
  const [salesTarget,setSalesTarget]=useState(String(props.item?.salesTarget??""));
  const [samplingTarget,setSamplingTarget]=useState(String(props.item?.samplingTarget??""));
  const activeCampaigns=props.data.activations.filter(a=>a.status!=="Cancelled");
  const selectedActivation=activeCampaigns.find(a=>String(a.id)===activationId);
  const availableOutlets=props.data.outlets.filter(o=>(!activationId||String(o.activationId)===activationId)&&(o.status!=="Inactive"||o.name===props.item?.outletName));
  const selectedOutlet=availableOutlets.find(o=>o.name===outletName);
  const outletType=selectedOutlet?.outletType||props.item?.outletType||"";
  const outletLocation=selectedOutlet?.location||props.item?.location||"";
  const outletState=selectedOutlet?.state||props.item?.state||"";
  const outletRegion=selectedOutlet?.region||props.item?.region||"";
  const chooseActivation=(value:string)=>{
    setActivationId(value);
    setOutletName("");
    setSalesTarget("");
    setSamplingTarget("");
    const activation=activeCampaigns.find(a=>String(a.id)===value);
    if(activation&&(!activationDate||activationDate<activation.startDate||activationDate>activation.endDate))setActivationDate(activation.startDate);
  };
  const chooseOutlet=(value:string)=>{
    setOutletName(value);
    const outlet=props.data.outlets.find(o=>String(o.activationId)===activationId&&o.name===value);
    if(outlet){
      setSalesTarget(String(outlet.salesTarget??props.data.settings.defaultSalesTarget??""));
      setSamplingTarget(String(outlet.samplingTarget??props.data.settings.defaultSamplingTarget??""));
    }
  };
  return <Modal title={props.item?.id?"Edit field report":"New field report"} onClose={props.onClose}><form onSubmit={e=>props.onSave(e,"Submitted")}>
    <p className="report-form-intro">Enter the weekly results only. Outlet, location and team details are filled automatically.</p>
    <div className="form-grid two report-core-grid">
      <label>Campaign / Activation<select name="activationId" required value={activationId} onChange={e=>chooseActivation(e.target.value)}><option value="">Select campaign</option>{activeCampaigns.map(a=><option value={a.id} key={a.id}>{a.campaignName}</option>)}</select></label>
      <Field label="Reporting Week" name="week" type="number" min={1} required defaultValue={props.item?.week}/>
      <label>Activation Date<input name="activationDate" type="date" required value={activationDate} min={selectedActivation?.startDate} max={selectedActivation?.endDate} onChange={e=>setActivationDate(e.target.value)}/></label>
      <label>Outlet<select name="outletName" required value={outletName} onChange={e=>chooseOutlet(e.target.value)} disabled={!activationId}><option value="">{activationId?"Select outlet":"Select campaign first"}</option>{availableOutlets.map(o=><option value={o.name} key={o.id}>{o.name}</option>)}</select></label>
      {outletName&&<div className="report-autofill"><strong>Filled automatically</strong><span>{[outletLocation,outletType,outletState,outletRegion].filter(Boolean).join(" · ")}</span><small>Reported by {props.item?.fieldExecutive||props.data.profile.name}</small></div>}
    </div>
    <h3 className="report-form-section">Weekly performance</h3>
    <div className="form-grid two">
      <label>Sales Target<input name="salesTarget" type="number" min={0} required value={salesTarget} onChange={e=>setSalesTarget(e.target.value)}/></label>
      <Field label="Actual Sales" name="actualSales" type="number" min={0} required defaultValue={props.item?.actualSales}/>
      <label>Sampling Target<input name="samplingTarget" type="number" min={0} required value={samplingTarget} onChange={e=>setSamplingTarget(e.target.value)}/></label>
      <Field label="Actual Sampled" name="actualSampled" type="number" min={0} required defaultValue={props.item?.actualSampled}/>
      <Field label="Opening Stock" name="openingStock" type="number" min={0} required defaultValue={props.item?.openingStock}/>
      <Field label="Closing Stock" name="closingStock" type="number" min={0} required defaultValue={props.item?.closingStock}/>
      <Field label="Consumers Engaged" name="consumersEngaged" type="number" min={0} required defaultValue={props.item?.consumersEngaged}/>
    </div>
    <input type="hidden" name="outletId" value={selectedOutlet?.id||props.item?.outletId||""}/>
    <input type="hidden" name="outletType" value={outletType}/><input type="hidden" name="location" value={outletLocation}/><input type="hidden" name="state" value={outletState}/><input type="hidden" name="region" value={outletRegion}/>
    <input type="hidden" name="fieldExecutive" value={props.item?.fieldExecutive||props.data.profile.name}/><input type="hidden" name="bottlesSold" value={props.item?.bottlesSold||0}/>
    <details className="optional-report-details"><summary>Add notes, evidence or extra details <span>Optional</span></summary><div className="form-grid two optional-report-grid">
      <Field label="Template" name="templateId" defaultValue={props.item?.templateId}><option value="">Standard report</option>{props.data.templates.filter(t=>t.status==="Active").map(t=><option value={t.id} key={t.id}>{t.name}</option>)}</Field>
      <Field label="Supervisor" name="supervisor" defaultValue={props.item?.supervisor}/>
      <Field label="Cases Sold" name="casesSold" type="number" min={0} defaultValue={props.item?.casesSold}/>
      <Field label="Consumer Feedback" name="consumerFeedback" type="textarea" defaultValue={props.item?.consumerFeedback}/>
      <Field label="Key Observations" name="keyObservations" type="textarea" defaultValue={props.item?.keyObservations}/>
      <Field label="Challenges" name="challenges" type="textarea" defaultValue={props.item?.challenges}/>
      <Field label="Competitor Activities" name="competitorActivities" type="textarea" defaultValue={props.item?.competitorActivities}/>
      <Field label="Recommendations" name="recommendations" type="textarea" defaultValue={props.item?.recommendations}/>
      <Field label="Corrective / Next Action" name="correctiveAction" type="textarea" defaultValue={props.item?.correctiveAction}/>
      <Field label="General Comments" name="generalComments" type="textarea" defaultValue={props.item?.generalComments}/>
      <label>Photo / Evidence Upload<input type="file" accept="image/*" multiple onChange={e=>props.setFiles(Array.from(e.target.files||[]))}/><small>{props.files.length} file(s) selected · maximum 10, 8 MB each</small></label>
    </div></details>
    {props.notice&&<div className="form-message">{props.notice}</div>}<div className="form-actions"><button type="button" onClick={props.onClose}>Cancel</button><button type="button" className="secondary" onClick={e=>props.onSave({preventDefault:()=>{},currentTarget:e.currentTarget.closest("form")!} as any,"Draft")}>Save Draft</button><button type="submit" className="primary">Submit Report</button></div>
  </form></Modal>;
}
function ActivationForm(props:{item:AnyRow|null;onClose:()=>void;onSave:(d:AnyRow)=>void}) {
  return <Modal title={props.item?"Edit activation":"Create activation"} onClose={props.onClose}><form onSubmit={e=>{e.preventDefault();props.onSave(Object.assign({},formValues(e.currentTarget),{id:props.item?.id}))}}><div className="form-grid"><Field label="Campaign Name" name="campaignName" required defaultValue={props.item?.campaignName}/><Field label="Client" name="client" required defaultValue={props.item?.client}/><Field label="Brand" name="brand" required defaultValue={props.item?.brand}/><Field label="Start Date" name="startDate" type="date" required defaultValue={props.item?.startDate}/><Field label="End Date" name="endDate" type="date" required defaultValue={props.item?.endDate}/><Field label="Locations" name="locations" defaultValue={props.item?.locations}/><Field label="States" name="states" defaultValue={props.item?.states}/><Field label="Sales Target" name="salesTarget" type="number" min={0} defaultValue={props.item?.salesTarget}/><Field label="Sampling Target" name="samplingTarget" type="number" min={0} defaultValue={props.item?.samplingTarget}/><Field label="Status" name="status" defaultValue={props.item?.status}><option>Planned</option><option>Active</option><option>Completed</option><option>Paused</option><option>Cancelled</option></Field><Field label="Reporting Frequency" name="reportingFrequency" defaultValue={props.item?.reportingFrequency}><option>Daily</option><option>Weekly</option><option>Monthly</option></Field></div><Field label="Campaign Description" name="description" type="textarea" defaultValue={props.item?.description}/><div className="form-actions"><button type="button" onClick={props.onClose}>Cancel</button><button className="primary">Save activation</button></div></form></Modal>;
}
function OutletForm(props:{data:Snapshot;item:AnyRow|null;onClose:()=>void;onSave:(d:AnyRow)=>void}) {
  return <Modal title={props.item?.id?"Edit outlet":"Add outlet"} onClose={props.onClose}><form onSubmit={e=>{e.preventDefault();props.onSave(Object.assign({},formValues(e.currentTarget),{id:props.item?.id}))}}><div className="form-grid"><Field label="Activation" name="activationId" required defaultValue={props.item?.activationId}><option value="">Select campaign</option>{props.data.activations.map(a=><option value={a.id} key={a.id}>{a.campaignName}</option>)}</Field><Field label="Outlet Name" name="name" required defaultValue={props.item?.name}/><Field label="Outlet Type" name="outletType" required defaultValue={props.item?.outletType}><option value="">Select type</option>{["Bar","Lounge","Restaurant","Retail Store","Open Market","Event Venue","Exhibition"].map(x=><option key={x}>{x}</option>)}</Field><Field label="Location" name="location" required defaultValue={props.item?.location}/><Field label="State" name="state" required defaultValue={props.item?.state}/><Field label="Region" name="region" required defaultValue={props.item?.region}/><Field label="Sales Target" name="salesTarget" type="number" min={0} defaultValue={props.item?.salesTarget}/><Field label="Sampling Target" name="samplingTarget" type="number" min={0} defaultValue={props.item?.samplingTarget}/><Field label="Status" name="status" defaultValue={props.item?.status}><option>Active</option><option>Inactive</option></Field></div><div className="form-actions"><button type="button" onClick={props.onClose}>Cancel</button><button className="primary">Save outlet</button></div></form></Modal>;
}
function TemplateForm(props:{item:AnyRow|null;onClose:()=>void;onSave:(d:AnyRow)=>void}) {
  const options=["consumerFeedback","keyObservations","challenges","competitorActivities","recommendations","correctiveAction","generalComments","casesSold"];
  const enabled=props.item?JSON.parse(props.item.fieldsJson):options;
  return <Modal title={props.item?"Edit template":"Create template"} onClose={props.onClose}><form onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);props.onSave({id:props.item?.id,name:form.get("name"),activationType:form.get("activationType"),status:form.get("status"),fields:options.filter(x=>form.get(x))})}}><div className="form-grid"><Field label="Template Name" name="name" required defaultValue={props.item?.name}/><Field label="Activation Type" name="activationType" required defaultValue={props.item?.activationType}><option value="">Select type</option>{["On-Trade Activation","Off-Trade Activation","Open Market Activation","Event Sponsorship","Product Sampling","Retail Activation","Roadshow","Exhibition","Brand Launch"].map(x=><option key={x}>{x}</option>)}</Field><Field label="Status" name="status" defaultValue={props.item?.status}><option>Active</option><option>Inactive</option></Field></div><fieldset><legend>Optional fields shown in the report form</legend>{options.map(x=><label className="check" key={x}><input type="checkbox" name={x} defaultChecked={enabled.includes(x)}/>{x.replace(/([A-Z])/g," $1")}</label>)}</fieldset><div className="form-actions"><button type="button" onClick={props.onClose}>Cancel</button><button className="primary">Save template</button></div></form></Modal>;
}
function WorkbookUploadForm(props:{onClose:()=>void;onUploaded:(message:string)=>void}) {
  const [selected,setSelected]=useState<File|null>(null);
  const [name,setName]=useState("");
  const [uploading,setUploading]=useState(false);
  const [message,setMessage]=useState("");
  return <Modal title="Upload and import Excel report" onClose={props.onClose}><form onSubmit={async e=>{e.preventDefault();if(!selected){setMessage("Choose an .xlsx workbook first.");return}setUploading(true);setMessage("Uploading, reading the workbook and updating the dashboard…");const body=new FormData(e.currentTarget);const response=await fetch("/api/workbook-template",{method:"POST",body});const result=await response.json().catch(()=>({}));if(response.ok){props.onUploaded(result.imported?`Excel uploaded and ${result.imported.rows} rows imported to the dashboard.`:`Excel uploaded. ${result.warning||"Use Import to dashboard after mapping its columns."}`);return}setUploading(false);setMessage(result.error||"Workbook upload failed.")}}>
    <div className="upload-callout"><div className="file-mark large">X</div><div><strong>Import your existing Excel report</strong><p>ReportFlow reads the weekly outlet figures into the live dashboard and also keeps the workbook as the base for future exports.</p></div></div>
    <div className="form-grid"><label>Template Name<input name="name" required value={name} onChange={e=>setName(e.target.value)}/></label><label>Excel Workbook (.xlsx)<input name="file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required onChange={e=>{const file=e.target.files?.[0]||null;setSelected(file);if(file&&!name)setName(file.name.replace(/\.xlsx$/i,""));setMessage("")}}/><small>{selected?`${selected.name} · ${(selected.size/1_000_000).toFixed(2)} MB`:"Maximum file size: 20 MB"}</small></label></div>
    <div className="upload-note"><strong>What happens next</strong><span>Detected WEEK sheets are imported immediately. Re-upload an updated workbook later to add new weeks or refresh matching outlet records.</span></div>
    {message&&<div className="form-message">{message}</div>}<div className="form-actions"><button type="button" onClick={props.onClose} disabled={uploading}>Cancel</button><button className="primary" disabled={uploading}>{uploading?"Importing…":"Upload, import & set active"}</button></div>
  </form></Modal>;
}
function UserForm(props:{item:AnyRow;onClose:()=>void;onSave:(d:AnyRow)=>void;own:boolean}) {
  return <Modal title={props.own?"My profile":"Manage team member"} onClose={props.onClose}><form onSubmit={e=>{e.preventDefault();props.onSave(Object.assign({},formValues(e.currentTarget),{id:props.item.id}))}}><div className="form-grid"><Field label="Name" name="name" required defaultValue={props.item.name}/><Field label="Email" name="email" defaultValue={props.item.email}/><Field label="Phone" name="phone" defaultValue={props.item.phone}/><Field label="Role" name="role" required defaultValue={props.item.role}>{roles.map(x=><option key={x}>{x}</option>)}</Field><Field label="Status" name="status" defaultValue={props.item.status}><option>Active</option><option>Inactive</option></Field></div><div className="form-actions"><button type="button" onClick={props.onClose}>Close</button>{!props.own&&<button className="primary">Save user</button>}<a className="button-link" href="/api/auth/logout">Sign out</a></div></form></Modal>;
}
function ReviewForm(props:{item:AnyRow;onClose:()=>void;onSave:(d:AnyRow)=>void}) {
  return <Modal title="Review report" onClose={props.onClose}><form onSubmit={e=>{e.preventDefault();props.onSave(Object.assign({},formValues(e.currentTarget),{id:props.item.id}))}}><p><strong>{props.item.outletName}</strong> · Week {props.item.week} · Current status: {props.item.status}</p><Field label="Decision" name="status" required><option value="">Select decision</option>{["Under Review","Approved","Returned for Correction","Rejected","Completed"].map(x=><option key={x}>{x}</option>)}</Field><Field label="Review Comment" name="comment" type="textarea" required/><div className="form-actions"><button type="button" onClick={props.onClose}>Cancel</button><button className="primary">Save review</button></div></form></Modal>;
}
function ReportView(props:{data:Snapshot;item:AnyRow;onClose:()=>void}) {
  const photos=props.data.photos.filter(p=>p.reportId===props.item.id);
  const reviews=props.data.reviews.filter(r=>r.reportId===props.item.id);
  return <Modal title={"Report · "+props.item.outletName} onClose={props.onClose} wide><div className="detail-grid">{Object.entries(props.item).filter(x=>x[0]!=="id"&&x[0]!=="deletedAt").map(([key,value])=><div key={key}><span>{key.replace(/([A-Z])/g," $1")}</span><strong>{String(value??"—")}</strong></div>)}</div><h3>Evidence</h3><div className="evidence-grid">{photos.length?photos.map(p=><a href={"/api/evidence?id="+p.id} target="_blank" key={p.id}><img src={"/api/evidence?id="+p.id} alt={p.fileName}/><span>{p.fileName}</span></a>):<p>No evidence uploaded.</p>}</div><h3>Review history</h3>{reviews.length?reviews.map(r=><p key={r.id}>{r.previousStatus} → <strong>{r.newStatus}</strong> · {r.comment} · {new Date(r.reviewedAt).toLocaleString()}</p>):<p>No review history.</p>}<div className="form-actions"><button onClick={props.onClose}>Close</button></div></Modal>;
}
