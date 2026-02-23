package main

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

func getSteghideBin() string {
	bin := os.Getenv("STEGHIDE_BIN")
	if bin == "" {
		return "steghide"
	}
	return bin
}

func runStreamCmd(cmdID string, cmd *exec.Cmd) (bool, string) {
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()

	cmd.Start()

	var outBuf strings.Builder
	var errBuf strings.Builder

	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			text := scanner.Text()
			outBuf.WriteString(text + "\n")
			if text != "" {
				sendLog(cmdID, text, "info")
			}
		}
	}()

	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			text := scanner.Text()
			errBuf.WriteString(text + "\n")
			if text != "" {
				sendLog(cmdID, text, "error")
			}
		}
	}()

	wg.Wait()
	err := cmd.Wait()

	if err != nil {
		return false, errBuf.String()
	}
	return true, outBuf.String()
}

func cmdEncode(cmdID string, params map[string]interface{}, coverPath string, tmpDir string) {
	fmt.Printf("🔒 Encoding command %s...\n", cmdID[:8])
	
	secret, _ := params["secret"].(string)
	text, _ := params["text"].(string)

	textFile := filepath.Join(tmpDir, "message.txt")
	os.WriteFile(textFile, []byte(text), 0644)

	outputFile := filepath.Join(tmpDir, "output_"+cmdID+filepath.Ext(coverPath))

	args := []string{"embed", "-ef", textFile, "-cf", coverPath, "-sf", outputFile, "-f"}
	if secret != "" {
		args = append(args, "-p", secret)
	} else {
		args = append(args, "-p", "")
	}

	sendLog(cmdID, fmt.Sprintf("Running: %s %s", getSteghideBin(), strings.Join(args, " ")), "info")
	
	cmd := exec.Command(getSteghideBin(), args...)
	success, errOutput := runStreamCmd(cmdID, cmd)

	if success {
		sendLog(cmdID, "Encoding successful", "success")
		markDone(cmdID, true, "Encoding successful", "", outputFile)
	} else {
		markDone(cmdID, false, nil, "Encoding failed: "+errOutput, "")
	}
}

func cmdDecode(cmdID string, params map[string]interface{}, coverPath string, tmpDir string) {
	fmt.Printf("🔓 Decoding command %s...\n", cmdID[:8])
	
	secret, _ := params["secret"].(string)
	outputFile := coverPath + ".txt"

	args := []string{"extract", "-sf", coverPath, "-xf", outputFile, "-f"}
	if secret != "" {
		args = append(args, "-p", secret)
	} else {
		args = append(args, "-p", "")
	}

	sendLog(cmdID, fmt.Sprintf("Running: %s %s", getSteghideBin(), strings.Join(args, " ")), "info")

	cmd := exec.Command(getSteghideBin(), args...)
	success, errOutput := runStreamCmd(cmdID, cmd)

	if success {
		content, _ := os.ReadFile(outputFile)
		textStr := strings.TrimSpace(string(content))

		sendLog(cmdID, "Decode successful", "success")
		if textStr != "" {
			sendLog(cmdID, "--- HIDDEN MESSAGE ---", "success")
			sendLog(cmdID, textStr, "success")
			sendLog(cmdID, "----------------------", "success")
		}
		
		markDone(cmdID, true, map[string]string{"text": textStr}, "", "")
	} else {
		markDone(cmdID, false, nil, "Decoding failed: "+errOutput, "")
	}
}

// === BRUTE FORCE WORKER ===

type BruteJob struct {
	Password string
	ID       int
}

type BruteResult struct {
	Password string
	Success  bool
	Text     string
}

func cmdBruteforce(cmdID string, params map[string]interface{}, coverPath string, wordlistPath string, tmpDir string) {
	fmt.Printf("💣 Brute force command %s...\n", cmdID[:8])

	chunkSizeF, ok := params["chunk_size"].(float64)
	if !ok {
		chunkSizeF = 10
	}
	chunkSize := int(chunkSizeF)
	if chunkSize < 1 {
		chunkSize = 1
	} else if chunkSize > 50 {
		chunkSize = 50
	}

	// Read Wordlist
	var passwords []string
	if wordlistPath != "" {
		file, err := os.Open(wordlistPath)
		if err == nil {
			defer file.Close()
			scanner := bufio.NewScanner(file)
			for scanner.Scan() {
				line := strings.TrimSpace(scanner.Text())
				if line != "" {
					passwords = append(passwords, line)
				}
			}
		}
	} else {
		passwords = []string{"123456", "password", "admin", "p@ssw0rd"} // Fallback
	}

	total := len(passwords)
	sendLog(cmdID, fmt.Sprintf("Brute forcing %d passwords (Workers: %d)...", total, chunkSize), "info")

	jobs := make(chan BruteJob, total)
	results := make(chan BruteResult, total)
	
	// Start Worker Pool
	var wg sync.WaitGroup
	for w := 1; w <= chunkSize; w++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			
			// Each worker needs its own copy of the cover file to prevent access conflicts
			workerCover := filepath.Join(tmpDir, fmt.Sprintf("w_%d%s", workerID, filepath.Ext(coverPath)))
			copyFile(coverPath, workerCover)
			defer os.Remove(workerCover)

			for job := range jobs {
				workerOutput := workerCover + ".txt"
				
				// steghide extract -sf <file> -p <pass> -xf <out> -f
				cmd := exec.Command(getSteghideBin(), "extract", "-sf", workerCover, "-p", job.Password, "-xf", workerOutput, "-f")
				
				// Run silently with timeout
				done := make(chan error, 1)
				go func() {
					done <- cmd.Run()
				}()

				select {
				case <-time.After(30 * time.Second):
					if cmd.Process != nil {
						cmd.Process.Kill()
					}
					results <- BruteResult{Password: job.Password, Success: false}
				case err := <-done:
					if err == nil {
						content, _ := os.ReadFile(workerOutput)
						textStr := strings.TrimSpace(string(content))
						
						// Basic Gibberish check matching Python version
						// This could be expanded based on user requirements.
						if len(textStr) > 0 {
							results <- BruteResult{Password: job.Password, Success: true, Text: textStr}
						} else {
							results <- BruteResult{Password: job.Password, Success: false}
						}
					} else {
						results <- BruteResult{Password: job.Password, Success: false}
					}
				}
				os.Remove(workerOutput)
			}
		}(w)
	}

	// Feed jobs
	go func() {
		for i, pwd := range passwords {
			jobs <- BruteJob{Password: pwd, ID: i}
		}
		close(jobs)
	}()

	// Wait in background and close results
	go func() {
		wg.Wait()
		close(results)
	}()

	// Collect Results
	found := false
	for res := range results {
		if res.Success {
			if !found { // Only trigger first success
				sendLog(cmdID, fmt.Sprintf("%s|||%s|||%s", res.Password, "Steghide Found", res.Text), "brute_success")
				markDone(cmdID, true, map[string]string{"password": res.Password, "text": res.Text}, "", "")
				found = true
			}
		} else {
			if !found {
				sendLog(cmdID, res.Password, "brute_fail")
			}
		}
	}

	if !found {
		markDone(cmdID, false, nil, fmt.Sprintf("No password found (%d tried)", total), "")
	}
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}
