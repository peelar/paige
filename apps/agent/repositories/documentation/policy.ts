// These limits define the bytes a user reviews and approves. Every stage keeps
// its own check, but all stages must apply the same policy values.
export const MAX_FILE_BYTES = 1_000_000;
export const MAX_DIFF_FILES = 50;

// A writeback branch must stay in Paige's namespace and be safe to pass to Git
// as a local or remote reference. Reject path tricks and unusually long names.
export function isValidPaigeBranch(value: string): boolean {
  const hasValidShape =
    /^paige\/[a-z0-9][a-z0-9._/-]*[a-z0-9]$/.test(value);
  const hasUnsafePath = value.includes("..") || value.includes("//");
  const isWithinLengthLimit = value.length <= 120;

  return (
    hasValidShape &&
    !hasUnsafePath &&
    isWithinLengthLimit
  );
}
