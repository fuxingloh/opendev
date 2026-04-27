import { GitHubDrive } from "@openxyz-provider/github/drive";
import { readEnv } from "openxyz/env";

export default new GitHubDrive({
  owner: readEnv("DOCUMENTS_OWNER", {
    description: "GitHub owner (user or org) of the documents repo",
  }),
  repo: readEnv("DOCUMENTS_REPO", {
    description: "Documents repo name — mounted read-write at /mnt/documents/",
  }),
  branch: "main",
  permission: "read-write",
  token: readEnv("DOCUMENTS_TOKEN", {
    description: "GitHub installation token for the documents repo (minted from the openxyz-app GitHub App)",
  }),
});
