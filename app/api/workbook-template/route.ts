import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLog, users, workbookTemplates } from "../../../db/schema";
import { blobError, deleteReportBlob, putReportBlob, readReportBlob } from "../../blob-storage";
import { getChatGPTUser } from "../../chatgpt-auth";
import { importWorkbookData } from "./importer";

const managers = new Set(["Administrator", "Head of Operations", "Manager"]);
const excelType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const safeName = (value:string) => value.replace(/[^a-zA-Z0-9._-]/g, "_");
const error = (message:string, status=400) => Response.json({ error:message }, { status });
export const maxDuration=60;

async function context() {
  const auth = await getChatGPTUser();
  if (!auth) return null;
  const db = getDb();
  const [profile] = await db.select().from(users).where(eq(users.authUserId, auth.userId)).limit(1);
  return profile ? { db, profile } : null;
}

export async function POST(request:Request) {
  const ctx = await context();
  if (!ctx) return error("Sign in required", 401);
  if (!managers.has(ctx.profile.role)) return error("You do not have permission to upload a master workbook.", 403);
  if (!process.env.BLOB_READ_WRITE_TOKEN) return error("Vercel Blob storage is unavailable.", 500);
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return error("Choose an Excel .xlsx workbook.");
  if (!file.name.toLowerCase().endsWith(".xlsx")) return error("Only .xlsx Excel workbooks are supported.");
  if (file.size === 0 || file.size > 20_000_000) return error("The workbook must be smaller than 20 MB.");
  const name = String(form.get("name") || file.name.replace(/\.xlsx$/i, "")).trim();
  if (!name) return error("Enter a template name.");
  const key = `workbook-templates/${crypto.randomUUID()}-${safeName(file.name)}`;
  const bytes=await file.arrayBuffer();
  let blob;
  try {
    blob = await putReportBlob(key, bytes, excelType);
  } catch (cause) {
    return error(blobError(cause), 500);
  }
  try {
    await ctx.db.update(workbookTemplates).set({ isActive:false });
    const [item] = await ctx.db.insert(workbookTemplates).values({ name, fileName:file.name, objectKey:blob.url, contentType:excelType, sizeBytes:file.size, uploadedBy:ctx.profile.id, isActive:true }).returning();
    await ctx.db.insert(auditLog).values({ userId:ctx.profile.id, action:"UPLOAD", entityType:"workbook_template", entityId:item.id, detail:file.name });
    try{
      const imported=await importWorkbookData({db:ctx.db,bytes,template:item,userId:ctx.profile.id,userName:ctx.profile.name});
      await ctx.db.insert(auditLog).values({userId:ctx.profile.id,action:"IMPORT",entityType:"workbook_template",entityId:item.id,detail:`${imported.rows} dashboard rows`});
      return Response.json({item,imported},{status:201});
    }catch(importCause){
      return Response.json({item,warning:importCause instanceof Error?importCause.message:"Workbook saved, but its data could not be imported."},{status:201});
    }
  } catch (cause) {
    await deleteReportBlob(blob.url).catch(() => undefined);
    return error(cause instanceof Error ? cause.message : "Workbook upload failed.", 500);
  }
}

export async function PUT(request:Request){
  const ctx=await context();if(!ctx)return error("Sign in required",401);if(!managers.has(ctx.profile.role))return error("You do not have permission to import workbook data.",403);if(!process.env.BLOB_READ_WRITE_TOKEN)return error("Vercel Blob storage is unavailable.",500);
  const id=Number((await request.json() as {id?:unknown}).id);const [item]=await ctx.db.select().from(workbookTemplates).where(eq(workbookTemplates.id,id)).limit(1);if(!item)return error("Workbook template not found.",404);
  const object=await readReportBlob(item.objectKey);if(!object)return error("Stored workbook not found.",404);
  try{const imported=await importWorkbookData({db:ctx.db,bytes:await object.arrayBuffer(),template:item,userId:ctx.profile.id,userName:ctx.profile.name});await ctx.db.insert(auditLog).values({userId:ctx.profile.id,action:"IMPORT",entityType:"workbook_template",entityId:id,detail:`${imported.rows} dashboard rows`});return Response.json({item,imported})}
  catch(cause){return error(cause instanceof Error?cause.message:"Workbook data import failed.",422)}
}

export async function PATCH(request:Request) {
  const ctx = await context();
  if (!ctx) return error("Sign in required", 401);
  if (!managers.has(ctx.profile.role)) return error("You do not have permission to change the master workbook.", 403);
  const id = Number((await request.json() as { id?:unknown }).id);
  const [existing] = await ctx.db.select().from(workbookTemplates).where(eq(workbookTemplates.id,id)).limit(1);
  if (!existing) return error("Workbook template not found.", 404);
  await ctx.db.update(workbookTemplates).set({ isActive:false });
  const [item] = await ctx.db.update(workbookTemplates).set({ isActive:true }).where(eq(workbookTemplates.id,id)).returning();
  await ctx.db.insert(auditLog).values({ userId:ctx.profile.id, action:"ACTIVATE", entityType:"workbook_template", entityId:id, detail:item.fileName });
  return Response.json({ item });
}

export async function DELETE(request:Request) {
  const ctx = await context();
  if (!ctx) return error("Sign in required", 401);
  if (!managers.has(ctx.profile.role)) return error("You do not have permission to delete workbook templates.", 403);
  const id = Number(new URL(request.url).searchParams.get("id"));
  const [existing] = await ctx.db.select().from(workbookTemplates).where(eq(workbookTemplates.id,id)).limit(1);
  if (!existing) return error("Workbook template not found.", 404);
  if (process.env.BLOB_READ_WRITE_TOKEN) await deleteReportBlob(existing.objectKey);
  await ctx.db.delete(workbookTemplates).where(eq(workbookTemplates.id,id));
  if (existing.isActive) {
    const [latest] = await ctx.db.select().from(workbookTemplates).orderBy(desc(workbookTemplates.uploadedAt)).limit(1);
    if (latest) await ctx.db.update(workbookTemplates).set({ isActive:true }).where(eq(workbookTemplates.id,latest.id));
  }
  await ctx.db.insert(auditLog).values({ userId:ctx.profile.id, action:"DELETE", entityType:"workbook_template", entityId:id, detail:existing.fileName });
  return Response.json({ ok:true });
}

export async function GET(request:Request) {
  const ctx = await context();
  if (!ctx) return new Response("Sign in required", { status:401 });
  const id = Number(new URL(request.url).searchParams.get("id"));
  const [item] = await ctx.db.select().from(workbookTemplates).where(eq(workbookTemplates.id,id)).limit(1);
  if (!item) return new Response("Workbook template not found", { status:404 });
  const object = await readReportBlob(item.objectKey);
  if (!object) return new Response("Stored workbook not found", { status:404 });
  const name = item.fileName.replace(/["\r\n]/g,"_");
  return new Response(object.body, { headers:{ "content-type":item.contentType, "content-disposition":`attachment; filename="${name}"`, "cache-control":"private, no-store" } });
}
