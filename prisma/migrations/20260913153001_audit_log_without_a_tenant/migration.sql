-- An install-wide act belongs to no organization.
--
-- Granting somebody the install-wide ADMIN role is the highest-privilege act in
-- the product, and `identity.updateRole` is not scoped to a tenant. A required
-- `organizationId` meant that act could either be recorded under an invented
-- organization or not recorded at all.
ALTER TABLE "audit_logs" ALTER COLUMN "organizationId" DROP NOT NULL;
