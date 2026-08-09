// Stamped in by ../vite.config.ts from the working tree at build time. Both are
// '' when git or the remote was unavailable, in which case nothing renders.
declare const __GIT_COMMIT__: string;
declare const __GIT_REPO_URL__: string;

export const GIT_COMMIT = typeof __GIT_COMMIT__ === 'string' ? __GIT_COMMIT__ : '';
export const GIT_COMMIT_SHORT = GIT_COMMIT.slice(0, 7);

const REPO_URL = typeof __GIT_REPO_URL__ === 'string' ? __GIT_REPO_URL__ : '';

/** Link to the exact commit this bundle was built from. */
export const GIT_COMMIT_URL = GIT_COMMIT && REPO_URL ? `${REPO_URL}/commit/${GIT_COMMIT}` : '';
