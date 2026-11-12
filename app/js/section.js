// Which section of the Cloudflare site this copy of the app is (PI, 24 October 2026). The source keeps SECTION null,
// so the app signs in with a GitHub token as before, wherever it is served from. cloudflare/build.mjs writes
// { project: '<id>', title } into each project's copy, and { project: null } into the sign-in page at the root.
export const SECTION = null;
