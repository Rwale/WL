import { boolean, doublePrecision, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const created = (name:string) => timestamp(name,{withTimezone:true,mode:"string"}).notNull().defaultNow();

export const users=pgTable("users",{
  id:serial("id").primaryKey(),authUserId:text("auth_user_id").notNull().unique(),email:text("email").notNull().unique(),passwordHash:text("password_hash").notNull().default(""),
  name:text("name").notNull(),role:text("role").notNull().default("Field Executive"),phone:text("phone").notNull().default(""),status:text("status").notNull().default("Active"),createdAt:created("created_at"),updatedAt:created("updated_at"),
});
export const activations=pgTable("activations",{
  id:serial("id").primaryKey(),campaignName:text("campaign_name").notNull(),client:text("client").notNull(),brand:text("brand").notNull(),startDate:text("start_date").notNull(),endDate:text("end_date").notNull(),locations:text("locations").notNull().default(""),states:text("states").notNull().default(""),salesTarget:doublePrecision("sales_target").notNull().default(0),samplingTarget:integer("sampling_target").notNull().default(0),status:text("status").notNull().default("Planned"),reportingFrequency:text("reporting_frequency").notNull().default("Weekly"),description:text("description").notNull().default(""),createdBy:integer("created_by").notNull(),createdAt:created("created_at"),updatedAt:created("updated_at"),
});
export const outlets=pgTable("outlets",{
  id:serial("id").primaryKey(),activationId:integer("activation_id").notNull(),name:text("name").notNull(),outletType:text("outlet_type").notNull(),location:text("location").notNull(),state:text("state").notNull(),region:text("region").notNull(),salesTarget:doublePrecision("sales_target").notNull().default(0),samplingTarget:integer("sampling_target").notNull().default(0),status:text("status").notNull().default("Active"),
},t=>[index("idx_outlets_activation").on(t.activationId),uniqueIndex("uq_outlet_activation_name").on(t.activationId,t.name)]);
export const templates=pgTable("templates",{
  id:serial("id").primaryKey(),name:text("name").notNull().unique(),activationType:text("activation_type").notNull(),fieldsJson:text("fields_json").notNull(),status:text("status").notNull().default("Active"),createdBy:integer("created_by").notNull(),createdAt:created("created_at"),updatedAt:created("updated_at"),
});
export const fieldReports=pgTable("field_reports",{
  id:serial("id").primaryKey(),activationId:integer("activation_id").notNull(),templateId:integer("template_id"),outletId:integer("outlet_id"),brand:text("brand").notNull(),week:integer("week").notNull(),activationDate:text("activation_date").notNull(),outletName:text("outlet_name").notNull(),outletType:text("outlet_type").notNull(),location:text("location").notNull(),state:text("state").notNull(),region:text("region").notNull(),fieldExecutive:text("field_executive").notNull(),supervisor:text("supervisor").notNull().default(""),salesTarget:doublePrecision("sales_target").notNull().default(0),actualSales:doublePrecision("actual_sales").notNull().default(0),samplingTarget:integer("sampling_target").notNull().default(0),actualSampled:integer("actual_sampled").notNull().default(0),consumersEngaged:integer("consumers_engaged").notNull().default(0),openingStock:integer("opening_stock").notNull().default(0),closingStock:integer("closing_stock").notNull().default(0),bottlesSold:integer("bottles_sold").notNull().default(0),casesSold:doublePrecision("cases_sold").notNull().default(0),consumerFeedback:text("consumer_feedback").notNull().default(""),keyObservations:text("key_observations").notNull().default(""),challenges:text("challenges").notNull().default(""),competitorActivities:text("competitor_activities").notNull().default(""),recommendations:text("recommendations").notNull().default(""),correctiveAction:text("corrective_action").notNull().default(""),generalComments:text("general_comments").notNull().default(""),status:text("status").notNull().default("Draft"),submittedBy:integer("submitted_by").notNull(),submittedAt:timestamp("submitted_at",{withTimezone:true,mode:"string"}),sourceWorkbookId:integer("source_workbook_id"),createdAt:created("created_at"),updatedAt:created("updated_at"),deletedAt:timestamp("deleted_at",{withTimezone:true,mode:"string"}),
},t=>[index("idx_field_reports_activation_week").on(t.activationId,t.week),index("idx_field_reports_status").on(t.status),index("idx_field_reports_outlet_date").on(t.outletName,t.activationDate),index("idx_field_reports_source_workbook").on(t.sourceWorkbookId)]);
export const reportPhotos=pgTable("report_photos",{
  id:serial("id").primaryKey(),reportId:integer("report_id").notNull(),objectKey:text("object_key").notNull().unique(),fileName:text("file_name").notNull(),contentType:text("content_type").notNull(),sizeBytes:integer("size_bytes").notNull(),uploadedBy:integer("uploaded_by").notNull(),uploadedAt:created("uploaded_at"),
},t=>[index("idx_photos_report").on(t.reportId)]);
export const reviewHistory=pgTable("review_history",{
  id:serial("id").primaryKey(),reportId:integer("report_id").notNull(),reviewerId:integer("reviewer_id").notNull(),previousStatus:text("previous_status").notNull(),newStatus:text("new_status").notNull(),comment:text("comment").notNull().default(""),reviewedAt:created("reviewed_at"),
},t=>[index("idx_reviews_report").on(t.reportId)]);
export const auditLog=pgTable("audit_log",{
  id:serial("id").primaryKey(),userId:integer("user_id").notNull(),action:text("action").notNull(),entityType:text("entity_type").notNull(),entityId:integer("entity_id").notNull(),detail:text("detail").notNull().default(""),createdAt:created("created_at"),
},t=>[index("idx_audit_entity").on(t.entityType,t.entityId)]);
export const settings=pgTable("settings",{
  id:serial("id").primaryKey(),key:text("key").notNull().unique(),value:text("value").notNull(),updatedBy:integer("updated_by").notNull(),updatedAt:created("updated_at"),
});
export const workbookTemplates=pgTable("workbook_templates",{
  id:serial("id").primaryKey(),name:text("name").notNull(),fileName:text("file_name").notNull(),objectKey:text("object_key").notNull().unique(),contentType:text("content_type").notNull(),sizeBytes:integer("size_bytes").notNull(),uploadedBy:integer("uploaded_by").notNull(),isActive:boolean("is_active").notNull().default(false),activationId:integer("activation_id"),importedRows:integer("imported_rows").notNull().default(0),lastImportedAt:timestamp("last_imported_at",{withTimezone:true,mode:"string"}),uploadedAt:created("uploaded_at"),
});
