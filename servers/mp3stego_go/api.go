package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func verifyToken() gin.HandlerFunc {
	return func(c *gin.Context) {
		token := c.GetHeader("Authorization")
		if token == "" {
			token = c.Query("token")
		}
		if strings.HasPrefix(token, "Bearer ") {
			token = token[7:]
		}

		if token != workerToken {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
			c.Abort()
			return
		}
		c.Next()
	}
}

func setupRouter() *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.Default()
	config := cors.DefaultConfig()
	config.AllowAllOrigins = true
	config.AllowHeaders = []string{"Origin", "Content-Length", "Content-Type", "Authorization"}
	r.Use(cors.New(config))
	r.GET("/", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"name":   "MP3Stego Standalone API (Golang)",
			"status": "running",
			"tunnel": "active",
			"ready":  true,
		})
	})

	api := r.Group("/api")
	api.Use(verifyToken())
	{
		api.GET("/health", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"status": "ok", "message": "Worker is ready"})
		})

		api.POST("/commands", createCommand)
		api.GET("/commands/:id/stream", streamCommand)
	}

	uploads := r.Group("/uploads")
	uploads.Use(verifyToken())
	{
		uploads.StaticFS("/", http.Dir("uploads"))
	}

	return r
}

func createCommand(c *gin.Context) {
	cmdType := c.PostForm("type")
	paramsStr := c.PostForm("params")
	
	var params map[string]interface{}
	json.Unmarshal([]byte(paramsStr), &params)

	// Handle File Uploads
	coverFile, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No cover file uploaded"})
		return
	}

	cmdID := strings.ReplaceAll(uuid.New().String(), "-", "")
	
	tmpDir, _ := os.MkdirTemp("", "steg_"+cmdID)
	coverPath := filepath.Join(tmpDir, coverFile.Filename)
	c.SaveUploadedFile(coverFile, coverPath)

	wordlistPath := ""
	wordlistFile, err := c.FormFile("wordlist")
	if err == nil {
		wordlistPath = filepath.Join(tmpDir, wordlistFile.Filename)
		c.SaveUploadedFile(wordlistFile, wordlistPath)
	}

	initStore(cmdID)
	sendLog(cmdID, "Worker picked up command", "info")

	// Trigger Background Job
	if cmdType == "encode" {
		go cmdEncode(cmdID, params, coverPath, tmpDir)
	} else if cmdType == "decode" {
		go cmdDecode(cmdID, params, coverPath, tmpDir)
	} else if cmdType == "bruteforce" {
		go cmdBruteforce(cmdID, params, coverPath, wordlistPath, tmpDir)
	} else {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid command type"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"commandId": cmdID})
}

func streamCommand(c *gin.Context) {
	cmdID := c.Param("id")
	store := getStore(cmdID)
	if store == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Command not found"})
		return
	}

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache, no-transform")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	pad := strings.Repeat(" ", 64*1024)
	fmt.Fprintf(c.Writer, "retry: 3000\n\n")
	fmt.Fprintf(c.Writer, "event: connected\ndata: {\"commandId\":\"%s\"}\n\n", cmdID)
	c.Writer.Flush()

	clientChan := store.Subscribe()
	defer store.Unsubscribe(clientChan)

	// Send backlog
	store.mu.RLock()
	logs := make([]LogEntry, len(store.Logs))
	copy(logs, store.Logs)
	isDone := store.Done
	status := store.Status
	result := store.Result
	hasFile := store.HasResultFile
	store.mu.RUnlock()

	for _, log := range logs {
		logJson, _ := json.Marshal(log)
		fmt.Fprintf(c.Writer, "event: log\ndata: %s%s\n\n", logJson, pad)
	}
	c.Writer.Flush()

	if isDone {
		resJson, _ := json.Marshal(map[string]interface{}{
			"status": status, "result": result, "hasResultFile": hasFile, "resultFile": store.ResultFile,
		})
		fmt.Fprintf(c.Writer, "event: done\ndata: %s%s\n\n", resJson, pad)
		c.Writer.Flush()
		return
	}

	for {
		select {
		case msg := <-clientChan:
			if msg.Type == "done" {
				resJson, _ := json.Marshal(map[string]interface{}{
					"status": store.Status, "result": store.Result, "hasResultFile": store.HasResultFile, "resultFile": store.ResultFile,
				})
				fmt.Fprintf(c.Writer, "event: done\ndata: %s%s\n\n", resJson, pad)
				c.Writer.Flush()
				return
			} else {
				logJson, _ := json.Marshal(msg.Log)
				fmt.Fprintf(c.Writer, "event: log\ndata: %s%s\n\n", logJson, pad)
				c.Writer.Flush()
			}
		case <-c.Request.Context().Done():
			return
		}
	}
}
