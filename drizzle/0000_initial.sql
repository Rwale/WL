CREATE TABLE IF NOT EXISTS "users" ("id" serial PRIMARY KEY NOT NULL,"auth_user_id" text NOT NULL,"email" text NOT NULL,"password_hash" text DEFAULT '' NOT NULL,"name" text NOT NULL,"role" text DEFAULT 'Field Executive' NOT NULL,"phone" text DEFAULT '' NOT NULL,"status" text DEFAULT 'Active' NOT NULL,"created_at" timestamp with time zone DEFAULT now() NOT NULL,"updated_at" timestamp with time zone DEFAULT now() NOT NULL,CONSTRAINT "users_auth_user_id_unique" UNIQUE("auth_user_id"),CONSTRAINT "users_email_unique" UNIQUE("email"));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "activations" ("id" serial PRIMARY KEY NOT NULL,"campaign_name" text NOT NULL,"client" text NOT NULL,"brand" text NOT NULL,"start_date" text NOT NULL,"end_date" text NOT NULL,"locations" text DEFAULT '' NOT NULL,"states" text DEFAULT '' NOT NULL,"sales_target" double precision DEFAULT 0 NOT NULL,"sampling_target" integer DEFAULT 0 NOT NULL,"status" text DEFAULT 'Planned' NOT NULL,"reporting_frequency" text DEFAULT 'Weekly' NOT NULL,"description" text DEFAULT '' NOT NULL,"created_by" integer NOT NULL,"created_at" timestamp with time zone DEFAULT now() NOT NULL,"updated_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outlets" ("id" serial PRIMARY KEY NOT NULL,"activation_id" integer NOT NULL,"name" text NOT NULL,"outlet_type" text NOT NULL,"location" text NOT NULL,"state" text NOT NULL,"region" text NOT NULL,"sales_target" double precision DEFAULT 0 NOT NULL,"sampling_target" integer DEFAULT 0 NOT NULL,"status" text DEFAULT 'Active' NOT NULL);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "templates" ("id" serial PRIMARY KEY NOT NULL,"name" text NOT NULL,"activation_type" text NOT NULL,"fields_json" text NOT NULL,"status" text DEFAULT 'Active' NOT NULL,"created_by" integer NOT NULL,"created_at" timestamp with time zone DEFAULT now() NOT NULL,"updated_at" timestamp with time zone DEFAULT now() NOT NULL,CONSTRAINT "templates_name_unique" UNIQUE("name"));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "field_reports" ("id" serial PRIMARY KEY NOT NULL,"activation_id" integer NOT NULL,"template_id" integer,"outlet_id" integer,"brand" text NOT NULL,"week" integer NOT NULL,"activation_date" text NOT NULL,"outlet_name" text NOT NULL,"outlet_type" text NOT NULL,"location" text NOT NULL,"state" text NOT NULL,"region" text NOT NULL,"field_executive" text NOT NULL,"supervisor" text DEFAULT '' NOT NULL,"sales_target" double precision DEFAULT 0 NOT NULL,"actual_sales" double precision DEFAULT 0 NOT NULL,"sampling_target" integer DEFAULT 0 NOT NULL,"actual_sampled" integer DEFAULT 0 NOT NULL,"consumers_engaged" integer DEFAULT 0 NOT NULL,"opening_stock" integer DEFAULT 0 NOT NULL,"closing_stock" integer DEFAULT 0 NOT NULL,"bottles_sold" integer DEFAULT 0 NOT NULL,"cases_sold" double precision DEFAULT 0 NOT NULL,"consumer_feedback" text DEFAULT '' NOT NULL,"key_observations" text DEFAULT '' NOT NULL,"challenges" text DEFAULT '' NOT NULL,"competitor_activities" text DEFAULT '' NOT NULL,"recommendations" text DEFAULT '' NOT NULL,"corrective_action" text DEFAULT '' NOT NULL,"general_comments" text DEFAULT '' NOT NULL,"status" text DEFAULT 'Draft' NOT NULL,"submitted_by" integer NOT NULL,"submitted_at" timestamp with time zone,"source_workbook_id" integer,"created_at" timestamp with time zone DEFAULT now() NOT NULL,"updated_at" timestamp with time zone DEFAULT now() NOT NULL,"deleted_at" timestamp with time zone);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "report_photos" ("id" serial PRIMARY KEY NOT NULL,"report_id" integer NOT NULL,"object_key" text NOT NULL,"file_name" text NOT NULL,"content_type" text NOT NULL,"size_bytes" integer NOT NULL,"uploaded_by" integer NOT NULL,"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,CONSTRAINT "report_photos_object_key_unique" UNIQUE("object_key"));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "review_history" ("id" serial PRIMARY KEY NOT NULL,"report_id" integer NOT NULL,"reviewer_id" integer NOT NULL,"previous_status" text NOT NULL,"new_status" text NOT NULL,"comment" text DEFAULT '' NOT NULL,"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" ("id" serial PRIMARY KEY NOT NULL,"user_id" integer NOT NULL,"action" text NOT NULL,"entity_type" text NOT NULL,"entity_id" integer NOT NULL,"detail" text DEFAULT '' NOT NULL,"created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings" ("id" serial PRIMARY KEY NOT NULL,"key" text NOT NULL,"value" text NOT NULL,"updated_by" integer NOT NULL,"updated_at" timestamp with time zone DEFAULT now() NOT NULL,CONSTRAINT "settings_key_unique" UNIQUE("key"));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workbook_templates" ("id" serial PRIMARY KEY NOT NULL,"name" text NOT NULL,"file_name" text NOT NULL,"object_key" text NOT NULL,"content_type" text NOT NULL,"size_bytes" integer NOT NULL,"uploaded_by" integer NOT NULL,"is_active" boolean DEFAULT false NOT NULL,"activation_id" integer,"imported_rows" integer DEFAULT 0 NOT NULL,"last_imported_at" timestamp with time zone,"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,CONSTRAINT "workbook_templates_object_key_unique" UNIQUE("object_key"));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_outlets_activation" ON "outlets" USING btree ("activation_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_outlet_activation_name" ON "outlets" USING btree ("activation_id","name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_field_reports_activation_week" ON "field_reports" USING btree ("activation_id","week");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_field_reports_status" ON "field_reports" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_field_reports_outlet_date" ON "field_reports" USING btree ("outlet_name","activation_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_field_reports_source_workbook" ON "field_reports" USING btree ("source_workbook_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_photos_report" ON "report_photos" USING btree ("report_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_reviews_report" ON "review_history" USING btree ("report_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_entity" ON "audit_log" USING btree ("entity_type","entity_id");
