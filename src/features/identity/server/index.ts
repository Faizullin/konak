import "server-only";

/**
 * Server surface for the identity feature. Guarded: importing this from a
 * client bundle is a build error, not a runtime surprise.
 */
export { userRouter } from "./router";
