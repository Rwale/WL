import * as XLSX from "xlsx";
import { desc, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../db";
import { activations, fieldReports, users, workbookTemplates } from "../../../db/schema";
import { readReportBlob } from "../../blob-storage";
import { getChatGPTUser } from "../../chatgpt-auth";

const pct=(a:number,b:number)=>b?a/b:0;
const sum=(rows:typeof fieldReports.$inferSelect[],key:keyof typeof fieldReports.$inferSelect)=>rows.reduce((total,row)=>total+Number(row[key]??0),0);
const sheet=(rows:unknown[][],widths:number[])=>{const ws=XLSX.utils.aoa_to_sheet(rows);ws["!cols"]=widths.map(w=>({wch:w}));if(ws["!ref"])ws["!autofilter"]={ref:ws["!ref"]};return ws};
const replaceSheet=(wb:XLSX.WorkBook,ws:XLSX.WorkSheet,name:string)=>{const index=wb.SheetNames.indexOf(name);if(index>=0)wb.SheetNames.splice(index,1);delete wb.Sheets[name];XLSX.utils.book_append_sheet(wb,ws,name)};
export async function GET(request:Request){
  const auth=await getChatGPTUser();if(!auth)return new Response("Sign in required",{status:401});const db=getDb();const [profile]=await db.select().from(users).where(eq(users.authUserId,auth.userId)).limit(1);if(!profile)return new Response("Profile unavailable",{status:403});
  const params=new URL(request.url).searchParams;const all=await db.select().from(fieldReports).where(isNull(fieldReports.deletedAt));const reports=all.filter(r=>(!params.get("week")||r.week===Number(params.get("week")))&&(!params.get("activation")||r.activationId===Number(params.get("activation")))&&(!params.get("location")||r.location===params.get("location"))&&(!params.get("status")||r.status===params.get("status"))&&(profile.role!=="Field Executive"||r.submittedBy===profile.id));
  const acts=await db.select().from(activations);const actual=sum(reports,"actualSales"),target=sum(reports,"salesTarget"),sampled=sum(reports,"actualSampled"),sampleTarget=sum(reports,"samplingTarget");
  const details=reports.map(r=>[r.week,r.activationDate,acts.find(a=>a.id===r.activationId)?.campaignName??"",r.brand,r.outletName,r.outletType,r.location,r.state,r.region,r.fieldExecutive,r.supervisor,r.salesTarget,r.actualSales,pct(r.actualSales,r.salesTarget),r.samplingTarget,r.actualSampled,pct(r.actualSampled,r.samplingTarget),r.consumersEngaged,r.openingStock,r.closingStock,r.bottlesSold,r.casesSold,r.status,r.consumerFeedback,r.keyObservations,r.challenges,r.competitorActivities,r.recommendations,r.correctiveAction,r.generalComments]);
  const group=(key:(r:typeof fieldReports.$inferSelect)=>string|number)=>Object.values(reports.reduce<Record<string,typeof reports>>((a,r)=>{const k=String(key(r));(a[k]??=[]).push(r);return a},{})).map(rows=>{const t=sum(rows,"salesTarget"),a=sum(rows,"actualSales"),st=sum(rows,"samplingTarget"),sa=sum(rows,"actualSampled");return[key(rows[0]),t,a,pct(a,t),st,sa,pct(sa,st),sum(rows,"consumersEngaged"),new Set(rows.map(r=>r.outletName)).size]});
  const [activeTemplate]=await db.select().from(workbookTemplates).where(eq(workbookTemplates.isActive,true)).orderBy(desc(workbookTemplates.uploadedAt)).limit(1);
  let wb:XLSX.WorkBook=XLSX.utils.book_new();
  if(activeTemplate){const object=await readReportBlob(activeTemplate.objectKey);if(object)wb=XLSX.read(await object.arrayBuffer(),{type:"array",cellStyles:true,cellFormula:true,cellNF:true,cellText:true})}
  replaceSheet(wb,sheet([["REPORTFLOW DASHBOARD SUMMARY"],["Metric","Value"],["Reports",reports.length],["Sales Target",target],["Actual Sales",actual],["Sales Achievement",pct(actual,target)],["Sampling Target",sampleTarget],["Actual Sampled",sampled],["Sampling Achievement",pct(sampled,sampleTarget)],["Consumers Engaged",sum(reports,"consumersEngaged")],["Outlets",new Set(reports.map(r=>r.outletName)).size]],[28,18]),"ReportFlow Summary");
  const gh=["Group","Sales Target","Actual Sales","Sales %","Sampling Target","Actual Sampled","Sampling %","Consumers","Outlets"];
  replaceSheet(wb,sheet([gh,...group(r=>`Week ${r.week}`)],[18,14,14,12,16,16,12,14,10]),"Weekly Report");replaceSheet(wb,sheet([gh,...group(()=>"Cumulative")],[18,14,14,12,16,16,12,14,10]),"Cumulative Report");
  replaceSheet(wb,sheet([["Week","Date","Campaign","Brand","Outlet","Outlet Type","Location","State","Region","Field Executive","Supervisor","Sales Target","Actual Sales","Sales %","Sampling Target","Actual Sampled","Sampling %","Consumers Engaged","Opening Stock","Closing Stock","Bottles Sold","Cases Sold","Status","Consumer Feedback","Key Observations","Challenges","Competitor Activities","Recommendations","Corrective Action","General Comments"],...details],Array(30).fill(18)),"Detailed Reports");
  replaceSheet(wb,sheet([gh,...group(r=>r.outletName)],[24,14,14,12,16,16,12,14,10]),"Outlet Analysis");replaceSheet(wb,sheet([gh,...group(r=>r.location)],[22,14,14,12,16,16,12,14,10]),"Location Analysis");replaceSheet(wb,sheet([gh,...group(r=>r.fieldExecutive)],[24,14,14,12,16,16,12,14,10]),"Team Performance");
  const bytes=XLSX.write(wb,{type:"array",bookType:"xlsx",cellStyles:true}) as ArrayBuffer;const base=(activeTemplate?.fileName||"ReportFlow").replace(/\.xlsx$/i,"").replace(/["\r\n]/g,"_");return new Response(bytes,{headers:{"content-type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","content-disposition":`attachment; filename="${base}-Generated-${new Date().toISOString().slice(0,10)}.xlsx"`}});
}
