import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../db";
import { fieldReports, users, workbookTemplates } from "../../../db/schema";
import { readReportBlob } from "../../blob-storage";
import { getChatGPTUser } from "../../chatgpt-auth";
import { updateApprovedReportInWorkbook } from "../../excel-targeted-export";

const reviewers = new Set(["Administrator", "Head of Operations", "Manager", "Supervisor"]);
const safeName = (value: string) => value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "");

export async function GET(request: Request) {
  try {
    const auth = await getChatGPTUser();
    if (!auth) return Response.json({ error: "Sign in required." }, { status: 401 });
    const db = getDb();
    const [profile] = await db.select().from(users).where(eq(users.authUserId, auth.userId)).limit(1);
    if (!profile || !reviewers.has(profile.role)) {
      return Response.json({ error: "Only a reviewer can export the master Excel workbook." }, { status: 403 });
    }

    const reportId = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(reportId) || reportId <= 0) {
      return Response.json({ error: "Select a valid report." }, { status: 400 });
    }
    const [report] = await db.select().from(fieldReports).where(and(eq(fieldReports.id, reportId), isNull(fieldReports.deletedAt))).limit(1);
    if (!report) return Response.json({ error: "Report not found." }, { status: 404 });
    if (!new Set(["Approved", "Completed"]).has(report.status)) {
      return Response.json({ error: "Approve this report before exporting it to the master Excel workbook." }, { status: 409 });
    }

    let [template] = await db.select().from(workbookTemplates).where(and(eq(workbookTemplates.isActive, true), eq(workbookTemplates.activationId, report.activationId))).orderBy(desc(workbookTemplates.uploadedAt)).limit(1);
    if (!template) {
      [template] = await db.select().from(workbookTemplates).where(eq(workbookTemplates.isActive, true)).orderBy(desc(workbookTemplates.uploadedAt)).limit(1);
    }
    if (!template) return Response.json({ error: "Upload and activate the master Excel workbook first." }, { status: 404 });

    const source = await readReportBlob(template.objectKey);
    if (!source) return Response.json({ error: "The active Excel workbook could not be read from Blob storage." }, { status: 502 });
    const output = await updateApprovedReportInWorkbook(await source.arrayBuffer(), report);
    const base = safeName(template.fileName.replace(/\.xlsx$/i, "")) || "ReportFlow";
    const outlet = safeName(report.outletName) || `Report-${report.id}`;
    const fileName = `${base}-Week-${report.week}-${outlet}-Approved.xlsx`;

    return new Response(Buffer.from(output.bytes), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "cache-control": "no-store",
        "x-reportflow-updated-range": `${output.sheetName}!${output.updatedCells.join(",")}`,
      },
    });
  } catch (cause) {
    console.error("Targeted Excel export failed", cause);
    const error = cause instanceof Error ? cause.message : "Excel export failed.";
    return Response.json({ error }, { status: 500 });
  }
}
