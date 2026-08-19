import * as XLSX from "xlsx";
import { eq, isNull } from "drizzle-orm";
import { getDb } from "../../../db";
import { activations, fieldReports, outlets, workbookTemplates } from "../../../db/schema";

type Db = ReturnType<typeof getDb>;
type ParsedRow = {
  week:number; outletName:string; location:string; price:number; salesTarget:number; actualSales:number;
  samplingTarget:number; actualSampled:number; openingStock:number; closingStock:number; incentiveUsage:number;
};

const num=(value:unknown)=>Math.max(0,Number(value)||0);
const str=(value:unknown)=>String(value??"").trim();
const norm=(value:unknown)=>str(value).toUpperCase().replace(/[^A-Z0-9]+/g," ").trim();
const isoDate=(value:Date)=>value.toISOString().slice(0,10);
const addDays=(value:Date,days:number)=>{const copy=new Date(value);copy.setUTCDate(copy.getUTCDate()+days);return copy};
const rowKey=(week:number,outlet:string)=>`${week}|${norm(outlet)}`;
const chunks=<T,>(items:T[],size:number)=>Array.from({length:Math.ceil(items.length/size)},(_,index)=>items.slice(index*size,index*size+size));

function place(location:string){
  const key=norm(location);
  if(key.includes("LAGOS"))return{state:"Lagos",region:"South West"};
  if(key.includes("ABUJA")||key.includes("FCT"))return{state:"FCT",region:"North Central"};
  if(key.includes("PORT")&&key.includes("HARCOURT"))return{state:"Rivers",region:"South South"};
  if(key.includes("IBADAN"))return{state:"Oyo",region:"South West"};
  if(key.includes("BENIN"))return{state:"Edo",region:"South South"};
  if(key.includes("WARRI"))return{state:"Delta",region:"South South"};
  return{state:location||"Not specified",region:"Not specified"};
}

function findColumn(headers:unknown[],start:number,names:string[],fallback:number){
  for(let index=start;index<headers.length;index++){const header=norm(headers[index]);if(names.some(name=>header===name||header.includes(name)))return index}
  return fallback;
}

function parseWorkbook(bytes:ArrayBuffer){
  const workbook=XLSX.read(bytes,{type:"array",cellDates:true,cellFormula:true});
  const rows:ParsedRow[]=[];
  let brand="";
  for(const sheetName of workbook.SheetNames){
    const match=sheetName.match(/^\s*WEEK\s*(\d+)\s*$/i);if(!match)continue;
    const week=Number(match[1]);
    const matrix=XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName],{header:1,defval:null,raw:true});
    if(!brand)brand=str(matrix[0]?.[1]);
    const headerIndex=matrix.findIndex(row=>row.some(cell=>norm(cell)==="OUTLETS")&&row.some(cell=>norm(cell)==="LOCATION"));
    if(headerIndex<0)continue;
    const headers=matrix[headerIndex];
    const outletColumn=findColumn(headers,0,["OUTLETS","OUTLET"],1);
    const locationColumn=findColumn(headers,0,["LOCATION"],2);
    const priceColumn=findColumn(headers,0,["PRICE"],3);
    let cumulativeStart=(matrix[0]||[]).findIndex(cell=>norm(cell).includes("CUMMULATIVE")||norm(cell).includes("CUMULATIVE"));
    if(cumulativeStart<0)cumulativeStart=Math.max(0,headers.map(norm).lastIndexOf("OPENING STOCK"));
    const openingColumn=findColumn(headers,cumulativeStart,["OPENING STOCK"],cumulativeStart);
    const salesTargetColumn=findColumn(headers,openingColumn+1,["TARGET"],openingColumn+1);
    const actualSalesColumn=findColumn(headers,salesTargetColumn+1,["SALES"],salesTargetColumn+1);
    const closingColumn=findColumn(headers,actualSalesColumn+1,["CLOSING STOCK"],actualSalesColumn+2);
    const samplingTargetColumn=findColumn(headers,closingColumn+1,["SAMPLING OBJECTIVE","SAMPLING TARGET"],closingColumn+1);
    const actualSampledColumn=findColumn(headers,samplingTargetColumn+1,["WEEKLY SAMPLING","NO OF CONSUMER SAMPLED","SAMPLING ACHIVED","SAMPLING ACHIEVED"],samplingTargetColumn+1);
    const incentiveColumn=findColumn(headers,actualSampledColumn+1,["INCENTIVE USAGE","USAGES"],headers.length-1);
    for(const source of matrix.slice(headerIndex+1)){
      const serial=Number(source[0]);if(!Number.isFinite(serial)||serial<=0)continue;
      const location=str(source[locationColumn])||"Not specified";
      const outletName=str(source[outletColumn])||`Unspecified Outlet ${serial} - ${location}`;
      rows.push({week,outletName,location,price:num(source[priceColumn]),salesTarget:num(source[salesTargetColumn]),actualSales:num(source[actualSalesColumn]),samplingTarget:num(source[samplingTargetColumn]),actualSampled:num(source[actualSampledColumn]),openingStock:num(source[openingColumn]),closingStock:num(source[closingColumn]),incentiveUsage:num(source[incentiveColumn])});
    }
  }
  if(!rows.length)throw new Error("No weekly outlet rows were detected. The workbook needs WEEK 1, WEEK 2, etc. sheets with OUTLETS and LOCATION columns.");
  return{rows,brand:brand||"Excel Activation"};
}

export async function importWorkbookData(args:{db:Db;bytes:ArrayBuffer;template:typeof workbookTemplates.$inferSelect;userId:number;userName:string}){
  const parsed=parseWorkbook(args.bytes);const now=new Date();const maxWeek=Math.max(...parsed.rows.map(row=>row.week));const start=addDays(now,-7*(maxWeek-1));
  const campaignName=args.template.name;const locations=[...new Set(parsed.rows.map(row=>row.location))].join(", ");const salesTarget=parsed.rows.reduce((total,row)=>total+row.salesTarget,0);const samplingTarget=parsed.rows.reduce((total,row)=>total+row.samplingTarget,0);
  let [activation]=await args.db.select().from(activations).where(eq(activations.campaignName,campaignName)).limit(1);
  const activationValues={client:parsed.brand,brand:parsed.brand,startDate:isoDate(start),endDate:isoDate(now),locations,states:[...new Set(parsed.rows.map(row=>place(row.location).state))].join(", "),salesTarget,samplingTarget,status:"Active",reportingFrequency:"Weekly",description:`Imported from ${args.template.fileName}`,updatedAt:now.toISOString()};
  if(activation){[activation]=await args.db.update(activations).set(activationValues).where(eq(activations.id,activation.id)).returning()}
  else{[activation]=await args.db.insert(activations).values({...activationValues,campaignName,createdBy:args.userId}).returning()}

  const existingOutlets=await args.db.select().from(outlets).where(eq(outlets.activationId,activation.id));
  const outletMap=new Map(existingOutlets.map(outlet=>[norm(outlet.name),outlet]));
  const newOutletValues:Array<typeof outlets.$inferInsert>=[];const pendingOutlets=new Set<string>();
  for(const source of parsed.rows){
    const key=norm(source.outletName);if(outletMap.has(key)||pendingOutlets.has(key))continue;const location=place(source.location);pendingOutlets.add(key);
    newOutletValues.push({activationId:activation.id,name:source.outletName,outletType:"On-Trade",location:source.location,state:location.state,region:location.region,salesTarget:source.salesTarget,samplingTarget:source.samplingTarget,status:"Active"});
  }
  for(const group of chunks(newOutletValues,8)){const inserted=await args.db.insert(outlets).values(group).returning();for(const outlet of inserted)outletMap.set(norm(outlet.name),outlet)}

  const existingReports=await args.db.select().from(fieldReports).where(eq(fieldReports.activationId,activation.id));
  const reportMap=new Map(existingReports.filter(report=>!report.deletedAt).map(report=>[rowKey(report.week,report.outletName),report]));
  let created=0,updated=0,skipped=0;const newReportValues:Array<typeof fieldReports.$inferInsert>=[];
  for(const source of parsed.rows){
    const outlet=outletMap.get(norm(source.outletName));const location=place(source.location);const activationDate=isoDate(addDays(start,7*(source.week-1)));const current=reportMap.get(rowKey(source.week,source.outletName));
    const values={activationId:activation.id,templateId:null,outletId:outlet?.id??null,brand:parsed.brand,week:source.week,activationDate,outletName:outlet?.name??source.outletName,outletType:"On-Trade",location:source.location,state:location.state,region:location.region,fieldExecutive:`${args.userName} · Excel import`,supervisor:"",salesTarget:source.salesTarget,actualSales:source.actualSales,samplingTarget:source.samplingTarget,actualSampled:source.actualSampled,consumersEngaged:source.actualSampled,openingStock:source.openingStock,closingStock:source.closingStock,bottlesSold:source.actualSales,casesSold:0,consumerFeedback:"",keyObservations:"",challenges:"",competitorActivities:"",recommendations:"",correctiveAction:"",generalComments:`Weekly cumulative row imported from ${args.template.fileName}`,status:"Approved",submittedBy:args.userId,submittedAt:now.toISOString(),sourceWorkbookId:args.template.id,updatedAt:now.toISOString(),deletedAt:null};
    if(current&&current.sourceWorkbookId){await args.db.update(fieldReports).set(values).where(eq(fieldReports.id,current.id));updated++}
    else if(current){skipped++}
    else{newReportValues.push(values);created++}
  }
  for(const group of chunks(newReportValues,2))await args.db.insert(fieldReports).values(group);
  await args.db.update(workbookTemplates).set({activationId:activation.id,importedRows:parsed.rows.length,lastImportedAt:now.toISOString()}).where(eq(workbookTemplates.id,args.template.id));
  return{activationId:activation.id,rows:parsed.rows.length,created,updated,skipped,salesTarget,samplingTarget,brand:parsed.brand};
}
