-- CreateEnum
CREATE TYPE "TreatmentType" AS ENUM ('CLEANING', 'FILLING', 'CROWN', 'ROOT_CANAL', 'EXTRACTION', 'ORTHO', 'IMPLANT', 'WHITENING', 'DENTURE');

-- CreateEnum
CREATE TYPE "TreatmentPlanStatus" AS ENUM ('NONE', 'PROPOSED', 'INCOMPLETE', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "RecallInterval" AS ENUM ('THREE_MONTH', 'SIX_MONTH', 'TWELVE_MONTH');

-- CreateEnum
CREATE TYPE "PatientLifecycleStage" AS ENUM ('NEW', 'ESTABLISHED');

-- CreateEnum
CREATE TYPE "RecallStatus" AS ENUM ('NOT_DUE', 'DUE', 'OVERDUE_30', 'OVERDUE_90', 'OVERDUE_180_PLUS');

-- CreateEnum
CREATE TYPE "DeclineReason" AS ENUM ('COST', 'TIMING', 'SECOND_OPINION', 'UNKNOWN', 'OTHER');

-- CreateEnum
CREATE TYPE "PatientPaymentType" AS ENUM ('INSURANCE', 'SELF_PAY', 'FINANCING_ACTIVE');

-- CreateEnum
CREATE TYPE "BalanceStatus" AS ENUM ('CURRENT', 'OWING');

-- CreateEnum
CREATE TYPE "ValueTier" AS ENUM ('STANDARD', 'HIGH_VALUE');

-- CreateEnum
CREATE TYPE "RiskFlag" AS ENUM ('PERIO_RISK', 'HIGH_CARIES_RISK', 'EMERGENCY_HISTORY');

-- CreateEnum
CREATE TYPE "ReferralSourceType" AS ENUM ('GOOGLE', 'INSURANCE_DIRECTORY', 'PATIENT_REFERRAL', 'OTHER');

-- CreateEnum
CREATE TYPE "CommsChannel" AS ENUM ('SMS', 'WHATSAPP', 'EMAIL');

-- CreateEnum
CREATE TYPE "LeadConsentPurpose" AS ENUM ('OPERATIONAL', 'MARKETING');

-- AlterTable
ALTER TABLE "patients" ADD COLUMN     "balanceAgingBucket" TEXT,
ADD COLUMN     "balanceStatus" "BalanceStatus" NOT NULL DEFAULT 'CURRENT',
ADD COLUMN     "commsChannelPref" "CommsChannel",
ADD COLUMN     "crmReferralSource" "ReferralSourceType",
ADD COLUMN     "crmReferredByPatientId" TEXT,
ADD COLUMN     "declineReason" "DeclineReason",
ADD COLUMN     "declineReasonNote" TEXT,
ADD COLUMN     "languagePref" TEXT,
ADD COLUMN     "lateCancelCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lifecycleStage" "PatientLifecycleStage" NOT NULL DEFAULT 'NEW',
ADD COLUMN     "negativeExperience" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "noShowCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "paymentType" "PatientPaymentType",
ADD COLUMN     "providerId" TEXT,
ADD COLUMN     "recallInterval" "RecallInterval",
ADD COLUMN     "recallStatus" "RecallStatus" NOT NULL DEFAULT 'NOT_DUE',
ADD COLUMN     "riskFlags" "RiskFlag"[] DEFAULT ARRAY[]::"RiskFlag"[],
ADD COLUMN     "tagsUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "tagsUpdatedBy" TEXT,
ADD COLUMN     "treatmentPlanStatus" "TreatmentPlanStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "treatmentTypes" "TreatmentType"[] DEFAULT ARRAY[]::"TreatmentType"[],
ADD COLUMN     "valueTier" "ValueTier" NOT NULL DEFAULT 'STANDARD',
ADD COLUMN     "waitlistAvailable" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "backlogCampaignAt" TIMESTAMP(3),
ADD COLUMN     "backlogNoResponse" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "backlogTag" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "firstHumanReplyAt" TIMESTAMP(3),
ADD COLUMN     "firstReplyAt" TIMESTAMP(3),
ADD COLUMN     "lastInboundReplyAt" TIMESTAMP(3),
ADD COLUMN     "lastOutboundAt" TIMESTAMP(3),
ADD COLUMN     "lossReason" TEXT,
ADD COLUMN     "qualifyingIntent" TEXT,
ADD COLUMN     "slaState" TEXT DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "automation_events" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "metadata" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequence_definitions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "entityType" TEXT NOT NULL,
    "triggerEventType" TEXT NOT NULL,
    "triggerCondition" TEXT,
    "audienceRule" TEXT,
    "exclusionRule" TEXT,
    "conflictGroup" TEXT,
    "channel" TEXT NOT NULL,
    "isMarketing" BOOLEAN NOT NULL DEFAULT true,
    "owner" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sequence_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequence_touch_templates" (
    "id" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "delayDays" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "messageTemplate" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sequence_touch_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequence_enrollments" (
    "id" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "patientId" TEXT,
    "leadId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "exitReason" TEXT,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exitedAt" TIMESTAMP(3),

    CONSTRAINT "sequence_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_touches" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "touchTemplateId" TEXT NOT NULL,
    "patientId" TEXT,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "dryRun" BOOLEAN NOT NULL DEFAULT true,
    "resultDetail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduled_touches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collections_cases" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "ownerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "collections_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "assignedToId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "dueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routing_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entityType" TEXT NOT NULL DEFAULT 'LEAD',
    "mode" TEXT NOT NULL,
    "sourceMap" TEXT,
    "eligibleUserIds" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "routing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routing_state" (
    "id" TEXT NOT NULL,
    "routingRuleId" TEXT NOT NULL,
    "lastAssignedUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routing_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_stage_history" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "fromStage" TEXT,
    "toStage" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedBy" TEXT,
    "trigger" TEXT NOT NULL,
    "reason" TEXT,

    CONSTRAINT "lead_stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_sla_events" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "firedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" TEXT,

    CONSTRAINT "lead_sla_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_logs" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "channel" "CommsChannel" NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "changedBy" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_consent_logs" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "channel" "CommsChannel" NOT NULL,
    "status" TEXT NOT NULL,
    "purpose" "LeadConsentPurpose" NOT NULL,
    "source" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedByUserId" TEXT,
    "metadata" TEXT,

    CONSTRAINT "lead_consent_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalCallId" TEXT,
    "fromNumber" TEXT NOT NULL,
    "toNumber" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'INBOUND',
    "status" TEXT NOT NULL,
    "patientId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "textBackStatus" TEXT,
    "textBackSentAt" TIMESTAMP(3),
    "metadata" TEXT,

    CONSTRAINT "call_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waitlist_notifications" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "appointmentSlotId" TEXT,
    "waitlistEntryId" TEXT,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waitlist_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waitlist_entries" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "preferredDoctorId" TEXT,
    "preferredDateFrom" TIMESTAMP(3),
    "preferredDateTo" TIMESTAMP(3),
    "timePreference" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fulfilledAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waitlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_request_config" (
    "id" TEXT NOT NULL,
    "delayHours" INTEGER NOT NULL DEFAULT 24,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "gbpPlaceId" TEXT,
    "reviewLinkOverride" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "review_request_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_request_logs" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_request_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backlog_campaign_runs" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "leadCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backlog_campaign_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automation_events_entityType_entityId_idx" ON "automation_events"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "automation_events_processedAt_createdAt_idx" ON "automation_events"("processedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "sequence_definitions_key_key" ON "sequence_definitions"("key");

-- CreateIndex
CREATE INDEX "sequence_definitions_entityType_status_idx" ON "sequence_definitions"("entityType", "status");

-- CreateIndex
CREATE INDEX "sequence_definitions_triggerEventType_status_idx" ON "sequence_definitions"("triggerEventType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sequence_touch_templates_sequenceId_order_key" ON "sequence_touch_templates"("sequenceId", "order");

-- CreateIndex
CREATE INDEX "sequence_enrollments_patientId_status_idx" ON "sequence_enrollments"("patientId", "status");

-- CreateIndex
CREATE INDEX "sequence_enrollments_leadId_status_idx" ON "sequence_enrollments"("leadId", "status");

-- CreateIndex
CREATE INDEX "sequence_enrollments_sequenceId_status_idx" ON "sequence_enrollments"("sequenceId", "status");

-- CreateIndex
CREATE INDEX "scheduled_touches_status_scheduledFor_idx" ON "scheduled_touches"("status", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "collections_cases_patientId_key" ON "collections_cases"("patientId");

-- CreateIndex
CREATE INDEX "collections_cases_status_ownerId_idx" ON "collections_cases"("status", "ownerId");

-- CreateIndex
CREATE INDEX "tasks_entityType_entityId_idx" ON "tasks"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "tasks_assignedToId_status_idx" ON "tasks"("assignedToId", "status");

-- CreateIndex
CREATE INDEX "routing_rules_entityType_isActive_idx" ON "routing_rules"("entityType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "routing_state_routingRuleId_key" ON "routing_state"("routingRuleId");

-- CreateIndex
CREATE INDEX "lead_stage_history_leadId_changedAt_idx" ON "lead_stage_history"("leadId", "changedAt");

-- CreateIndex
CREATE INDEX "lead_sla_events_leadId_type_idx" ON "lead_sla_events"("leadId", "type");

-- CreateIndex
CREATE INDEX "consent_logs_patientId_channel_createdAt_idx" ON "consent_logs"("patientId", "channel", "createdAt");

-- CreateIndex
CREATE INDEX "lead_consent_logs_leadId_channel_purpose_recordedAt_idx" ON "lead_consent_logs"("leadId", "channel", "purpose", "recordedAt");

-- CreateIndex
CREATE INDEX "call_events_status_occurredAt_idx" ON "call_events"("status", "occurredAt");

-- CreateIndex
CREATE INDEX "call_events_patientId_idx" ON "call_events"("patientId");

-- CreateIndex
CREATE INDEX "waitlist_notifications_patientId_idx" ON "waitlist_notifications"("patientId");

-- CreateIndex
CREATE INDEX "waitlist_entries_serviceId_isActive_requestedAt_idx" ON "waitlist_entries"("serviceId", "isActive", "requestedAt");

-- CreateIndex
CREATE INDEX "waitlist_entries_patientId_isActive_idx" ON "waitlist_entries"("patientId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "review_request_logs_appointmentId_key" ON "review_request_logs"("appointmentId");

-- CreateIndex
CREATE INDEX "review_request_logs_status_scheduledFor_idx" ON "review_request_logs"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "patients_recallStatus_idx" ON "patients"("recallStatus");

-- CreateIndex
CREATE INDEX "patients_treatmentPlanStatus_idx" ON "patients"("treatmentPlanStatus");

-- CreateIndex
CREATE INDEX "patients_balanceStatus_idx" ON "patients"("balanceStatus");

-- CreateIndex
CREATE INDEX "patients_providerId_idx" ON "patients"("providerId");

-- CreateIndex
CREATE INDEX "leads_assignedTo_idx" ON "leads"("assignedTo");

-- CreateIndex
CREATE INDEX "leads_firstReplyAt_idx" ON "leads"("firstReplyAt");

-- CreateIndex
CREATE INDEX "leads_createdAt_idx" ON "leads"("createdAt");

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "doctors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_crmReferredByPatientId_fkey" FOREIGN KEY ("crmReferredByPatientId") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_touch_templates" ADD CONSTRAINT "sequence_touch_templates_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "sequence_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "sequence_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_touches" ADD CONSTRAINT "scheduled_touches_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "sequence_enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_touches" ADD CONSTRAINT "scheduled_touches_touchTemplateId_fkey" FOREIGN KEY ("touchTemplateId") REFERENCES "sequence_touch_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_touches" ADD CONSTRAINT "scheduled_touches_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections_cases" ADD CONSTRAINT "collections_cases_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections_cases" ADD CONSTRAINT "collections_cases_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_stage_history" ADD CONSTRAINT "lead_stage_history_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_sla_events" ADD CONSTRAINT "lead_sla_events_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_logs" ADD CONSTRAINT "consent_logs_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_consent_logs" ADD CONSTRAINT "lead_consent_logs_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_events" ADD CONSTRAINT "call_events_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_notifications" ADD CONSTRAINT "waitlist_notifications_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_notifications" ADD CONSTRAINT "waitlist_notifications_waitlistEntryId_fkey" FOREIGN KEY ("waitlistEntryId") REFERENCES "waitlist_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_preferredDoctorId_fkey" FOREIGN KEY ("preferredDoctorId") REFERENCES "doctors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_request_logs" ADD CONSTRAINT "review_request_logs_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

