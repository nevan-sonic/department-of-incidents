import { agent } from "./agent-core";
import { revertCommit } from "./github";

export async function executeRollback(
    originalApproverDID: string,
    mergeCommitSha: string,
    incidentId: string
): Promise<void> {
    console.log(`[Incident Guard] Rollback triggered! Initiating re-authentication flow for original approver: ${originalApproverDID}`);
    
    // Fresh session — original approver must re-auth (No cached credentials are used)
    const rollbackSession = await agent.handshake();
    
    const reauth = await agent.requestDelegation({
        session: rollbackSession,
        delegateDID: originalApproverDID,
        scope: "repo:revert",
        metadata: { reason: "rollback", targetCommit: mergeCommitSha },
    });
    
    console.log("[Incident Guard] Re-authentication verified. Reverting changes inside enclave...");
    
    await agent.executeUnder({
        session: rollbackSession,
        delegateDID: reauth.approverDID,
        credential: reauth.credential,
        action: async (ctx) => revertCommit(mergeCommitSha, ctx),
    });
    
    await agent.audit.write({
        action: "ROLLBACK_EXECUTED",
        actor: originalApproverDID,
        targetCommit: mergeCommitSha,
        incidentId,
    });
    
    console.log(`[Incident Guard] Revert complete. Incident ${incidentId} rolled back successfully.`);
}
