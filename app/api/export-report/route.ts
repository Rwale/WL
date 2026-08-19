import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "../../../db";
import { fieldReports, users, workbookTemplates } from "../../../db/schema";
import { readReportBlob } from "../../blob-storage";
import { getChatGPTUser } from "../../chatgpt-auth";
import { updateApprovedReportsInWorkbook } from "../../excel-targeted-export";

const reviewers = new Set(["Administrator", "Head of Operations", "Manager", "Supervisor"]);
const safeName = (value: string) => value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "");

export async function GET() {
  try {
    const auth = await getChatGPTUser();
    if (!auth) return Response.json({ error: "Sign in required." }, { status: 401 });
    const db = getDb();
    const [profile] = await db.select().from(users).where(eq(users.authUserId, auth.userId)).limit(1);
    if (!profile || !reviewers.has(profile.role)) {
      return Response.json({ error: "Only a reviewer can export the updated master Excel workbook." }, { status: 403 });
    }

    const [template] = await db.select().from(workbookTemplates)
      .where(eq(workbookTemplates.isActive, true))
      .orderBy(desc(workbookTemplates.uploadedAt))
      .limit(1);
    if (!template) return Response.json({ error: "Upload and activate the master Excel workbook first." }, { status: 404 });

    const reportFilter = template.activationId
      ? and(
          eq(fieldReports.activationId, template.activationId),
          inArray(fieldReports.status, ["Approved", "Completed"]),
          isNull(fieldReports.sourceWorkbookId),
          isNull(fieldReports.deletedAt),
        )
      : and(
          inArray(fieldReports.status, ["Approved", "Completed"]),
          isNull(fieldReports.sourceWorkbookId),
          isNull(fieldReports.deletedAt),
        );
    const approvedReports = await db.select().from(fieldReports)
      .where(reportFilter)
      .orderBy(asc(fieldReports.updatedAt), asc(fieldReports.id));

    // If a corrected report exists for the same outlet and week, the latest approved version wins.
    const latestByOutletWeek = new Map<string, typeof fieldReports.$inferSelect>();
    for (const report of approvedReports) {
      const key = `${report.week}|${report.outletName.trim().toLowerCase()}|${report.location.trim().toLowerCase()}`;
      latestByOutletWeek.set(key, report);
    }
    const reports = [...latestByOutletWeek.values()];
    const source = await readReportBlob(template.objectKey);
    if (!source) return Response.json({ error: "The active Excel workbook could not be read from Blob storage." }, { status: 502 });
    const output = await updateApprovedReportsInWorkbook(await source.arrayBuffer(), reports);
    const base = safeName(template.fileName.replace(/\.xlsx$/i, "")) || "ReportFlow";
    const fileName = `${base}-All-Approved-Weeks-${new Date().toISOString().slice(0, 10)}.xlsx`;
    const updatedSheets = [...new Set(output.updatedReports.map(item => item.sheetName))].join(",");

    return new Response(Buffer.from(output.bytes), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "cache-control": "no-store",
        "x-reportflow-updated-reports": String(output.updatedReports.length),
        "x-reportflow-updated-sheets": updatedSheets,
        "x-reportflow-skipped-reports": String(output.skipped.length),
      },
    });
  } catch (cause) {
    console.error("Complete Excel export failed", cause);
    const error = cause instanceof Error ? cause.message : "Excel export failed.";
    return Response.json({ error }, { status: 500 });
  }
}
