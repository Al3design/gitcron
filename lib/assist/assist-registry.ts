import { createContributionRegistry } from './view-contributions';

/** El registro único de la app: cada vista publica acá su selección y sus acciones. */
export const assistContributions = createContributionRegistry();
