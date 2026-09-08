import "server-only";

/**
 * Server surface for the organizations feature. Guarded: importing this from
 * a client bundle is a build error, not a runtime surprise.
 */
export { organizationRouter } from "./router";
export {
  assertSlugAvailable,
  createOrganizationWithOwner,
  organizationBySlug,
  transferOwnership,
} from "./service";
