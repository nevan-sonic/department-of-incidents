const BASE_URL = "http://localhost:3000";

async function testPrometheus() {
    const payload = {
        receiver: "t-a-c-t",
        status: "firing",
        alerts: [
            {
                status: "firing",
                labels: {
                    alertname: "PromDatabaseConnectionPoolExhausted",
                    severity: "critical",
                    service: "auth-service"
                },
                annotations: {
                    summary: "Core database connection timeout, thread pool deadlock",
                    description: "Out of memory crash, thread pool deadlock"
                },
                startsAt: new Date().toISOString()
            }
        ]
    };

    console.log("\n--- Testing Prometheus Webhook ---");
    const res = await fetch(`${BASE_URL}/api/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    console.log("Prometheus Response Status:", res.status);
    console.log("Response Body:", await res.json());
}

async function testDatadog() {
    const payload = {
        id: "datadog-alert-999",
        event_type: "query_alert_monitor",
        alert_title: "Database pool size exhausted on api-gateway",
        body: "ERROR [pool] Connection pool exhausted (max=20, active=20)",
        alert_status: "error"
    };

    console.log("\n--- Testing Datadog Webhook ---");
    const res = await fetch(`${BASE_URL}/api/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    console.log("Datadog Response Status:", res.status);
    console.log("Response Body:", await res.json());
}

async function run() {
    await testPrometheus();
    await testDatadog();
}

run().catch(console.error);
