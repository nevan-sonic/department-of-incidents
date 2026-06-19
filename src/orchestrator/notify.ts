import { execSync } from "child_process";

export async function notifySlack(message: string): Promise<void> {
    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    
    console.log(`[Slack Notification] Dispatching: "${message}"`);
    
    if (!webhookUrl || !webhookUrl.startsWith("http")) {
        console.log("[Slack Notification] Info: SLACK_WEBHOOK_URL is not set. Skipping remote post.");
        return;
    }

    try {
        // Run curl command locally to POST message to Slack
        // Using curl to avoid loading another http library and keep code clean
        const payload = JSON.stringify({ text: message });
        const escapedPayload = payload.replace(/"/g, '\\"');
        
        // Gated by allowed execute
        execSync(`curl -X POST -H "Content-type: application/json" --data "${escapedPayload}" ${webhookUrl}`);
        console.log("[Slack Notification] Remote POST delivered successfully.");
    } catch (e: any) {
        console.error(`[Slack Notification] Remote delivery failed: ${e.message}`);
    }
}
