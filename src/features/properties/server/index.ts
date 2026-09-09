import "server-only";

/**
 * Server surface for the properties feature. `requirePropertyMember` is here
 * rather than in a router because other features start their procedures with
 * it — the same arrangement as `requireOrgModule`.
 */
export { propertyRouter } from "./router";
export { requirePropertyMember } from "./service";
