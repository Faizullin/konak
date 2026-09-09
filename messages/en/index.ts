import auth from "./auth.json";
import errors from "./errors.json";

/**
 * One namespace per file, merged here.
 *
 * Static imports rather than a directory read: the bundler can see them, the
 * types come from the JSON itself, and a client tree can be given one namespace
 * without shipping the rest.
 */
const en = { auth, errors };

export default en;
