import { GitHubDrive } from "@openxyz-provider/github/drive";
import { env } from "openxyz/env";

export default new GitHubDrive({
  owner: "openxyz-app",
  repo: "documents",
  branch: "main",
  permission: "read-write",
  token: env.DOCUMENTS_TOKEN.describe(
    "GitHub installation token for the documents repo (minted from the openxyz-app GitHub App)",
  ),
});
