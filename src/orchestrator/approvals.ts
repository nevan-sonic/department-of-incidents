import { T3Session, ApprovalResult } from "../sdk-wrapper/t3-agent";
import { agent } from "./agent-core";

export async function requestApprovals(
    session: T3Session,
    approverDIDs: string[],
    incidentId: string
): Promise<ApprovalResult[]> {
    console.log(`[Incident Guard] Routing approvals for incident ${incidentId} to: ${JSON.stringify(approverDIDs)}`);
    
    const approvalPromises = approverDIDs.map(did =>
        agent.requestDelegation({
            session,
            delegateDID: did,
            scope: "repo:merge",
            metadata: { incidentId, requestedAt: Date.now() },
            // Blocks until engineer approves in UI
            timeoutMs: 30 * 60 * 1000,
        })
    );
    
    // Wait for ALL required approvals (HIGH = both must sign)
    const results = await Promise.all(approvalPromises);
    
    // Log each approval to audit ledger
    for (const result of results) {
        await agent.audit.write({
            action: "APPROVAL_GRANTED",
            actor: result.approverDID,
            incidentId,
            credential: result.credential,
        });
    }
    
    return results;
}
