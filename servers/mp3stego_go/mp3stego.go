package main

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
	"regexp"
)

func resolveExePath(binName string) string {
	if embeddedBinPath != "" {
		return filepath.Join(embeddedBinPath, binName)
	}

	exePath, err := os.Executable()
	if err == nil {
		// e.g. C:\Users\Touchas\Desktop\mp3stego\encode.exe
		return filepath.Join(filepath.Dir(exePath), binName)
	}
	return binName
}

func getEncodeBin() string {
	bin := os.Getenv("ENCODE_EXE")
	if bin == "" {
		return resolveExePath("encode.exe")
	}
	// If it's an absolute path already, filepath.Join generally leaves it alone or we can just return it.
	// But assuming users provide just the name or an absolute path, we'll try to resolve it if it's not absolute.
	if !filepath.IsAbs(bin) {
		return resolveExePath(bin)
	}
	return bin
}

func getDecodeBin() string {
	bin := os.Getenv("DECODE_EXE")
	if bin == "" {
		return resolveExePath("decode.exe")
	}
	if !filepath.IsAbs(bin) {
		return resolveExePath(bin)
	}
	return bin
}

func logToFile(text string) {
	f, err := os.OpenFile("worker_debug.log", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err == nil {
		defer f.Close()
		f.WriteString(fmt.Sprintf("[%s] %s\n", time.Now().Format("2006-01-02 15:04:05"), text))
	}
}

func runStreamCmd(cmdID string, cmd *exec.Cmd) (bool, string) {
	if runtime.GOOS == "windows" {
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	}

	// Ensure CWD is the executable directory so MP3Stego tools find the 'tables' folder
	// ONLY if cmd.Dir is not already set
	if cmd.Dir == "" {
		if embeddedBinPath != "" {
			cmd.Dir = embeddedBinPath
		} else {
			exePath, err := os.Executable()
			if err == nil {
				cmd.Dir = filepath.Dir(exePath)
			}
		}
	}

	logToFile("--- NEW COMMAND EXECUTION ---")
	logToFile(fmt.Sprintf("Command ID: %s", cmdID))
	logToFile(fmt.Sprintf("Executable: %s", cmd.Path))
	logToFile(fmt.Sprintf("Args: %v", cmd.Args))
	logToFile(fmt.Sprintf("Working Dir (cmd.Dir): %s", cmd.Dir))

	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()

	err := cmd.Start()
	if err != nil {
		logToFile(fmt.Sprintf("Start Error: %v", err))
		return false, err.Error()
	}

	var outBuf strings.Builder
	var errBuf strings.Builder

	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stdout)
		frameRegex := regexp.MustCompile(`\[Frame\s+(\d+)\]`)
		
		for scanner.Scan() {
			text := strings.TrimSpace(scanner.Text())
			outBuf.WriteString(text + "\n")
			if text != "" {
				sendIt := true
				
				// Filter out frequent frame logs, only send every 20 frames
				matches := frameRegex.FindAllStringSubmatch(text, -1)
				if len(matches) > 0 {
					sendIt = false
					// If the line contains multiple frame updates, check the last one
					lastMatch := matches[len(matches)-1]
					var frameNum int
					fmt.Sscanf(lastMatch[1], "%d", &frameNum)
					if frameNum%20 == 0 {
						sendIt = true
					}
				}

				if sendIt {
					sendLog(cmdID, text, "info")
				}
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
	err = cmd.Wait()

	if err != nil {
		// Output BOTH stdout and stderr as some Windows terminal tools output errors to stdout
		combinedErr := strings.TrimSpace(outBuf.String() + "\n" + errBuf.String())
		logToFile(fmt.Sprintf("Process exited with error: %v\n-- Combined Output --\n%s", err, combinedErr))
		return false, combinedErr
	}
	
	logToFile(fmt.Sprintf("Process completed successfully.\n-- Standard Output --\n%s", outBuf.String()))
	return true, outBuf.String()
}

func ensureTablesInDir(targetDir string) {
	tablesDst := filepath.Join(targetDir, "tables")
	if _, err := os.Stat(tablesDst); err == nil {
		return // Already exists
	}
	var tablesSrc string
	if embeddedBinPath != "" {
		tablesSrc = filepath.Join(embeddedBinPath, "tables")
	} else {
		tablesSrc = filepath.Join(".", "tables")
		exePath, err := os.Executable()
		if err == nil {
			tablesSrc = filepath.Join(filepath.Dir(exePath), "tables")
		}
	}
	copyDir(tablesSrc, tablesDst)
}

func cmdEncode(cmdID string, params map[string]interface{}, coverPath string, tmpDir string) {
	fmt.Printf("🔒 Encoding command %s...\n", cmdID[:8])
	
	secret, _ := params["secret"].(string)
	text, _ := params["text"].(string)

	textFile := filepath.Join(tmpDir, "message.txt")
	os.WriteFile(textFile, []byte(text), 0644)

	outputFile := filepath.Join(tmpDir, "output_"+cmdID+filepath.Ext(coverPath))

	ensureTablesInDir(tmpDir)

	// Use relative paths within tmpDir to avoid MP3Stego C-code path parsing bugs
	relTextFile := "message.txt"
	relCoverPath := filepath.Base(coverPath)
	relOutputFile := filepath.Base(outputFile)

	args := []string{"-E", relTextFile}
	if secret != "" {
		args = append(args, "-P", secret)
	}
	args = append(args, relCoverPath, relOutputFile)

	bin := getEncodeBin()
	if _, err := os.Stat(bin); os.IsNotExist(err) {
		msg := fmt.Sprintf("❌ ไม่พบไฟล์โปรแกรม: %s\nกรุณานำไฟล์ %s และโฟลเดอร์ 'tables' มาวางไว้ในโฟลเดอร์เดียวกันกับ Worker", bin, filepath.Base(bin))
		logToFile(msg)
		sendLog(cmdID, msg, "error")
		markDone(cmdID, false, nil, msg, "")
		return
	}

	sendLog(cmdID, fmt.Sprintf("Running: %s %s", bin, strings.Join(args, " ")), "info")
	
	cmd := exec.Command(bin, args...)
	cmd.Dir = tmpDir // Set working directory to tmpDir to avoid PATH parsing bugs
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

	ensureTablesInDir(tmpDir)

	// Use relative path to avoid output path parsing bugs in C-code
	relCoverPath := filepath.Base(coverPath)

	args := []string{"-X"}
	if secret != "" {
		args = append(args, "-P", secret)
	}
	args = append(args, relCoverPath)

	bin := getDecodeBin()
	if _, err := os.Stat(bin); os.IsNotExist(err) {
		msg := fmt.Sprintf("❌ ไม่พบไฟล์โปรแกรม: %s\nกรุณานำไฟล์ %s และโฟลเดอร์ 'tables' มาวางไว้ในโฟลเดอร์เดียวกันกับ Worker", bin, filepath.Base(bin))
		logToFile(msg)
		sendLog(cmdID, msg, "error")
		markDone(cmdID, false, nil, msg, "")
		return
	}

	sendLog(cmdID, fmt.Sprintf("Running: %s %s", bin, strings.Join(args, " ")), "info")

	cmd := exec.Command(bin, args...)
	cmd.Dir = tmpDir
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

	bin := getDecodeBin()
	if _, err := os.Stat(bin); os.IsNotExist(err) {
		msg := fmt.Sprintf("❌ ไม่พบไฟล์โปรแกรม: %s\nกรุณานำไฟล์ %s และโฟลเดอร์ 'tables' มาวางไว้ในโฟลเดอร์เดียวกันกับ Worker", bin, filepath.Base(bin))
		logToFile(msg)
		sendLog(cmdID, msg, "error")
		markDone(cmdID, false, nil, msg, "")
		return
	}

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
			
			// MP3Stego decode requires both the file and a 'tables' directory next to it
			workerDir := filepath.Join(tmpDir, fmt.Sprintf("w_%d", workerID))
			os.MkdirAll(workerDir, 0755)
			
			// Create a symlink or copy the tables directory
			ensureTablesInDir(workerDir)

			// Each worker needs its own copy of the cover file to prevent access conflicts
			relCover := fmt.Sprintf("file%s", filepath.Ext(coverPath))
			workerCover := filepath.Join(workerDir, relCover)
			copyFile(coverPath, workerCover)
			defer os.RemoveAll(workerDir) // Cleanup entire worker dir

			for job := range jobs {
				relOutput := relCover + ".txt"
				workerOutput := filepath.Join(workerDir, relOutput)
				
				cmd := exec.Command(getDecodeBin(), "-X", "-P", job.Password, relCover)
				if runtime.GOOS == "windows" {
					cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
				}
				// Run inside Sandbox to avoid Path Parsing bugs
				cmd.Dir = workerDir
				
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
						if len(textStr) > 0 {
							checkGibberish, _ := params["check_gibberish"].(bool)
							if checkGibberish {
								validChars := 0
								replacements := 0
								for _, r := range textStr {
									if (r >= 32 && r < 127) || r == '\n' || r == '\r' || r == '\t' {
										validChars++
									}
									if r == '\ufffd' {
										replacements++
									}
								}
								ratio := float64(validChars) / float64(len(textStr))
								if ratio < 0.7 || replacements > 3 {
									results <- BruteResult{Password: job.Password, Success: false}
									os.Remove(workerOutput)
									continue
								}
							}
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

func copyDir(src, dst string) error {
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	err = os.MkdirAll(dst, 0755)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		srcPath := filepath.Join(src, entry.Name())
		dstPath := filepath.Join(dst, entry.Name())

		if entry.IsDir() {
			err = copyDir(srcPath, dstPath)
			if err != nil {
				return err
			}
		} else {
			err = copyFile(srcPath, dstPath)
			if err != nil {
				return err
			}
		}
	}
	return nil
}
