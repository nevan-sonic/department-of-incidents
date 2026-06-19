import { T3Session, ApprovalResult } from "../sdk-wrapper/t3-agent";
import { agent } from "./agent-core";
import { mergePR } from "./github";

export interface MergeResult {
    status: string;
    sha: string;
}

export async function executeMerge(
    session: T3Session,
    approvalResult: ApprovalResult,
    branchName: string,
    prUrl: string
): Promise<MergeResult> {
    console.log(`[Incident Guard] Securely executing merge for PR: ${prUrl} using delegation credential...`);
    
    // T3 injects the approver's GitHub token inside TEE
    // agent code only sees the structured result
    const mergeResult = await agent.executeUnder({
        session,
        delegateDID: approvalResult.approverDID,
        credential: approvalResult.credential,
        action: async (secureContext) => {
            // Retrieve token inside enclave (just logging confirmation in simulator)
            const token = secureContext.getSecret("github_token");
            if (!token) {
                console.log("[T3 Enclave] Warning: No github_token found in T3 Secrets Vault. Using default.");
            } else {
                console.log("[T3 Enclave] github_token successfully injected into execution context.");
            }
            return mergePR(branchName, secureContext);
        },
    });
    
    await agent.audit.write({
        action: "MERGE_EXECUTED",
        actor: approvalResult.approverDID,
        prUrl,
        mergeCommit: mergeResult.sha,
    });
    
    return mergeResult as MergeResult;
}
