import { createAuthClient } from "better-auth/react";

// No baseURL: the client and the auth routes are same-origin, so it infers
// correctly in dev and in preview alike. An explicit baseURL here is the usual
// cause of "works locally, 404s in preview".
export const authClient = createAuthClient();

export const { useSession, signIn, signUp, signOut } = authClient;
