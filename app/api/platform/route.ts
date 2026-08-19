import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { activations, auditLog, fieldReports, outlets, reportPhotos, reviewHistory, settings, templates, users, workbookTemplates } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";

const elevated = new Set(["Administrator", "Head of Operations", "Manager"]);
const reviewers = new Set(["Administrator", "Head of Operations", "Manager", "Supervisor"]);
const n = (value: unknown) => Math.max(0, Number(value) || 0);
const s = (value: unknown) => String(value ?? "").trim();
const now = () => new Date().toISOString();

async function context() {
  const auth = await getChatGPTUser();
  if (!auth) return null;
  const db = getDb();
  let [profile] = await db.select().from(users).where(eq(users.authUserId, auth.userId)).limit(1);
  if (!profile) {
    const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(users);
    [profile] = await db.insert(users).values({ authUserId: auth.userId, email: auth.email, name: auth.fullName ?? auth.email.split("@")[0], role: Number(total) === 0 ? "Administrator" : "Field Executive" }).returning();
  } else if (profile.email !== auth.email || (auth.fullName && profile.name !== auth.fullName)) {
    [profile] = await db.update(users).set({ email: auth.email, name: auth.fullName ?? profile.name, updatedAt: now() }).where(eq(users.id, profile.id)).returning();
  }
  return { db, auth, profile };
}

function denied() { return Response.json({ error: "You do not have permission for this action." }, { status: 403 }); }
function bad(error: string, status = 400) { return Response.json({ error }, { status }); }

export async function GET() {
  const ctx = await context();
  if (!ctx) return bad("Sign in required", 401);
  const { db, profile } = ctx;
  const [allUsers, allActivations, allOutlets, allTemplates, allWorkbookTemplates, allReports, allPhotos, allReviews, allSettings] = await Promise.all([
    db.select().from(users).orderBy(users.name), db.select().from(activations).orderBy(desc(activations.createdAt)), db.select().from(outlets).orderBy(outlets.name),
    db.select().from(templates).orderBy(templates.name), db.select().from(workbookTemplates).orderBy(desc(workbookTemplates.uploadedAt)), db.select().from(fieldReports).where(isNull(fieldReports.deletedAt)).orderBy(desc(fieldReports.createdAt)),
    db.select().from(reportPhotos).orderBy(desc(reportPhotos.uploadedAt)), db.select().from(reviewHistory).orderBy(desc(reviewHistory.reviewedAt)), db.select().from(settings),
  ]);
  const visibleReports = profile.role === "Field Executive" ? allReports.filter(r => r.submittedBy === profile.id) : allReports;
  return Response.json({ profile, permissions: { canManage: elevated.has(profile.role), canReview: reviewers.has(profile.role), canExport: true }, users: allUsers, activations: allActivations, outlets: allOutlets, templates: allTemplates, workbookTemplates: allWorkbookTemplates, reports: visibleReports, photos: allPhotos, reviews: allReviews, settings: Object.fromEntries(allSettings.map(x => [x.key, x.value])) });
}

export async function POST(request: Request) {
  const ctx = await context();
  if (!ctx) return bad("Sign in required", 401);
  const { db, profile } = ctx;
  const body = await request.json() as Record<string, unknown>;
  const action = s(body.action);
  const data = (body.data ?? {}) as Record<string, unknown>;
  try {
    if (action === "createActivation" || action === "updateActivation") {
      if (!elevated.has(profile.role)) return denied();
      if (!s(data.campaignName) || !s(data.client) || !s(data.brand) || !s(data.startDate) || !s(data.endDate)) return bad("Campaign, client, brand, start date and end date are required.");
      if (s(data.endDate) < s(data.startDate)) return bad("End date cannot be before the start date.");
      const values = { campaignName:s(data.campaignName), client:s(data.client), brand:s(data.brand), startDate:s(data.startDate), endDate:s(data.endDate), locations:s(data.locations), states:s(data.states), salesTarget:n(data.salesTarget), samplingTarget:n(data.samplingTarget), status:s(data.status)||"Planned", reportingFrequency:s(data.reportingFrequency)||"Weekly", description:s(data.description), updatedAt:now() };
      const [row] = action === "createActivation" ? await db.insert(activations).values({ ...values, createdBy:profile.id }).returning() : await db.update(activations).set(values).where(eq(activations.id,n(data.id))).returning();
      await db.insert(auditLog).values({ userId:profile.id, action:action === "createActivation"?"CREATE":"UPDATE", entityType:"activation", entityId:row.id });
      return Response.json({ item:row });
    }
    if (action === "createOutlet" || action === "updateOutlet") {
      if (!elevated.has(profile.role)) return denied();
      if (!n(data.activationId) || !s(data.name) || !s(data.outletType) || !s(data.location) || !s(data.state) || !s(data.region)) return bad("Activation, outlet, type, location, state and region are required.");
      const values={activationId:n(data.activationId),name:s(data.name),outletType:s(data.outletType),location:s(data.location),state:s(data.state),region:s(data.region),salesTarget:n(data.salesTarget),samplingTarget:n(data.samplingTarget),status:s(data.status)||"Active"};
      const [row]=action==="createOutlet"?await db.insert(outlets).values(values).returning():await db.update(outlets).set(values).where(eq(outlets.id,n(data.id))).returning();
      await db.insert(auditLog).values({userId:profile.id,action:action==="createOutlet"?"CREATE":"UPDATE",entityType:"outlet",entityId:row.id}); return Response.json({item:row});
    }
    if (action === "createTemplate" || action === "updateTemplate") {
      if (!elevated.has(profile.role)) return denied();
      if (!s(data.name) || !s(data.activationType)) return bad("Template name and activation type are required.");
      if(action==="createTemplate"&&(await db.select({id:templates.id}).from(templates).where(eq(templates.name,s(data.name))).limit(1)).length)return bad("A form template with this name already exists. Open the existing template to edit it.",409);
      const fields=Array.isArray(data.fields)?data.fields:[]; const values={name:s(data.name),activationType:s(data.activationType),fieldsJson:JSON.stringify(fields),status:s(data.status)||"Active",updatedAt:now()};
      const [row]=action==="createTemplate"?await db.insert(templates).values({...values,createdBy:profile.id}).returning():await db.update(templates).set(values).where(eq(templates.id,n(data.id))).returning(); return Response.json({item:row});
    }
    if (action === "saveUser") {
      if (profile.role !== "Administrator") return denied();
      const id=n(data.id); if(!id)return bad("Select a team member.");
      const [row]=await db.update(users).set({name:s(data.name),role:s(data.role),phone:s(data.phone),status:s(data.status)||"Active",updatedAt:now()}).where(eq(users.id,id)).returning();
      await db.insert(auditLog).values({userId:profile.id,action:"UPDATE",entityType:"user",entityId:id,detail:`Role: ${row.role}`}); return Response.json({item:row});
    }
    if (action === "saveSettings") {
      if (profile.role !== "Administrator") return denied();
      for (const [key,value] of Object.entries(data)) await db.insert(settings).values({key,value:s(value),updatedBy:profile.id}).onConflictDoUpdate({target:settings.key,set:{value:s(value),updatedBy:profile.id,updatedAt:now()}});
      return Response.json({ok:true});
    }
    if (action === "createReport" || action === "updateReport") {
      const activationId=n(data.activationId); const activation=await db.select().from(activations).where(eq(activations.id,activationId)).limit(1);
      if(!activation[0])return bad("Select a valid activation."); if(!s(data.activationDate)||s(data.activationDate)<activation[0].startDate||s(data.activationDate)>activation[0].endDate)return bad("Report date must fall within the activation dates.");
      if(!s(data.outletName)||!s(data.location)||!s(data.state)||!s(data.region))return bad("Outlet, location, state and region are required.");
      if([data.salesTarget,data.actualSales,data.samplingTarget,data.actualSampled,data.consumersEngaged,data.openingStock,data.closingStock,data.bottlesSold,data.casesSold].some(v=>Number(v)<0))return bad("Targets and results cannot be negative.");
      const duplicate=await db.select({id:fieldReports.id}).from(fieldReports).where(and(eq(fieldReports.activationId,activationId),eq(fieldReports.week,n(data.week)),eq(fieldReports.activationDate,s(data.activationDate)),eq(fieldReports.outletName,s(data.outletName)),isNull(fieldReports.deletedAt),action==="updateReport"?ne(fieldReports.id,n(data.id)):sql`1=1`)).limit(1);
      if(duplicate.length&&!data.overrideDuplicate)return Response.json({error:"A report already exists for this campaign, week, date and outlet.",duplicate:true},{status:409});
      const requestedStatus=s(data.status)||"Draft"; const status=requestedStatus==="Submitted"?"Submitted":"Draft"; const values={activationId,templateId:n(data.templateId)||null,outletId:n(data.outletId)||null,brand:activation[0].brand,week:n(data.week),activationDate:s(data.activationDate),outletName:s(data.outletName),outletType:s(data.outletType),location:s(data.location),state:s(data.state),region:s(data.region),fieldExecutive:s(data.fieldExecutive)||profile.name,supervisor:s(data.supervisor),salesTarget:n(data.salesTarget),actualSales:n(data.actualSales),samplingTarget:n(data.samplingTarget),actualSampled:n(data.actualSampled),consumersEngaged:n(data.consumersEngaged),openingStock:n(data.openingStock),closingStock:n(data.closingStock),bottlesSold:n(data.bottlesSold),casesSold:n(data.casesSold),consumerFeedback:s(data.consumerFeedback),keyObservations:s(data.keyObservations),challenges:s(data.challenges),competitorActivities:s(data.competitorActivities),recommendations:s(data.recommendations),correctiveAction:s(data.correctiveAction),generalComments:s(data.generalComments),status,submittedAt:status==="Submitted"?now():null,updatedAt:now()};
      let row; if(action==="createReport"){[row]=await db.insert(fieldReports).values({...values,submittedBy:profile.id}).returning()}else{const current=await db.select().from(fieldReports).where(eq(fieldReports.id,n(data.id))).limit(1);if(!current[0])return bad("Report not found.",404);if(current[0].status==="Approved"&&!elevated.has(profile.role))return denied();[row]=await db.update(fieldReports).set(values).where(eq(fieldReports.id,n(data.id))).returning()}
      await db.insert(auditLog).values({userId:profile.id,action:action==="createReport"?"CREATE":"UPDATE",entityType:"report",entityId:row.id,detail:status}); return Response.json({item:row});
    }
    if(action==="duplicateReport") { const source=(await db.select().from(fieldReports).where(eq(fieldReports.id,n(data.id))).limit(1))[0];if(!source)return bad("Report not found.",404);const {id,createdAt,updatedAt,submittedAt,deletedAt,...copy}=source;const [row]=await db.insert(fieldReports).values({...copy,status:"Draft",submittedBy:profile.id,activationDate:s(data.activationDate)||source.activationDate,week:n(data.week)||source.week}).returning();await db.insert(auditLog).values({userId:profile.id,action:"DUPLICATE",entityType:"report",entityId:row.id,detail:`From ${id}`});return Response.json({item:row}); }
    if(action==="reviewReport") { if(!reviewers.has(profile.role))return denied();const id=n(data.id);const current=(await db.select().from(fieldReports).where(eq(fieldReports.id,id)).limit(1))[0];if(!current)return bad("Report not found.",404);const allowed=["Under Review","Approved","Returned for Correction","Rejected","Completed"];const next=s(data.status);if(!allowed.includes(next))return bad("Invalid review status.");await db.update(fieldReports).set({status:next,updatedAt:now()}).where(eq(fieldReports.id,id));await db.insert(reviewHistory).values({reportId:id,reviewerId:profile.id,previousStatus:current.status,newStatus:next,comment:s(data.comment)});await db.insert(auditLog).values({userId:profile.id,action:"STATUS_CHANGE",entityType:"report",entityId:id,detail:`${current.status} -> ${next}`});return Response.json({ok:true}); }
    if(action==="deleteReport") { const id=n(data.id);const current=(await db.select().from(fieldReports).where(eq(fieldReports.id,id)).limit(1))[0];if(!current)return bad("Report not found.",404);if(current.submittedBy!==profile.id&&!elevated.has(profile.role))return denied();await db.update(fieldReports).set({deletedAt:now(),updatedAt:now()}).where(eq(fieldReports.id,id));await db.insert(auditLog).values({userId:profile.id,action:"DELETE",entityType:"report",entityId:id});return Response.json({ok:true}); }
    return bad("Unknown action.");
  } catch (error) { return bad(error instanceof Error ? error.message : "Unexpected server error", 500); }
}
