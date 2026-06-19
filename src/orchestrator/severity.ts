import Groq from "groq-sdk";

export type Severity = "LOW" | "MEDIUM" | "HIGH";

export interface DelegationConfig {
    approvalsRequired: number;
    scope: string;
    autoResolve: boolean;
}

const SEVERITY_PROMPT = `
You are a site reliability triage agent. Evaluate the given incident logs and classify their severity.
Follow these rules:
- Classify as HIGH if there is a major system outage, payment failure, core database connection failure, or customer-facing downtime.
- Classify as MEDIUM if there is performance degradation, resource exhaustion warnings (e.g. database pool exhaustion, memory threshold), or minor API errors.
- Classify as LOW if it's a routine notice, warning log, CPU warning under threshold, or non-critical diagnostic message.

Your response MUST be a JSON object containing precisely this format:
{
  "severity": "LOW" | "MEDIUM" | "HIGH",
  "reason": "Brief justification for this classification"
}
Do NOT include markdown markup. Return only the JSON.
`;

export function getSeverityConfig(sev: Severity): DelegationConfig {
    switch (sev) {
        case "LOW":
            return { approvalsRequired: 0, scope: "repo:read", autoResolve: true };
        case "MEDIUM":
            return { approvalsRequired: 1, scope: "repo:write", autoResolve: false };
        case "HIGH":
            return { approvalsRequired: 2, scope: "repo:write,merge", autoResolve: false };
    }
}

export async function classifySeverity(logs: string[]): Promise<Severity> {
    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey || apiKey.startsWith("gsk_mock") || apiKey === "") {
        console.log("[Severity Classifier] Warning: No GROQ_API_KEY. Defaulting classification to MEDIUM (P2).");
        return "MEDIUM";
    }

    try {
        console.log("[Severity Classifier] Classifying log severity via Groq...");
        const groq = new Groq({ apiKey });

        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: SEVERITY_PROMPT },
                { role: "user", content: `Incident logs:\n${logs.join("\n")}` }
            ],
            model: "llama-3.3-70b-versatile",
            response_format: { type: "json_object" }
        });

        const content = chatCompletion.choices[0]?.message?.content;
        if (!content) throw new Error("Empty response");

        const parsed = JSON.parse(content);
        const severity = parsed.severity as Severity;
        console.log(`[Severity Classifier] Logs classified as ${severity} - Reason: ${parsed.reason}`);
        return severity;
    } catch (e: any) {
        console.error(`[Severity Classifier] Error Triaging: ${e.message}. Defaulting to MEDIUM.`);
        return "MEDIUM";
    }
}
