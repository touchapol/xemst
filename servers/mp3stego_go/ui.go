package main

import (
	_ "embed"
	"fmt"
	"html/template"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"sync"
	"time"
)

//go:embed index.html
var uiTemplate string

var (
	shutdownTimer *time.Timer
	shutdownMu    sync.Mutex
)

func startLocalUI() {
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		tmpl, err := template.New("ui").Parse(uiTemplate)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		data := map[string]interface{}{
			"Endpoint": endpointDomain,
			"Token":    workerToken,
		}
		tmpl.Execute(w, data)
	})

	http.HandleFunc("/ping", func(w http.ResponseWriter, r *http.Request) {
		// Cancel any pending shutdown since we have an active connection
		shutdownMu.Lock()
		if shutdownTimer != nil {
			shutdownTimer.Stop()
			shutdownTimer = nil
		}
		shutdownMu.Unlock()

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.WriteHeader(http.StatusOK)
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}

		// Block until the client disconnects (i.e closed the window)
		<-r.Context().Done()

		// Client disconnected, schedule shutdown
		shutdownMu.Lock()
		if shutdownTimer != nil {
			shutdownTimer.Stop()
		}
		shutdownTimer = time.AfterFunc(3*time.Second, func() {
			fmt.Println("UI Window closed. Shutting down worker...")
			os.Exit(0)
		})
		shutdownMu.Unlock()
	})

	http.HandleFunc("/shutdown", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" {
			w.WriteHeader(http.StatusOK)
			// Trigger a graceful (or abrupt) termination
			go func() {
				time.Sleep(500 * time.Millisecond) // Let response fly first
				os.Exit(0)
			}()
		}
	})

	go func() {
		fmt.Println("💻 Starting Local UI Server...")
		http.ListenAndServe("127.0.0.1:5051", nil)
	}()

	// Give the local server a tiny bit of time to bind the port
	time.Sleep(500 * time.Millisecond)

	url := "http://127.0.0.1:5051"
	var err error
	switch runtime.GOOS {
	case "windows":
		// Try to launch as a standalone app window using Edge or Chrome
		appArg := "--app=" + url
		
		// Common paths for Chrome/Edge on Windows
		paths := []string{
			"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
			"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
			"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
			"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
		}
		
		launched := false
		for _, p := range paths {
			if _, statErr := os.Stat(p); statErr == nil {
				err = exec.Command(p, appArg).Start()
				if err == nil {
					launched = true
					break
				}
			}
		}
		
		// Fallback to default browser if no Edge/Chrome found
		if !launched {
			err = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
		}
	case "darwin":
		err = exec.Command("open", "-na", "Google Chrome", "--args", "--app="+url).Start()
		if err != nil {
			err = exec.Command("open", url).Start()
		}
	case "linux":
		err = exec.Command("xdg-open", url).Start()
	}
	if err != nil {
		fmt.Println("Warning: Could not automatically open the browser:", err)
		fmt.Println("Please open your browser manually and visit:", url)
	}
}
