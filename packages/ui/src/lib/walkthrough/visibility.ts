/**
 * Hidden walkthrough tabs stay mounted. Starting a load/ensureAll is waste;
 * posting /api/walkthrough/cancel would throw away a generation the user is
 * paying for. Aborting the in-flight GET is enough to stop untracked git diffs.
 */
export const applyWalkthroughVisibility = (
  enabled: boolean,
  actions: {
    abortLoad: () => void;
    load: () => void;
  },
): void => {
  if (!enabled) {
    actions.abortLoad();
    return;
  }
  actions.load();
};
