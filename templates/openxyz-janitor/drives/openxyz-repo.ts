import { GitHubDrive } from "@openxyz-provider/github/drive";
import { readEnv } from "openxyz/env";

export default new GitHubDrive({
  owner: "fuxingloh",
  repo: "openxyz",
  branch: "main",
  permission: "read-only",
  // Public repo — token optional, only needed to raise the unauth rate limit.
  // Reuse the installation token from the documents drive when present.
  token: readEnv("DOCUMENTS_TOKEN", {
    description: "GitHub installation token for the documents repo (minted from the openxyz-app GitHub App)",
  }),
});
