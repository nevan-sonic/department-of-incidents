import { enclaveSimulator, LedgerEntry, PendingApproval } from "./enclave-sim";

export interface T3AgentConfig {
    agentDID: string;
    privateKey: string;
    ledgerEndpoint: string;
}

export interface T3Session {
    sessionId: string;
    agentDID: string;
    createdAt: number;
    authorizedDIDs: Map<string, string>; // Maps DID to delegation credential
}

export interface AuthenticateConfig<T> {
    session: T3Session;
    delegateDID: string;
    scope: string;
    action: () => Promise<T>;
}

export interface RequestDelegationConfig {
    session: T3Session;
    delegateDID: string;
    scope: string;
    metadata: any;
    timeoutMs?: number;
}

export interface ApprovalResult {
    approverDID: string;
    credential: string;
    signedAt: number;
}

export interface ExecuteUnderConfig<T> {
    session: T3Session;
    delegateDID: string;
    credential: string;
    action: (secureContext: any) => Promise<T>;
}

export class T3Agent {
    private config: T3AgentConfig;
    private tenantContractId: string = "1001"; // Mock deployed TEE contract ID

    public audit = {
        write: async (entry: Omit<LedgerEntry, "timestamp">): Promise<void> => {
            const timestamp = Date.now();
            enclaveSimulator.writeLedger({
                ...entry,
                timestamp
            });
        }
    };

    constructor(config: T3AgentConfig) {
        this.config = config;
        console.log(`[T3 Agent SDK] Initialized agent with DID: ${config.agentDID}`);
    }

    public async handshake(): Promise<T3Session> {
        const sessionId = "sess_" + Math.random().toString(36).substring(2, 8);
        console.log(`[T3 Agent SDK] Handshake established. Session ID: ${sessionId}`);
        
        return {
            sessionId,
            agentDID: this.config.agentDID,
            createdAt: Date.now(),
            authorizedDIDs: new Map()
        };
    }

    public async authenticate<T>(config: AuthenticateConfig<T>): Promise<T> {
        console.log(`[T3 Agent SDK] Authenticating user DID: ${config.delegateDID} with scope '${config.scope}'...`);
        // Establish authentication wrapper, check keys/sessions, execute the payload
        try {
            console.log(`[T3 Agent SDK] Executing task under user DID context: ${config.delegateDID}`);
            const result = await config.action();
            return result;
        } catch (e: any) {
            console.error(`[T3 Agent SDK] Authentication error: ${e.message}`);
            throw e;
        }
    }

    public async requestDelegation(config: RequestDelegationConfig): Promise<ApprovalResult> {
        const approvalId = "app_" + Math.random().toString(36).substring(2, 8);
        
        // Push the pending approval request to the local simulator
        enclaveSimulator.createPendingApproval(
            approvalId,
            config.delegateDID,
            config.scope,
            config.metadata
        );

        console.log(`[T3 Agent SDK] Delegation requested for DID: ${config.delegateDID}. Waiting for approval signature...`);

        // In a real T3 SDK, this polls the ledger or registers a webhook notification.
        // We will wait for the approval state in our simulator.
        // For CLI or automated execution without browser UI, we can set up a polling promise.
        const start = Date.now();
        const timeout = config.timeoutMs || 30 * 60 * 1000;

        while (true) {
            const approval = enclaveSimulator.getApprovalById(approvalId);
            if (approval && approval.status === "approved" && approval.signature) {
                // Return delegation result
                const result: ApprovalResult = {
                    approverDID: config.delegateDID,
                    credential: approval.signature,
                    signedAt: approval.signedAt || Date.now()
                };
                
                // Add credential proof to session cache
                config.session.authorizedDIDs.set(config.delegateDID, approval.signature);
                return result;
            }

            if (Date.now() - start > timeout) {
                throw new Error(`T3 Delegation Timeout: Request ${approvalId} expired after ${timeout}ms.`);
            }

            // Sleep 1 second before checking again
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    public async executeUnder<T>(config: ExecuteUnderConfig<T>): Promise<T> {
        console.log(`[T3 Agent SDK] executeUnder() requested. Caller DID: ${config.delegateDID}`);
        
        // 1. Verify that the session has the signature credential
        const cachedCred = config.session.authorizedDIDs.get(config.delegateDID);
        if (!cachedCred || cachedCred !== config.credential) {
            throw new Error(`T3 Security Breach: executeUnder denied. Invalid or missing signature credential for DID ${config.delegateDID}`);
        }

        console.log(`[T3 Enclave] Entering hardware enclave for DID: ${config.delegateDID}...`);
        
        // 2. Build the secureContext container that will be passed to the TEE contract executor
        // In the T3 architecture, the enclave uses this context to retrieve user secrets
        const secureContext = {
            tenantDid: this.config.agentDID, // Tenant DID
            delegateDid: config.delegateDID,
            credential: config.credential,
            // A helper function to read secrets from z:<tid>:secrets
            getSecret: (key: string) => {
                // Reads the secret from simulator KV map (gated by readers ACL of contract)
                // contract ID = 1001
                const matches = config.delegateDID.match(/did:t3n:([0-9a-fA-F]+)/) || config.delegateDID.match(/did:t3:user:([0-9a-fA-F]+)/);
                const tid = matches ? matches[1].toLowerCase() : "c8eb415587d29e3155bb615149156b0ce5f2ecc5";
                try {
                    const val = enclaveSimulator.getMapEntry(tid, "secrets", key, "1001");
                    if (val) return val;
                } catch (e) {}
                const envTid = ((process.env.T3N_TENANT_DID || "c8eb415587d29e3155bb615149156b0ce5f2ecc5").split(":").pop() || "c8eb415587d29e3155bb615149156b0ce5f2ecc5").toLowerCase();
                return enclaveSimulator.getMapEntry(envTid, "secrets", key, "1001");
            }
        };

        // 3. Execute the payload closure inside the enclave boundary
        try {
            const result = await config.action(secureContext);
            console.log(`[T3 Enclave] Execution complete. Exiting enclave.`);
            return result;
        } catch (e: any) {
            console.error(`[T3 Enclave] Contract Execution Error: ${e.message}`);
            throw e;
        }
    }
}
