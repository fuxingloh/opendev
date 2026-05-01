import { GitHubDrive } from "@openxyz-provider/github/drive";
import { env } from "openxyz/env";

export default new GitHubDrive({
  owner: "openxyz-app",
  repo: "mnemonic",
  branch: "main",
  permission: "read-only",
  // Private repo — token required.
  // Reuse the installation token from the documents drive.
  token: env.DOCUMENTS_TOKEN.describe(
    "GitHub installation token for the documents repo (minted from the openxyz-app GitHub App)",
  ),
});
