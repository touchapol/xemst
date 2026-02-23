package main

import (
	"fmt"
	"sync"
)

type LogEntry struct {
	Msg  string `json:"msg"`
	Type string `json:"type"`
}

type CommandStore struct {
	Status        string
	Logs          []LogEntry
	Result        interface{}
	HasResultFile bool
	Done          bool
	ResultFile    string

	mu          sync.RWMutex
	subscribers []chan SSEMessage
}

type SSEMessage struct {
	Type string
	Log  LogEntry
}

var (
	commandsStore = make(map[string]*CommandStore)
	storeMu       sync.RWMutex
)

func initStore(id string) *CommandStore {
	storeMu.Lock()
	defer storeMu.Unlock()
	store := &CommandStore{
		Status:      "pending",
		Logs:        make([]LogEntry, 0),
		subscribers: make([]chan SSEMessage, 0),
	}
	commandsStore[id] = store
	return store
}

func getStore(id string) *CommandStore {
	storeMu.RLock()
	defer storeMu.RUnlock()
	return commandsStore[id]
}

func (s *CommandStore) Subscribe() chan SSEMessage {
	ch := make(chan SSEMessage, 100)
	s.mu.Lock()
	s.subscribers = append(s.subscribers, ch)
	s.mu.Unlock()
	return ch
}

func (s *CommandStore) Unsubscribe(ch chan SSEMessage) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, sub := range s.subscribers {
		if sub == ch {
			s.subscribers = append(s.subscribers[:i], s.subscribers[i+1:]...)
			close(ch)
			break
		}
	}
}

func sendLog(cmdID, msg, logType string) {
	fmt.Printf("[%s] [%s] %s\n", cmdID[:8], logType, msg)
	
	store := getStore(cmdID)
	if store == nil {
		return
	}

	entry := LogEntry{Msg: msg, Type: logType}
	
	store.mu.Lock()
	store.Logs = append(store.Logs, entry)
	subs := make([]chan SSEMessage, len(store.subscribers))
	copy(subs, store.subscribers)
	store.mu.Unlock()

	sseMsg := SSEMessage{Type: "log", Log: entry}
	for _, ch := range subs {
		select {
		case ch <- sseMsg:
		default:
		}
	}
}

func markDone(cmdID string, success bool, result interface{}, errStr string, resultFile string) {
	store := getStore(cmdID)
	if store == nil {
		return
	}

	store.mu.Lock()
	if success {
		store.Status = "completed"
	} else {
		store.Status = "failed"
	}
	
	store.Result = map[string]interface{}{
		"success": success,
		"result":  result,
		"error":   errStr,
	}
	
	if resultFile != "" {
		store.ResultFile = resultFile
		store.HasResultFile = true
	}
	store.Done = true
	
	subs := make([]chan SSEMessage, len(store.subscribers))
	copy(subs, store.subscribers)
	store.mu.Unlock()

	for _, ch := range subs {
		select {
		case ch <- SSEMessage{Type: "done"}:
		default:
		}
	}
}
