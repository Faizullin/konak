/**
 * The registry of features available within an organization.
 *
 * Isomorphic on purpose: defines the feature's segment, label, and icon name.
 * By keeping it as data, we can dynamically build the navigation and other
 * feature-aware UI components without hardcoding.
 */

export interface OrgFeatureDefinition {
  /** The name shown in the sidebar or UI */
  label: string;
  /** The string name of a Lucide icon */
  icon: string;
  /** The URL segment under `/dashboard/orgs/[orgSlug]/` */
  segment: string;
}

/**
 * Keys represent the distinct feature identifiers.
 * Add new features here to have them automatically appear in navigation.
 */
export const ORG_FEATURE_REGISTRY = {
  OVERVIEW: {
    label: "Overview",
    icon: "LayoutDashboard",
    segment: "", // Root of the org
  },
  MEMBERS: {
    label: "Members",
    icon: "Users",
    segment: "members",
  },
  SETTINGS: {
    label: "Settings",
    icon: "Settings",
    segment: "settings",
  },
} satisfies Record<string, OrgFeatureDefinition>;

export type OrgFeature = keyof typeof ORG_FEATURE_REGISTRY;

export function orgFeatureDefinition(feature: OrgFeature): OrgFeatureDefinition {
  return ORG_FEATURE_REGISTRY[feature];
}
