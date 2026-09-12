import auth from "./auth.json";
import directory from "./directory.json";
import enums from "./enums.json";
import errors from "./errors.json";
import identity from "./identity.json";
import organizations from "./organizations.json";
import pages from "./pages.json";
import platform from "./platform.json";
import properties from "./properties.json";
import rates from "./rates.json";
import reservations from "./reservations.json";
import validation from "./validation.json";

/**
 * The same namespaces as `en`, in Russian.
 *
 * Its shape is not re-declared: `Messages` is `typeof en`, so English stays the
 * one source of the key type and a locale added later cannot quietly widen it.
 * That a translation is *complete* is a runtime fact, held by
 * `message-keys.test.ts`.
 */
const ru = {
  auth,
  directory,
  enums,
  errors,
  identity,
  organizations,
  pages,
  platform,
  properties,
  rates,
  reservations,
  validation,
};

export default ru;
