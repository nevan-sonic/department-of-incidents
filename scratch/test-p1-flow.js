const ethers = require("ethers");

const BASE_URL = "http://localhost:3000";
const ALICE_PRIVATE_KEY = "0x616355559f3b9880cf878749d4d8b42f5b7c9147552ce03793de353f9d3ef00d";
const wallet = new ethers.Wallet(ALICE_PRIVATE_KEY);
const ALICE_DID = `did:t3n:${wallet.address.toLowerCase().substring(2)}`;

console.log("Using Alice DID:", ALICE_DID);

async function triggerIncident() {
    const payload = {
        id: "INC-2026-0912",
        severity: "HIGH",
        service: "auth-service",
        triggeredAt: new Date().toISOString(),
        errorRate: 98.2,
        p99Latency: 28400,
        logs: [
            "ERROR [auth] Core database connection timeout",
            "FATAL [main] Failed to initialize session cache",
            "ERROR [gateway] 502 Bad Gateway on login request",
            "FATAL [auth] Out of memory crash, thread pool deadlock"
        ],
        onCallEngineerDID: ALICE_DID,
        codeOwnerDID: ALICE_DID
    };

    console.log("Triggering P1 Incident Webhook...");
    const res = await fetch(`${BASE_URL}/api/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    console.log("Response status:", res.status);
    const data = await res.json();
    console.log("Response:", data);
}

async function getApprovals() {
    const res = await fetch(`${BASE_URL}/api/approvals?_=${Date.now()}`);
    return await res.json();
}

async function approveRequest(id) {
    const message = `Verify identity for incident resolution: ${id}`;
    console.log(`Signing message for approval ID: ${id}`);
    const signature = await wallet.signMessage(message);

    const res = await fetch(`${BASE_URL}/api/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, signature })
    });
    const data = await res.json();
    console.log(`Approve status for ${id}:`, res.status, data);
}

async function checkIncidents() {
    const res = await fetch(`${BASE_URL}/api/incidents`);
    return await res.json();
}

async function run() {
    await triggerIncident();

    // Loop to poll approvals and sign them, as well as print status changes
    let lastStatus = "";
    let approvedIds = new Set();
    
    for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 2000));
        
        try {
            // Check incident status
            const incidents = await checkIncidents();
            const inc = incidents.find(x => x.id === "INC-2026-0912");
            if (inc) {
                if (inc.status !== lastStatus) {
                    lastStatus = inc.status;
                    console.log(`[INCIDENT STATUS] -> ${lastStatus}`);
                }
            }

            // Check approvals
            const approvals = await getApprovals();
            for (const app of approvals) {
                if (!approvedIds.has(app.id)) {
                    console.log(`Found pending approval: ID=${app.id}, Approver=${app.approverDID}, Scope=${app.scope}`);
                    approvedIds.add(app.id);
                    await approveRequest(app.id);
                }
            }

            if (lastStatus === "Rolled Back") {
                console.log("Rollback completed successfully!");
                break;
            }
            if (lastStatus.startsWith("Failed")) {
                console.error("Incident handling failed!");
                break;
            }
        } catch (e) {
            console.warn(`[Poll Warning] Transient error during poll: ${e.message}. Retrying...`);
        }
    }
}

run().catch(console.error);
