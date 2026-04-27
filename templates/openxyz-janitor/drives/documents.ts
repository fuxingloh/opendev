import { GitHubDrive } from "@openxyz-provider/github/drive";
import { readEnv } from "openxyz/env";

export default new GitHubDrive({
  owner: "openxyz-app",
  repo: "documents",
  branch: "main",
  permission: "read-write",
  token: readEnv("DOCUMENTS_TOKEN", {
    description: "GitHub installation token for the documents repo (minted from the openxyz-app GitHub App)",
  }),
});
