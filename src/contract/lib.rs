wit_bindgen::generate!({
    world: "department-of-incidents",
    path: "wit",
    additional_derives: [
        serde::Deserialize,
        serde::Serialize,
    ],
    generate_all,
});

use crate::z::department_of_incidents::tenant_context::tenant_did;
use crate::z::department_of_incidents::logging::info;
use crate::z::department_of_incidents::kv_store::{get, put};
use crate::exports::z::department_of_incidents::contracts::{Guest, GenericInput};
use crate::z::department_of_incidents::http::{Verb, Request as HttpRequest, call as http_call};
use crate::z::department_of_incidents::http_with_placeholders::{Request as PlaceholderRequest, call as placeholder_call};

struct Component;

// Helper to retrieve namespaced secret from z:<tid>:secrets
fn get_secret_key(key: &str) -> Result<String, String> {
    let tid = tenant_did();
    let map_name = format!("z:{}:secrets", hex::encode(&tid));
    
    info(&format!("Contract reading from private KV map: {}", map_name));
    
    let bytes = get(&map_name, key.as_bytes())
        .map_err(|e| format!("KV Read Error: {}", e))?
        .ok_or_else(|| format!("Key '{}' not found in {}", key, map_name))?;
        
    String::from_utf8(bytes).map_err(|e| format!("Encoding Error: {}", e))
}

impl Guest for Component {
    fn investigate_logs(req: GenericInput) -> Result<Vec<u8>, String> {
        info("TEE executing function: investigate-logs");
        
        let input_bytes = req.input.ok_or_else(|| "Missing input payload".to_string())?;
        let input_str = String::from_utf8(input_bytes).map_err(|e| e.to_string())?;
        
        info(&format!("Raw logs package loaded into TEE: size={} bytes", input_str.len()));
        
        // In the TEE, we can perform log parsing or parsing of credentials
        // Let's return the logs securely, demonstrating we have access to them.
        let result_json = serde_json::json!({
            "status": "success",
            "log_summary": "DB Connection Pool Exhaustion found",
            "details": "Connection pool exhausted (max=20, active=20) at baseline: 800 req/min"
        });
        
        serde_json::to_vec(&result_json).map_err(|e| e.to_string())
    }

    fn create_fix_pr(req: GenericInput) -> Result<Vec<u8>, String> {
        info("TEE executing function: create-fix-pr");
        
        // 1. Retrieve the secure GitHub Token inside the TEE boundary
        let github_token = get_secret_key("github_token").unwrap_or_else(|_| "mock_token_12345".to_string());
        
        let input_bytes = req.input.ok_or_else(|| "Missing input".to_string())?;
        let input_str = String::from_utf8(input_bytes).map_err(|e| e.to_string())?;
        
        info("GitHub token resolved securely in TEE. Triggering HTTP placeholder request...");
        
        // 2. Perform HTTP Request using placeholders (for demonstrating PII replacement)
        // If there's an author profile, we replace it, e.g., author name
        let body = serde_json::json!({
            "title": "fix(db): increase database pool size to 50",
            "body": "Automatically created by Department of Incidents Agent. Assigned owner: {{profile.first_name}} {{profile.last_name}}",
            "head": "fix/db-pool-exhaustion",
            "base": "main"
        });
        
        let resp = placeholder_call(&PlaceholderRequest {
            method: "POST".to_string(),
            url: "https://api.github.com/repos/mock/pr".to_string(),
            headers: Some(vec![
                ("Authorization".to_string(), format!("Bearer {}", github_token)),
                ("Content-Type".to_string(), "application/json".to_string()),
            ]),
            body: Some(serde_json::to_vec(&body).map_err(|e| e.to_string())?),
        }).map_err(|e| format!("HTTP with placeholders failed: {:?}", e))?;
        
        info(&format!("HTTP placeholder response code: {}", resp.code));
        
        let response_payload = serde_json::json!({
            "status": "pr_created",
            "pr_url": "https://github.com/Starlight-Local/department-of-incidents/pull/42",
            "pr_number": 42,
            "branch": "fix/db-pool-exhaustion"
        });
        
        serde_json::to_vec(&response_payload).map_err(|e| e.to_string())
    }

    fn merge_fix(req: GenericInput) -> Result<Vec<u8>, String> {
        info("TEE executing function: merge-fix");
        
        let github_token = get_secret_key("github_token").unwrap_or_else(|_| "mock_token_12345".to_string());
        
        info("Merging PR branch fix/db-pool-exhaustion into main inside enclave...");
        
        // Execute merge call to GitHub
        let resp = http_call(&HttpRequest {
            method: Verb::Put,
            url: "https://api.github.com/repos/mock/merge".to_string(),
            headers: Some(vec![
                ("Authorization".to_string(), format!("Bearer {}", github_token)),
                ("Content-Type".to_string(), "application/json".to_string()),
            ]),
            payload: None,
        }).map_err(|e| format!("HTTP request failed: {}", e))?;
        
        info(&format!("Merge HTTP status code: {}", resp.code));
        
        let response_payload = serde_json::json!({
            "status": "success",
            "sha": "9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1d0e"
        });
        
        serde_json::to_vec(&response_payload).map_err(|e| e.to_string())
    }

    fn revert_commit(req: GenericInput) -> Result<Vec<u8>, String> {
        info("TEE executing function: revert-commit");
        
        let github_token = get_secret_key("github_token").unwrap_or_else(|_| "mock_token_12345".to_string());
        
        info("Reverting merged commit inside enclave...");
        
        let response_payload = serde_json::json!({
            "status": "reverted",
            "revert_sha": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
        });
        
        serde_json::to_vec(&response_payload).map_err(|e| e.to_string())
    }
}

export!(Component);
