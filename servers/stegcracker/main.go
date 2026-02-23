package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

var (
	workerToken    string
	endpointDomain string
	tunnelCache    = ".tunnel_cache.json"
)

type TunnelResponse struct {
	Success bool `json:"success"`
	Data    struct {
		Client struct {
			Name      string `json:"name"`
			Domain    string `json:"domain"`
			LocalPort int    `json:"localPort"`
			ExpiresAt string `json:"expiresAt"`
			TunnelID  string `json:"tunnelId"`
		} `json:"client"`
		PrivateKey        string `json:"privateKey"`
		ConnectionCommand string `json:"connectionCommand"`
		WorkerToken       string `json:"workerToken,omitempty"`
	} `json:"data"`
}

func initEnv() {
	godotenv.Load()
	workerToken = os.Getenv("WORKER_TOKEN")
	if workerToken == "" {
		workerToken = fmt.Sprintf("steg-%d", time.Now().UnixNano())
		os.Setenv("WORKER_TOKEN", workerToken)
		
		// Persist the generated token to .env file automatically
		content := fmt.Sprintf("WORKER_TOKEN=%s\n", workerToken)
		os.WriteFile(".env", []byte(content), 0644)
		fmt.Println("✨ First time run: Auto-generated a new Worker Token and saved to .env")
	}
}

func setupTunnel() {
	var tunnelData *TunnelResponse
	
	// Check Cache
	if cacheBytes, err := os.ReadFile(tunnelCache); err == nil {
		var cache TunnelResponse
		if err := json.Unmarshal(cacheBytes, &cache); err == nil {
			// Basic expiry check (simplified)
			if cache.Data.Client.ExpiresAt != "" {
				exp, err := time.Parse(time.RFC3339Nano, cache.Data.Client.ExpiresAt)
				if err == nil && time.Now().Before(exp) {
					fmt.Println("♻️  Using cached SSH tunnel...")
					tunnelData = &cache
					if cache.Data.WorkerToken != "" && os.Getenv("WORKER_TOKEN") == "" {
						workerToken = cache.Data.WorkerToken
					}
				}
			}
		}
	}

	if tunnelData == nil {
		fmt.Println("🚀 Requesting temporary SSH tunnel from API...")
		resp, err := http.Post("https://tunnel-8ilrb42a6el1-lttunnel.cheeph.com/api/temp", "application/json", nil)
		if err != nil {
			fmt.Println("❌ Failed to get tunnel:", err)
			return
		}
		defer resp.Body.Close()

		body, _ := io.ReadAll(resp.Body)
		var apiResp TunnelResponse
		if err := json.Unmarshal(body, &apiResp); err != nil || !apiResp.Success {
			fmt.Println("❌ Tunnel API returned an error:", string(body))
			return
		}

		apiResp.Data.WorkerToken = workerToken
		tunnelData = &apiResp

		// Save Cache
		if cacheBytes, err := json.Marshal(apiResp); err == nil {
			os.WriteFile(tunnelCache, cacheBytes, 0644)
		}
	}

	endpointDomain = tunnelData.Data.Client.Domain
	
	// Prepare SSH Key
	homeDir, _ := os.UserHomeDir()
	sshDir := filepath.Join(homeDir, ".ssh")
	os.MkdirAll(sshDir, 0700)
	
	keyPath := filepath.Join(sshDir, tunnelData.Data.Client.Name)
	os.WriteFile(keyPath, []byte(tunnelData.Data.PrivateKey), 0600)

	// Build Command
	fmt.Println("🌍 Emitting SSH command in background...")
	connCmd := tunnelData.Data.ConnectionCommand
	connCmd = strings.Replace(connCmd, "localhost:80", "127.0.0.1:5001", 1)
	connCmd = strings.Replace(connCmd, "ssh -R", "ssh -o StrictHostKeyChecking=no -R", 1)
	connCmd = strings.Replace(connCmd, "~/.ssh/"+tunnelData.Data.Client.Name, keyPath, 1)

	parts := strings.Split(connCmd, " ")
	cmd := exec.Command(parts[0], parts[1:]...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	
	go func() {
		err := cmd.Run()
		if err != nil {
			fmt.Println("SSH Tunnel Exited:", err)
		}
	}()

	fmt.Println("========================================================")
	fmt.Println("  ✅ Standalone StegCracker API Started via Tunnel!")
	fmt.Printf("  🔗 Endpoint URL: https://%s\n", endpointDomain)
	fmt.Printf("  🔑 Worker Token: %s\n", workerToken)
	fmt.Println("========================================================")
}

func main() {
	initEnv()
	setupTunnel()
	
	os.MkdirAll("uploads", 0755)
	
	r := setupRouter()
	r.Run(":5001")
}
