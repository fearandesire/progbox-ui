/** CalVer build id: YYYYMMDDHHmmss */
export const BUILD_ID_PATTERN = /^\d{14}$/;

export function isValidBuildId(build: string): boolean {
  return BUILD_ID_PATTERN.test(build);
}
