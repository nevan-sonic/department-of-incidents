import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const workspaceDir = "c:\\Users\\Nevan\\Desktop\\Starlight";
const configFilePath = path.join(workspaceDir, "db_config.json");

// Helper to run commands in the local Git workspace
function runGitCmd(cmd: string): string {
    try {
        const output = execSync(cmd, { cwd: workspaceDir, stdio: "pipe" });
        return output.toString().trim();
    } catch (e: any) {
        console.error(`[Git Error] Command failed: ${cmd}. Error: ${e.stderr?.toString() || e.message}`);
        throw e;
    }
}

export interface PRDetails {
    status: string;
    prUrl: string;
    prNumber: number;
    branch: string;
    patch: string;
}

export function initializeLocalRepo() {
    if (!fs.existsSync(workspaceDir)) {
        fs.mkdirSync(workspaceDir, { recursive: true });
    }

    // Check if git is initialized
    const gitDir = path.join(workspaceDir, ".git");
    if (!fs.existsSync(gitDir)) {
        console.log("[Git Engine] Initializing local Git repository in workspace...");
        runGitCmd("git init");
        runGitCmd("git config user.name \"Department of Incidents Bot\"");
        runGitCmd("git config user.email \"incident-bot@terminal3.io\"");
        
        // Write initial config file
        const initialConfig = {
            service_name: "api-gateway",
            db_host: "localhost",
            db_port: 5432,
            pool_size: 20
        };
        fs.writeFileSync(configFilePath, JSON.stringify(initialConfig, null, 2));
        
        runGitCmd("git add db_config.json");
        runGitCmd("git commit -m \"initial commit: setup gateway config\"");
        runGitCmd("git branch -M main");
        console.log("[Git Engine] Initialized repository, renamed default branch to 'main', and committed db_config.json");
    } else {
        console.log("[Git Engine] Git repository already exists in workspace.");
        try {
            // Ensure the main branch exists if it was initialized as master
            runGitCmd("git branch -M main");
        } catch (e) {
            // Ignore if no commits are present yet or already main
        }
    }
}

export async function createPR(patchContent: string, secureContext: any): Promise<PRDetails> {
    console.log("[Git Engine] Creating branch and applying config fix...");
    
    // Ensure we are on main and clean
    runGitCmd("git checkout -f main");
    
    // Pull from remote main to stay aligned
    const repo = process.env.GITHUB_REPO;
    const token = process.env.GITHUB_TOKEN;
    if (repo && token && !token.startsWith("ghp_mock") && repo !== "Starlight-Local/department-of-incidents") {
        try {
            console.log("[Git Engine] Pulling latest changes from remote main...");
            runGitCmd("git pull origin main");
        } catch (e: any) {
            console.warn(`[Git Engine Warning] Failed to pull main from origin: ${e.message}. Attempting reset...`);
            try {
                runGitCmd("git fetch origin");
                runGitCmd("git reset --hard origin/main");
            } catch (e2: any) {
                console.error(`[Git Engine Error] Hard reset alignment failed: ${e2.message}`);
            }
        }
    }
    
    // Create new branch
    const branchName = "fix/db-pool-exhaustion-" + Math.random().toString(36).substring(2, 6);
    runGitCmd(`git checkout -b ${branchName}`);
    
    // Apply patch
    try {
        const patchObj = JSON.parse(patchContent);
        // Load current config
        const currentConfig = JSON.parse(fs.readFileSync(configFilePath, "utf-8"));
        
        // Merge patch keys
        const updatedConfig = { ...currentConfig, ...patchObj };
        fs.writeFileSync(configFilePath, JSON.stringify(updatedConfig, null, 2));
        console.log(`[Git Engine] Config file updated. New pool_size: ${updatedConfig.pool_size}`);
    } catch (e) {
        // Fallback if not JSON
        fs.writeFileSync(configFilePath, patchContent);
        console.log("[Git Engine] Raw patch content written directly to db_config.json");
    }

    // Commit change
    runGitCmd("git add db_config.json");
    runGitCmd(`git commit --allow-empty -m "fix(db): increase database pool size to 50"`);
    
    console.log(`[Git Engine] Changes committed locally to branch: ${branchName}`);

    // If real GitHub integration is configured in .env, push to GitHub and open a real PR
    let prUrl = `https://github.com/Starlight-Local/department-of-incidents/pulls/42`;
    let prNumber = 42;

    if (repo && token && !token.startsWith("ghp_mock") && repo !== "Starlight-Local/department-of-incidents") {
        try {
            console.log(`[GitHub Remote] Configuring origin and pushing branch '${branchName}' to GitHub...`);
            try {
                runGitCmd("git remote remove origin");
            } catch (e) {}
            runGitCmd(`git remote add origin https://x-access-token:${token}@github.com/${repo}.git`);
            
            // Push main branch first to ensure the base branch exists on the remote GitHub repo
            try {
                console.log("[GitHub Remote] Pushing base branch 'main' to GitHub...");
                runGitCmd("git push -u origin main");
            } catch (e: any) {
                console.warn(`[GitHub Remote Warning] Could not push main branch: ${e.message}`);
            }
            
            runGitCmd(`git push -u origin ${branchName}`);
            
            // Call GitHub API to create PR
            const { Octokit } = require("@octokit/rest");
            const octokit = new Octokit({ auth: token });
            const [owner, repoName] = repo.split("/");
            
            console.log(`[GitHub API] Creating Pull Request on ${repo}...`);
            const prResponse = await octokit.rest.pulls.create({
                owner,
                repo: repoName,
                title: `fix(db): increase database pool size to 50`,
                head: branchName,
                base: "main",
                body: "Automatically created by TEE-secured Department of Incidents Commander.",
            });
            
            prUrl = prResponse.data.html_url;
            prNumber = prResponse.data.number;
            console.log(`[GitHub API] Real Pull Request created: ${prUrl}`);
        } catch (e: any) {
            console.error(`[GitHub API Error] Failed to interact with GitHub remote: ${e.message}. Falling back to local git.`);
        }
    }
    
    return {
        status: "pr_created",
        prUrl,
        prNumber,
        branch: branchName,
        patch: patchContent
    };
}

export async function mergePR(branchName: string, secureContext: any): Promise<{ status: string; sha: string }> {
    console.log(`[Git Engine] Merging branch '${branchName}' into main...`);
    
    // Checkout main
    runGitCmd("git checkout main");
    
    // Merge branch
    runGitCmd(`git merge ${branchName} --no-edit`);
    
    // Get merge commit SHA
    let sha = runGitCmd("git rev-parse HEAD");
    console.log(`[Git Engine] Branch '${branchName}' merged. Merge commit SHA: ${sha}`);

    // If real GitHub is configured, merge PR on GitHub
    const repo = process.env.GITHUB_REPO;
    const token = process.env.GITHUB_TOKEN;
    if (repo && token && !token.startsWith("ghp_mock") && repo !== "Starlight-Local/department-of-incidents") {
        try {
            const { Octokit } = require("@octokit/rest");
            const octokit = new Octokit({ auth: token });
            const [owner, repoName] = repo.split("/");

            console.log(`[GitHub API] Searching for open Pull Request for branch ${branchName}...`);
            const prs = await octokit.rest.pulls.list({
                owner,
                repo: repoName,
                head: `${owner}:${branchName}`,
                state: "open",
            });

            if (prs.data.length > 0) {
                const prNum = prs.data[0].number;
                console.log(`[GitHub API] Merging Pull Request #${prNum} on GitHub...`);
                const mergeResponse = await octokit.rest.pulls.merge({
                    owner,
                    repo: repoName,
                    pull_number: prNum,
                    merge_method: "merge",
                });
                sha = mergeResponse.data.sha;
                console.log(`[GitHub API] PR #${prNum} merged on GitHub. Merge SHA: ${sha}`);
                
                // Align local main with remote main's merge commit
                console.log("[GitHub API] Fetching and resetting local main to match remote main...");
                runGitCmd("git fetch origin");
                runGitCmd("git reset --hard origin/main");
            }
        } catch (e: any) {
            console.error(`[GitHub API Error] Failed to merge PR on GitHub: ${e.message}`);
        }
    }
    
    return {
        status: "merged",
        sha
    };
}

export async function revertCommit(commitSha: string, secureContext: any): Promise<{ status: string; revertSha: string }> {
    console.log(`[Git Engine] Reverting merge commit: ${commitSha}...`);
    
    try {
        runGitCmd("git checkout main");
        runGitCmd("git pull origin main");
    } catch (e: any) {
        console.warn(`[Git Engine] Warning: Checkout or pull of main failed: ${e.message}. Proceeding.`);
    }
    
    // Run git revert (since it is a merge commit, we specify -m 1 to select main line)
    try {
        runGitCmd(`git revert -m 1 ${commitSha} --no-edit`);
    } catch (e) {
        // Fallback standard revert if not a merge commit
        runGitCmd(`git revert ${commitSha} --no-edit`);
    }
    
    const revertSha = runGitCmd("git rev-parse HEAD");
    console.log(`[Git Engine] Revert completed. Revert Commit SHA: ${revertSha}`);

    // If real GitHub is configured, push revert to origin main
    const repo = process.env.GITHUB_REPO;
    const token = process.env.GITHUB_TOKEN;
    if (repo && token && !token.startsWith("ghp_mock") && repo !== "Starlight-Local/department-of-incidents") {
        try {
            console.log("[GitHub API] Pushing reverted main branch to GitHub...");
            runGitCmd("git push origin main");
        } catch (e: any) {
            console.error(`[GitHub API Error] Failed to push revert to GitHub: ${e.message}`);
        }
    }
    
    return {
        status: "reverted",
        revertSha
    };
}
