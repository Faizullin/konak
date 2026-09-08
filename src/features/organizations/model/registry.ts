import { OrgRole } from "./organization";

/**
 * The modules available inside an organization.
 *
 * A module declares itself here once and the rest follows: the sidebar entry,
 * the URL segment, who may see it, and whether an organization can switch it
 * off. Isomorphic, so the nav and the route guard read the same declaration.
 */

export interface OrgModule {
  /** Shown in the sidebar. */
  label: string;
  /** A Lucide icon name; `nav-items.ts` maps it to the component. */
  icon: string;
  /** The URL segment under `/dashboard/orgs/[orgSlug]/`. Empty is the root. */
  segment: string;
  /**
   * Core modules have no off switch. An organization without its own settings
   * screen is not a product decision, it is a broken install.
   */
  core?: boolean;
  /** Organization roles that may see it at all. Absent means every member. */
  roles?: OrgRole[];
  /** Whether a new organization gets it. Ignored when `core`. */
  enabledByDefault?: boolean;
}

export const ORG_MODULE_REGISTRY = {
  OVERVIEW: {
    label: "Overview",
    icon: "LayoutDashboard",
    segment: "",
    core: true,
  },
  MEMBERS: {
    label: "Members",
    icon: "Users",
    segment: "members",
    core: true,
  },
  SETTINGS: {
    label: "Settings",
    icon: "Settings",
    segment: "settings",
    core: true,
    roles: [OrgRole.OWNER, OrgRole.ADMIN],
  },
  // The first module that can be off. Declared before its screens exist and
  // off by default, so nothing links to a route that is not there — switching
  // it on is what makes it appear.
  DIRECTORY: {
    label: "Directory",
    icon: "Contact",
    segment: "directory",
    enabledByDefault: false,
  },
} satisfies Record<string, OrgModule>;

export type OrgModuleId = keyof typeof ORG_MODULE_REGISTRY;

export const ORG_MODULE_IDS = Object.keys(ORG_MODULE_REGISTRY) as OrgModuleId[];

export function orgModule(id: OrgModuleId): OrgModule {
  return ORG_MODULE_REGISTRY[id];
}

/**
 * `satisfies` keeps each entry's literal type, which is what makes the ids
 * exact — but an optional key absent from one entry is then unreadable across
 * all of them. Widening on read costs nothing and keeps the ids.
 */
const MODULES: Record<OrgModuleId, OrgModule> = ORG_MODULE_REGISTRY;

/** An unknown id answers `null` rather than throwing — segments arrive from URLs. */
export function orgModuleForSegment(segment: string): OrgModuleId | null {
  const found = ORG_MODULE_IDS.find((id) => ORG_MODULE_REGISTRY[id].segment === segment);
  return found ?? null;
}

/** A row exists only to disagree with the default, so an empty list is not "all off". */
export type ModuleToggle = { moduleId: string; enabled: boolean };

export function isOrgModuleEnabled(id: OrgModuleId, toggles: ModuleToggle[]): boolean {
  const definition = MODULES[id];
  if (definition.core) return true;

  const toggle = toggles.find((t) => t.moduleId === id);
  return toggle ? toggle.enabled : (definition.enabledByDefault ?? false);
}

/** Enabled, and visible to this role. The two questions are separate on purpose. */
export function visibleOrgModules(role: string, toggles: ModuleToggle[]): OrgModuleId[] {
  return ORG_MODULE_IDS.filter((id) => {
    if (!isOrgModuleEnabled(id, toggles)) return false;
    const allowed = MODULES[id].roles;
    return !allowed || allowed.includes(role as OrgRole);
  });
}
