/** CalVer build id: YYYYMMDDHHmmss with valid date/time ranges */
export const BUILD_ID_PATTERN = /^(?:[12]\d{3})(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])(?:[01]\d|2[0-3])(?:[0-5]\d){2}$/;

export function isValidBuildId(build: string): boolean {
  return BUILD_ID_PATTERN.test(build);
}
