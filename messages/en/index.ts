import auth from "./auth.json";
import directory from "./directory.json";
import enums from "./enums.json";
import errors from "./errors.json";
import identity from "./identity.json";
import organizations from "./organizations.json";
import pages from "./pages.json";
import properties from "./properties.json";
import rates from "./rates.json";
import reservations from "./reservations.json";
import validation from "./validation.json";

/**
 * One namespace per file, merged here.
 *
 * Static imports rather than a directory read: the bundler can see them, the
 * types come from the JSON itself, and a client tree can be given one namespace
 * without shipping the rest.
 */
const en = {
  auth,
  directory,
  enums,
  errors,
  identity,
  organizations,
  pages,
  properties,
  rates,
  reservations,
  validation,
};

export default en;
