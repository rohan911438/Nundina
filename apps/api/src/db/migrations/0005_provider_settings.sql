ALTER TABLE "providers" ADD COLUMN "default_validity_hours" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "pay_if_works" boolean DEFAULT false NOT NULL;