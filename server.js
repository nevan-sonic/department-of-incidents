const express = require("express");
const path = require("path");
const dotenv = require("dotenv");

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Disable HTTP caching for all routes
app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
    next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Initialize T3N Enclave Simulator entries on startup
// We must load this from the compiled dist folder
let enclaveSimulator;
let handleIncident;
let activeIncidents;
let readAuditLedger;

try {
    const simModule = require("./dist/sdk-wrapper/enclave-sim");
    enclaveSimulator = simModule.enclaveSimulator;
    
    const coreModule = require("./dist/orchestrator/agent-core");
    handleIncident = coreModule.handleIncident;
    activeIncidents = coreModule.activeIncidents;
    
    const auditModule = require("./dist/orchestrator/audit");
    readAuditLedger = auditModule.readAuditLedger;
    
    // Seed credentials on startup (mimics tenant control plane execution)
    const envTid = process.env.T3N_TENANT_DID ? process.env.T3N_TENANT_DID.split(":").pop() : "c8eb415587d29e3155bb615149156b0ce5f2ecc5";
    enclaveSimulator.createMap(envTid, "secrets", "private", ["1001"], ["1001"]);
    enclaveSimulator.setMapEntry(envTid, "secrets", "github_token", process.env.GITHUB_TOKEN || process.env.T3_PRIVATE_KEY || "0x616355559f3b9880cf878749d4d8b42f5b7c9147552ce03793de353f9d3ef00d");

    // Also seed for the derived address from fallback key if different
    const derivedTid = "1dc692077Cbf6d404B619c8D9b6648849c74802c".toLowerCase();
    if (envTid.toLowerCase() !== derivedTid) {
        enclaveSimulator.createMap(derivedTid, "secrets", "private", ["1001"], ["1001"]);
        enclaveSimulator.setMapEntry(derivedTid, "secrets", "github_token", process.env.GITHUB_TOKEN || process.env.T3_PRIVATE_KEY || "0x616355559f3b9880cf878749d4d8b42f5b7c9147552ce03793de353f9d3ef00d");
    }
    
    console.log("[Control Plane] Enclave simulator loaded and private z-namespace secrets seeded.");
} catch (e) {
    console.error("[Control Plane] Warning: Compiled modules not found. Run 'npm run compile' first to generate JS outputs.");
}

// REST Endpoints
// REST Endpoints
app.post("/api/webhook", async (req, res) => {
    let rawAlert = req.body;
    let alert = null;
    
    if (!rawAlert) {
        return res.status(400).json({ error: "Empty request body" });
    }

    // 1. Detect Prometheus Alertmanager Webhook Payload
    if (rawAlert.alerts && Array.isArray(rawAlert.alerts) && rawAlert.alerts.length > 0) {
        console.log("[Webhook Router] Detected Prometheus Alertmanager payload.");
        const promAlert = rawAlert.alerts[0];
        const labels = promAlert.labels || {};
        const annotations = promAlert.annotations || {};
        
        const timestampSuffix = Math.random().toString(36).substring(2, 5);
        alert = {
            id: (labels.alertname || "PROM-ALERT") + "-" + timestampSuffix.toUpperCase(),
            severity: labels.severity === "critical" || labels.severity === "page" ? "HIGH" : "MEDIUM",
            service: labels.service || labels.job || "api-gateway",
            triggeredAt: promAlert.startsAt || new Date().toISOString(),
            errorRate: labels.severity === "critical" ? 95 : 60,
            p99Latency: labels.severity === "critical" ? 25000 : 5000,
            logs: [
                annotations.summary || "Prometheus firing alert: " + (labels.alertname || ""),
                annotations.description || "Alert description not specified.",
                `Instance: ${labels.instance || "unknown"}`,
                `GeneratorURL: ${promAlert.generatorURL || "N/A"}`
            ],
            onCallEngineerDID: "did:t3n:1dc692077cbf6d404b619c8d9b6648849c74802c", // Fallback Alice address
            codeOwnerDID: "did:t3n:1dc692077cbf6d404b619c8d9b6648849c74802c"
        };
    } 
    // 2. Detect Datadog Webhook Payload
    else if (rawAlert.event_type || rawAlert.alert_type || rawAlert.alert_title) {
        console.log("[Webhook Router] Detected Datadog Webhook payload.");
        const timestampSuffix = Math.random().toString(36).substring(2, 5);
        
        let extractedService = "api-gateway";
        const title = rawAlert.alert_title || rawAlert.title || "";
        const serviceMatch = title.match(/on\s+(\S+)/) || title.match(/service:(\S+)/);
        if (serviceMatch && serviceMatch[1]) {
            extractedService = serviceMatch[1].replace(/[^\w-]/g, "");
        }
        
        const isCritical = rawAlert.alert_type === "error" || rawAlert.alert_severity === "error" || rawAlert.alert_status === "error";
        
        alert = {
            id: "DD-" + (rawAlert.id || timestampSuffix.toUpperCase()),
            severity: isCritical ? "HIGH" : "MEDIUM",
            service: extractedService,
            triggeredAt: new Date().toISOString(),
            errorRate: isCritical ? 98 : 70,
            p99Latency: isCritical ? 28000 : 12000,
            logs: [
                title,
                rawAlert.body || rawAlert.alert_msg || "Datadog monitor alert triggered.",
                `Event Type: ${rawAlert.event_type || "N/A"}`,
                `Monitor Status: ${rawAlert.alert_status || "N/A"}`
            ],
            onCallEngineerDID: "did:t3n:1dc692077cbf6d404b619c8d9b6648849c74802c",
            codeOwnerDID: "did:t3n:1dc692077cbf6d404b619c8d9b6648849c74802c"
        };
    } 
    // 3. Fallback to Standard T.A.C.T format
    else if (rawAlert.id) {
        alert = rawAlert;
    }

    if (!alert) {
        return res.status(400).json({ error: "Could not parse payload. Supported formats: Datadog Webhook, Prometheus Alertmanager, or standard T.A.C.T Alert." });
    }
    
    if (!handleIncident) {
        return res.status(500).json({ error: "Server modules not compiled. Please run npm run compile first." });
    }

    // Trigger incident handling asynchronously
    console.log(`[Webhook Router] Triggering triage for alert ${alert.id} (Service: ${alert.service}, Severity: ${alert.severity})`);
    handleIncident(alert).catch(err => {
        console.error(`[Webhook Async Error] ${err.message}`);
    });
    
    res.json({ status: "incident_triage_started", id: alert.id });
});

app.get("/api/incidents", (req, res) => {
    if (!activeIncidents) {
        return res.json([]);
    }
    const list = [];
    activeIncidents.forEach((value, key) => {
        list.push({
            id: key,
            service: value.alert.service,
            status: value.status,
            severity: value.severity,
            errorRate: value.alert.errorRate,
            p99Latency: value.alert.p99Latency,
            rootCause: value.rootCause || null,
            patch: value.patch || null,
            prUrl: value.prUrl || null,
            prNumber: value.prNumber || null,
            branch: value.branch || null,
            mergeCommit: value.mergeCommit || null,
            revertCommit: value.revertCommit || null,
            logsReadTime: value.logsReadTime || null,
            prCreatedTime: value.prCreatedTime || null,
            mergedTime: value.mergedTime || null,
            rolledBackTime: value.rolledBackTime || null
        });
    });
    res.json(list);
});

app.get("/api/ledger", (req, res) => {
    if (!readAuditLedger) {
        return res.json([]);
    }
    res.json(readAuditLedger());
});

app.get("/api/approvals", (req, res) => {
    if (!enclaveSimulator) {
        return res.json([]);
    }
    res.json(enclaveSimulator.getPendingApprovals());
});

app.post("/api/approve", (req, res) => {
    const { id, signature } = req.body;
    if (!id || !signature) {
        return res.status(400).json({ error: "Missing approval ID or signature" });
    }
    
    if (!enclaveSimulator) {
        return res.status(500).json({ error: "Simulator not loaded" });
    }
    
    try {
        const success = enclaveSimulator.approveRequest(id, signature);
        if (success) {
            res.json({ status: "approved" });
        } else {
            res.status(401).json({ error: "Invalid signature proof. Address recovery failed." });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post("/api/incidents/:id/rollback", async (req, res) => {
    const { id } = req.params;
    if (!activeIncidents) {
        return res.status(500).json({ error: "Modules not loaded" });
    }
    
    const incident = activeIncidents.get(id);
    if (!incident) {
        return res.status(404).json({ error: "Incident not found" });
    }
    
    if (!incident.mergeCommit) {
        return res.status(400).json({ error: "Incident does not have a merge commit to rollback." });
    }
    
    try {
        const { executeRollback } = require("./dist/orchestrator/rollback");
        
        console.log(`[Manual Rollback API] Initiating manual rollback for incident: ${id}`);
        // Run rollback asynchronously
        incident.status = "Rolling Back";
        executeRollback(incident.alert.codeOwnerDID, incident.mergeCommit, id)
            .then(() => {
                incident.status = "Rolled Back";
                incident.rolledBackTime = Date.now();
            })
            .catch(err => {
                console.error(`[Manual Rollback Error] ${err.message}`);
                incident.status = "Failed Rollback: " + err.message;
            });
            
        res.json({ status: "rollback_initiated", id });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Fallback HTML router
app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
    console.log(`\n============================================================`);
    console.log(`[Starlight Engine] Control Plane Dashboard running at: http://localhost:${PORT}`);
    console.log(`============================================================\n`);
});
