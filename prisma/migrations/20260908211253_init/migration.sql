-- CreateTable
CREATE TABLE "lock_devices" (
    "id" SERIAL NOT NULL,
    "propertyId" INTEGER NOT NULL,
    "roomId" INTEGER,
    "vendor" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "label" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OFFLINE',
    "batteryPct" INTEGER,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lock_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_credentials" (
    "id" SERIAL NOT NULL,
    "propertyId" INTEGER NOT NULL,
    "lockDeviceId" INTEGER,
    "reservationId" INTEGER,
    "roomStayId" INTEGER,
    "personId" INTEGER,
    "type" TEXT NOT NULL DEFAULT 'PIN',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "secretHash" TEXT,
    "externalRef" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "issuedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "access_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_access_tokens" (
    "id" SERIAL NOT NULL,
    "propertyId" INTEGER NOT NULL,
    "reservationId" INTEGER NOT NULL,
    "personId" INTEGER,
    "tokenHash" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'BOOKING_VIEW',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guest_access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "folios" (
    "id" SERIAL NOT NULL,
    "propertyId" INTEGER NOT NULL,
    "reservationId" INTEGER,
    "companyId" INTEGER,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "currencyCode" TEXT NOT NULL,
    "closedTotalMinor" INTEGER,
    "closedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "folios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "folio_lines" (
    "id" SERIAL NOT NULL,
    "folioId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "roomStayId" INTEGER,
    "serviceDate" TIMESTAMP(3),
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPriceMinor" INTEGER NOT NULL,
    "taxRateBp" INTEGER NOT NULL DEFAULT 0,
    "taxAmountMinor" INTEGER NOT NULL DEFAULT 0,
    "amountMinor" INTEGER NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,

    CONSTRAINT "folio_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" SERIAL NOT NULL,
    "propertyId" INTEGER NOT NULL,
    "folioId" INTEGER,
    "reservationId" INTEGER,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "amountMinor" INTEGER NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "externalRef" TEXT,
    "idempotencyKey" TEXT,
    "capturedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_connections" (
    "id" SERIAL NOT NULL,
    "propertyId" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "channelCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PAUSED',
    "externalPropertyId" TEXT,
    "credentialsRef" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "channel_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_mappings" (
    "id" SERIAL NOT NULL,
    "connectionId" INTEGER NOT NULL,
    "roomTypeId" INTEGER NOT NULL,
    "ratePlanId" INTEGER,
    "externalRoomTypeId" TEXT NOT NULL,
    "externalRatePlanId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_sync_state" (
    "id" SERIAL NOT NULL,
    "connectionId" INTEGER NOT NULL,
    "roomTypeId" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "pushedAvailability" INTEGER,
    "pushedPriceMinor" INTEGER,
    "pushedRestrictionsJson" TEXT,
    "pushedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,

    CONSTRAINT "channel_sync_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_receipts" (
    "id" SERIAL NOT NULL,
    "propertyId" INTEGER NOT NULL,
    "paymentId" INTEGER,
    "folioId" INTEGER,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'SALE',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "number" TEXT,
    "fiscalSign" TEXT,
    "registeredAt" TIMESTAMP(3),
    "requestJson" TEXT NOT NULL,
    "responseJson" TEXT,
    "lastError" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "fiscal_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_documents" (
    "id" SERIAL NOT NULL,
    "personId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "numberEncrypted" TEXT NOT NULL,
    "numberLast4" TEXT,
    "issuingCountry" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "attachmentId" INTEGER,
    "purgeAfter" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "identity_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_registrations" (
    "id" SERIAL NOT NULL,
    "propertyId" INTEGER NOT NULL,
    "reservationGuestId" INTEGER,
    "personId" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "referenceNumber" TEXT,
    "submittedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "requestJson" TEXT,
    "responseJson" TEXT,
    "lastError" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "guest_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "notes" TEXT,
    "customFields" TEXT,
    "addressId" INTEGER,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "taxId" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "notes" TEXT,
    "customFields" TEXT,
    "addressId" INTEGER,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person_companies" (
    "id" SERIAL NOT NULL,
    "personId" INTEGER NOT NULL,
    "companyId" INTEGER NOT NULL,
    "jobTitle" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "person_companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" SERIAL NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "countryCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "housekeeping_tasks" (
    "id" SERIAL NOT NULL,
    "propertyId" INTEGER NOT NULL,
    "roomId" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'DEPARTURE_CLEAN',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "assignedMemberId" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "clientEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "housekeeping_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_issues" (
    "id" SERIAL NOT NULL,
    "propertyId" INTEGER NOT NULL,
    "roomId" INTEGER,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "reportedByMemberId" INTEGER,
    "assignedMemberId" INTEGER,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "idToken" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_types" (
    "id" SERIAL NOT NULL,
    "propertyId" INTEGER NOT NULL,
    "publicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "baseOccupancy" INTEGER NOT NULL DEFAULT 2,
    "maxOccupancy" INTEGER NOT NULL DEFAULT 2,
    "maxAdults" INTEGER NOT NULL DEFAULT 2,
    "maxChildren" INTEGER NOT NULL DEFAULT 0,
    "sizeSqm" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "room_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" SERIAL NOT NULL,
    "propertyId" INTEGER NOT NULL,
    "roomTypeId" INTEGER NOT NULL,
    "number" TEXT NOT NULL,
    "floor" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CLEAN',
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_type_inventory" (
    "id" SERIAL NOT NULL,
    "roomTypeId" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "totalRooms" INTEGER NOT NULL,
    "blockedRooms" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_type_inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_holds" (
    "id" SERIAL NOT NULL,
    "roomTypeId" INTEGER NOT NULL,
    "checkIn" TIMESTAMP(3) NOT NULL,
    "checkOut" TIMESTAMP(3) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "holdKey" TEXT NOT NULL,
    "releaseAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT,
    "dueAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "ownerUserId" TEXT,
    "clientEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "personId" INTEGER,
    "companyId" INTEGER,
    "propertyId" INTEGER,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "colour" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_tags" (
    "id" SERIAL NOT NULL,
    "tagId" INTEGER NOT NULL,
    "personId" INTEGER,
    "companyId" INTEGER,
    "propertyId" INTEGER,

    CONSTRAINT "entity_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'FILE',
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "signedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "personId" INTEGER,
    "companyId" INTEGER,
    "propertyId" INTEGER,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_field_definitions" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "entityType" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL,
    "options" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_field_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "summary" TEXT,
    "diffJson" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currencies" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT,
    "minorUnits" INTEGER NOT NULL DEFAULT 2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" SERIAL NOT NULL,
    "baseCode" TEXT NOT NULL,
    "quoteCode" TEXT NOT NULL,
    "rateMicro" BIGINT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_tasks" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER,
    "type" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "number_series" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "propertyId" INTEGER,
    "kind" TEXT NOT NULL,
    "prefix" TEXT NOT NULL DEFAULT '',
    "resetPolicy" TEXT NOT NULL DEFAULT 'YEARLY',
    "period" TEXT,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "padding" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "number_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "properties" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "checkInMinutes" INTEGER NOT NULL DEFAULT 840,
    "checkOutMinutes" INTEGER NOT NULL DEFAULT 660,
    "addressId" INTEGER,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_plans" (
    "id" SERIAL NOT NULL,
    "propertyId" INTEGER NOT NULL,
    "roomTypeId" INTEGER,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "mealPlan" TEXT NOT NULL DEFAULT 'ROOM_ONLY',
    "isRefundable" BOOLEAN NOT NULL DEFAULT true,
    "cancellationCutoffHours" INTEGER,
    "cancellationPolicy" TEXT,
    "extraAdultMinor" INTEGER NOT NULL DEFAULT 0,
    "extraChildMinor" INTEGER NOT NULL DEFAULT 0,
    "defaultMinLengthOfStay" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "rate_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_calendar" (
    "id" SERIAL NOT NULL,
    "ratePlanId" INTEGER NOT NULL,
    "roomTypeId" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_calendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_restrictions" (
    "id" SERIAL NOT NULL,
    "ratePlanId" INTEGER NOT NULL,
    "roomTypeId" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "minLengthOfStay" INTEGER,
    "maxLengthOfStay" INTEGER,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "closedToArrival" BOOLEAN NOT NULL DEFAULT false,
    "closedToDeparture" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_restrictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" SERIAL NOT NULL,
    "propertyId" INTEGER NOT NULL,
    "publicId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ENQUIRY',
    "source" TEXT NOT NULL DEFAULT 'DIRECT',
    "channelCode" TEXT,
    "externalRef" TEXT,
    "bookerPersonId" INTEGER,
    "companyId" INTEGER,
    "currencyCode" TEXT NOT NULL,
    "totalMinor" INTEGER NOT NULL DEFAULT 0,
    "paidMinor" INTEGER NOT NULL DEFAULT 0,
    "bookedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_stays" (
    "id" SERIAL NOT NULL,
    "reservationId" INTEGER NOT NULL,
    "roomTypeId" INTEGER NOT NULL,
    "roomId" INTEGER,
    "ratePlanId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ENQUIRY',
    "checkIn" TIMESTAMP(3) NOT NULL,
    "checkOut" TIMESTAMP(3) NOT NULL,
    "adults" INTEGER NOT NULL DEFAULT 1,
    "children" INTEGER NOT NULL DEFAULT 0,
    "currencyCode" TEXT NOT NULL,
    "totalMinor" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_stays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservation_guests" (
    "id" SERIAL NOT NULL,
    "reservationId" INTEGER NOT NULL,
    "personId" INTEGER NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "registeredAt" TIMESTAMP(3),

    CONSTRAINT "reservation_guests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lock_devices_propertyId_status_idx" ON "lock_devices"("propertyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "lock_devices_propertyId_vendor_externalId_key" ON "lock_devices"("propertyId", "vendor", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "access_credentials_idempotencyKey_key" ON "access_credentials"("idempotencyKey");

-- CreateIndex
CREATE INDEX "access_credentials_propertyId_status_idx" ON "access_credentials"("propertyId", "status");

-- CreateIndex
CREATE INDEX "access_credentials_validUntil_idx" ON "access_credentials"("validUntil");

-- CreateIndex
CREATE INDEX "access_credentials_reservationId_idx" ON "access_credentials"("reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "guest_access_tokens_tokenHash_key" ON "guest_access_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "guest_access_tokens_reservationId_idx" ON "guest_access_tokens"("reservationId");

-- CreateIndex
CREATE INDEX "guest_access_tokens_expiresAt_idx" ON "guest_access_tokens"("expiresAt");

-- CreateIndex
CREATE INDEX "folios_propertyId_status_idx" ON "folios"("propertyId", "status");

-- CreateIndex
CREATE INDEX "folios_reservationId_idx" ON "folios"("reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "folios_propertyId_number_key" ON "folios"("propertyId", "number");

-- CreateIndex
CREATE INDEX "folio_lines_folioId_postedAt_idx" ON "folio_lines"("folioId", "postedAt");

-- CreateIndex
CREATE INDEX "folio_lines_roomStayId_idx" ON "folio_lines"("roomStayId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotencyKey_key" ON "payments"("idempotencyKey");

-- CreateIndex
CREATE INDEX "payments_propertyId_status_idx" ON "payments"("propertyId", "status");

-- CreateIndex
CREATE INDEX "payments_folioId_idx" ON "payments"("folioId");

-- CreateIndex
CREATE INDEX "channel_connections_status_lastSyncedAt_idx" ON "channel_connections"("status", "lastSyncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "channel_connections_propertyId_channelCode_key" ON "channel_connections"("propertyId", "channelCode");

-- CreateIndex
CREATE INDEX "channel_mappings_roomTypeId_idx" ON "channel_mappings"("roomTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_mappings_connectionId_roomTypeId_ratePlanId_key" ON "channel_mappings"("connectionId", "roomTypeId", "ratePlanId");

-- CreateIndex
CREATE INDEX "channel_sync_state_connectionId_date_idx" ON "channel_sync_state"("connectionId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "channel_sync_state_connectionId_roomTypeId_date_key" ON "channel_sync_state"("connectionId", "roomTypeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_receipts_idempotencyKey_key" ON "fiscal_receipts"("idempotencyKey");

-- CreateIndex
CREATE INDEX "fiscal_receipts_propertyId_status_idx" ON "fiscal_receipts"("propertyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_receipts_propertyId_provider_number_key" ON "fiscal_receipts"("propertyId", "provider", "number");

-- CreateIndex
CREATE INDEX "identity_documents_personId_idx" ON "identity_documents"("personId");

-- CreateIndex
CREATE INDEX "identity_documents_purgeAfter_idx" ON "identity_documents"("purgeAfter");

-- CreateIndex
CREATE UNIQUE INDEX "guest_registrations_idempotencyKey_key" ON "guest_registrations"("idempotencyKey");

-- CreateIndex
CREATE INDEX "guest_registrations_propertyId_status_idx" ON "guest_registrations"("propertyId", "status");

-- CreateIndex
CREATE INDEX "guest_registrations_personId_idx" ON "guest_registrations"("personId");

-- CreateIndex
CREATE INDEX "people_organizationId_archivedAt_idx" ON "people"("organizationId", "archivedAt");

-- CreateIndex
CREATE INDEX "people_organizationId_lastName_idx" ON "people"("organizationId", "lastName");

-- CreateIndex
CREATE UNIQUE INDEX "people_organizationId_email_key" ON "people"("organizationId", "email");

-- CreateIndex
CREATE INDEX "companies_organizationId_archivedAt_idx" ON "companies"("organizationId", "archivedAt");

-- CreateIndex
CREATE INDEX "companies_organizationId_name_idx" ON "companies"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "companies_organizationId_taxId_key" ON "companies"("organizationId", "taxId");

-- CreateIndex
CREATE INDEX "person_companies_companyId_idx" ON "person_companies"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "person_companies_personId_companyId_key" ON "person_companies"("personId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "housekeeping_tasks_clientEventId_key" ON "housekeeping_tasks"("clientEventId");

-- CreateIndex
CREATE INDEX "housekeeping_tasks_propertyId_dueDate_status_idx" ON "housekeeping_tasks"("propertyId", "dueDate", "status");

-- CreateIndex
CREATE INDEX "housekeeping_tasks_assignedMemberId_status_idx" ON "housekeeping_tasks"("assignedMemberId", "status");

-- CreateIndex
CREATE INDEX "housekeeping_tasks_roomId_dueDate_idx" ON "housekeeping_tasks"("roomId", "dueDate");

-- CreateIndex
CREATE INDEX "maintenance_issues_propertyId_status_severity_idx" ON "maintenance_issues"("propertyId", "status", "severity");

-- CreateIndex
CREATE INDEX "maintenance_issues_roomId_status_idx" ON "maintenance_issues"("roomId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "accounts_userId_idx" ON "accounts"("userId");

-- CreateIndex
CREATE INDEX "verifications_identifier_idx" ON "verifications"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "room_types_publicId_key" ON "room_types"("publicId");

-- CreateIndex
CREATE INDEX "room_types_propertyId_archivedAt_idx" ON "room_types"("propertyId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "room_types_propertyId_code_key" ON "room_types"("propertyId", "code");

-- CreateIndex
CREATE INDEX "rooms_propertyId_roomTypeId_idx" ON "rooms"("propertyId", "roomTypeId");

-- CreateIndex
CREATE INDEX "rooms_propertyId_status_idx" ON "rooms"("propertyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_propertyId_number_key" ON "rooms"("propertyId", "number");

-- CreateIndex
CREATE INDEX "room_type_inventory_date_idx" ON "room_type_inventory"("date");

-- CreateIndex
CREATE UNIQUE INDEX "room_type_inventory_roomTypeId_date_key" ON "room_type_inventory"("roomTypeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_holds_holdKey_key" ON "inventory_holds"("holdKey");

-- CreateIndex
CREATE INDEX "inventory_holds_roomTypeId_checkIn_checkOut_idx" ON "inventory_holds"("roomTypeId", "checkIn", "checkOut");

-- CreateIndex
CREATE INDEX "inventory_holds_releaseAt_idx" ON "inventory_holds"("releaseAt");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "organizations_ownerId_idx" ON "organizations"("ownerId");

-- CreateIndex
CREATE INDEX "organizations_slug_idx" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "organization_members_organizationId_idx" ON "organization_members"("organizationId");

-- CreateIndex
CREATE INDEX "organization_members_userId_idx" ON "organization_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organizationId_userId_key" ON "organization_members"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "activities_clientEventId_key" ON "activities"("clientEventId");

-- CreateIndex
CREATE INDEX "activities_organizationId_createdAt_idx" ON "activities"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "activities_personId_createdAt_idx" ON "activities"("personId", "createdAt");

-- CreateIndex
CREATE INDEX "activities_companyId_createdAt_idx" ON "activities"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "activities_ownerUserId_doneAt_idx" ON "activities"("ownerUserId", "doneAt");

-- CreateIndex
CREATE UNIQUE INDEX "tags_organizationId_name_key" ON "tags"("organizationId", "name");

-- CreateIndex
CREATE INDEX "entity_tags_personId_idx" ON "entity_tags"("personId");

-- CreateIndex
CREATE INDEX "entity_tags_companyId_idx" ON "entity_tags"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "entity_tags_tagId_personId_key" ON "entity_tags"("tagId", "personId");

-- CreateIndex
CREATE UNIQUE INDEX "entity_tags_tagId_companyId_key" ON "entity_tags"("tagId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "entity_tags_tagId_propertyId_key" ON "entity_tags"("tagId", "propertyId");

-- CreateIndex
CREATE INDEX "attachments_organizationId_kind_idx" ON "attachments"("organizationId", "kind");

-- CreateIndex
CREATE INDEX "attachments_personId_idx" ON "attachments"("personId");

-- CreateIndex
CREATE INDEX "attachments_expiresAt_idx" ON "attachments"("expiresAt");

-- CreateIndex
CREATE INDEX "custom_field_definitions_organizationId_entityType_position_idx" ON "custom_field_definitions"("organizationId", "entityType", "position");

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_definitions_organizationId_entityType_key_key" ON "custom_field_definitions"("organizationId", "entityType", "key");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_createdAt_idx" ON "audit_logs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_createdAt_idx" ON "audit_logs"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "exchange_rates_baseCode_quoteCode_asOf_idx" ON "exchange_rates"("baseCode", "quoteCode", "asOf");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rates_baseCode_quoteCode_asOf_key" ON "exchange_rates"("baseCode", "quoteCode", "asOf");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_tasks_idempotencyKey_key" ON "outbox_tasks"("idempotencyKey");

-- CreateIndex
CREATE INDEX "outbox_tasks_status_availableAt_idx" ON "outbox_tasks"("status", "availableAt");

-- CreateIndex
CREATE INDEX "outbox_tasks_organizationId_type_idx" ON "outbox_tasks"("organizationId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "number_series_organizationId_propertyId_kind_key" ON "number_series"("organizationId", "propertyId", "kind");

-- CreateIndex
CREATE INDEX "properties_organizationId_archivedAt_idx" ON "properties"("organizationId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "properties_organizationId_slug_key" ON "properties"("organizationId", "slug");

-- CreateIndex
CREATE INDEX "rate_plans_propertyId_archivedAt_idx" ON "rate_plans"("propertyId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "rate_plans_propertyId_code_key" ON "rate_plans"("propertyId", "code");

-- CreateIndex
CREATE INDEX "rate_calendar_roomTypeId_date_idx" ON "rate_calendar"("roomTypeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "rate_calendar_ratePlanId_roomTypeId_date_key" ON "rate_calendar"("ratePlanId", "roomTypeId", "date");

-- CreateIndex
CREATE INDEX "rate_restrictions_roomTypeId_date_idx" ON "rate_restrictions"("roomTypeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "rate_restrictions_ratePlanId_roomTypeId_date_key" ON "rate_restrictions"("ratePlanId", "roomTypeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_publicId_key" ON "reservations"("publicId");

-- CreateIndex
CREATE INDEX "reservations_propertyId_status_idx" ON "reservations"("propertyId", "status");

-- CreateIndex
CREATE INDEX "reservations_propertyId_bookedAt_idx" ON "reservations"("propertyId", "bookedAt");

-- CreateIndex
CREATE INDEX "reservations_bookerPersonId_idx" ON "reservations"("bookerPersonId");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_propertyId_reference_key" ON "reservations"("propertyId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_propertyId_channelCode_externalRef_key" ON "reservations"("propertyId", "channelCode", "externalRef");

-- CreateIndex
CREATE INDEX "room_stays_roomTypeId_checkIn_checkOut_idx" ON "room_stays"("roomTypeId", "checkIn", "checkOut");

-- CreateIndex
CREATE INDEX "room_stays_roomId_checkIn_checkOut_idx" ON "room_stays"("roomId", "checkIn", "checkOut");

-- CreateIndex
CREATE INDEX "room_stays_reservationId_idx" ON "room_stays"("reservationId");

-- CreateIndex
CREATE INDEX "reservation_guests_personId_idx" ON "reservation_guests"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "reservation_guests_reservationId_personId_key" ON "reservation_guests"("reservationId", "personId");

-- AddForeignKey
ALTER TABLE "lock_devices" ADD CONSTRAINT "lock_devices_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lock_devices" ADD CONSTRAINT "lock_devices_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_credentials" ADD CONSTRAINT "access_credentials_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_credentials" ADD CONSTRAINT "access_credentials_lockDeviceId_fkey" FOREIGN KEY ("lockDeviceId") REFERENCES "lock_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_credentials" ADD CONSTRAINT "access_credentials_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_credentials" ADD CONSTRAINT "access_credentials_roomStayId_fkey" FOREIGN KEY ("roomStayId") REFERENCES "room_stays"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_credentials" ADD CONSTRAINT "access_credentials_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_access_tokens" ADD CONSTRAINT "guest_access_tokens_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_access_tokens" ADD CONSTRAINT "guest_access_tokens_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_access_tokens" ADD CONSTRAINT "guest_access_tokens_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folios" ADD CONSTRAINT "folios_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folios" ADD CONSTRAINT "folios_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folios" ADD CONSTRAINT "folios_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folio_lines" ADD CONSTRAINT "folio_lines_folioId_fkey" FOREIGN KEY ("folioId") REFERENCES "folios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folio_lines" ADD CONSTRAINT "folio_lines_roomStayId_fkey" FOREIGN KEY ("roomStayId") REFERENCES "room_stays"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_folioId_fkey" FOREIGN KEY ("folioId") REFERENCES "folios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_connections" ADD CONSTRAINT "channel_connections_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_mappings" ADD CONSTRAINT "channel_mappings_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "channel_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_mappings" ADD CONSTRAINT "channel_mappings_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "room_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_mappings" ADD CONSTRAINT "channel_mappings_ratePlanId_fkey" FOREIGN KEY ("ratePlanId") REFERENCES "rate_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_sync_state" ADD CONSTRAINT "channel_sync_state_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "channel_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_receipts" ADD CONSTRAINT "fiscal_receipts_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_receipts" ADD CONSTRAINT "fiscal_receipts_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_receipts" ADD CONSTRAINT "fiscal_receipts_folioId_fkey" FOREIGN KEY ("folioId") REFERENCES "folios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_documents" ADD CONSTRAINT "identity_documents_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_documents" ADD CONSTRAINT "identity_documents_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_registrations" ADD CONSTRAINT "guest_registrations_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_registrations" ADD CONSTRAINT "guest_registrations_reservationGuestId_fkey" FOREIGN KEY ("reservationGuestId") REFERENCES "reservation_guests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_registrations" ADD CONSTRAINT "guest_registrations_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people" ADD CONSTRAINT "people_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people" ADD CONSTRAINT "people_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_companies" ADD CONSTRAINT "person_companies_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_companies" ADD CONSTRAINT "person_companies_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "housekeeping_tasks" ADD CONSTRAINT "housekeeping_tasks_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "housekeeping_tasks" ADD CONSTRAINT "housekeeping_tasks_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "housekeeping_tasks" ADD CONSTRAINT "housekeeping_tasks_assignedMemberId_fkey" FOREIGN KEY ("assignedMemberId") REFERENCES "organization_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_issues" ADD CONSTRAINT "maintenance_issues_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_issues" ADD CONSTRAINT "maintenance_issues_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_issues" ADD CONSTRAINT "maintenance_issues_reportedByMemberId_fkey" FOREIGN KEY ("reportedByMemberId") REFERENCES "organization_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_issues" ADD CONSTRAINT "maintenance_issues_assignedMemberId_fkey" FOREIGN KEY ("assignedMemberId") REFERENCES "organization_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_types" ADD CONSTRAINT "room_types_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "room_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_type_inventory" ADD CONSTRAINT "room_type_inventory_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "room_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_holds" ADD CONSTRAINT "inventory_holds_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "room_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_tags" ADD CONSTRAINT "entity_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_tags" ADD CONSTRAINT "entity_tags_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_tags" ADD CONSTRAINT "entity_tags_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_tags" ADD CONSTRAINT "entity_tags_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_tasks" ADD CONSTRAINT "outbox_tasks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "number_series" ADD CONSTRAINT "number_series_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "number_series" ADD CONSTRAINT "number_series_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_plans" ADD CONSTRAINT "rate_plans_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_calendar" ADD CONSTRAINT "rate_calendar_ratePlanId_fkey" FOREIGN KEY ("ratePlanId") REFERENCES "rate_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_restrictions" ADD CONSTRAINT "rate_restrictions_ratePlanId_fkey" FOREIGN KEY ("ratePlanId") REFERENCES "rate_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_bookerPersonId_fkey" FOREIGN KEY ("bookerPersonId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_stays" ADD CONSTRAINT "room_stays_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_stays" ADD CONSTRAINT "room_stays_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "room_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_stays" ADD CONSTRAINT "room_stays_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_stays" ADD CONSTRAINT "room_stays_ratePlanId_fkey" FOREIGN KEY ("ratePlanId") REFERENCES "rate_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_guests" ADD CONSTRAINT "reservation_guests_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_guests" ADD CONSTRAINT "reservation_guests_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
