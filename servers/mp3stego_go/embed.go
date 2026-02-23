package main

import (
	"embed"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

//go:embed MP3Stego_1_1_19/MP3Stego/Encode.exe MP3Stego_1_1_19/MP3Stego/Decode.exe MP3Stego_1_1_19/MP3Stego/tables/*
var mp3stegoFS embed.FS

var embeddedBinPath string

func extractMP3Stego() {
	tmpDir := filepath.Join(os.TempDir(), "xemst_mp3stego_bin")
	os.MkdirAll(filepath.Join(tmpDir, "tables"), 0755)
	
	fmt.Println("📦 Extracting embedded MP3Stego binaries...")

	err := fs.WalkDir(mp3stegoFS, "MP3Stego_1_1_19/MP3Stego", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		
		relPath, _ := filepath.Rel("MP3Stego_1_1_19/MP3Stego", path)
		outPath := filepath.Join(tmpDir, relPath)
		
		// If file exists and size is matching, we skip extraction
		stat, err := os.Stat(outPath)
		if err == nil {
			embeddedStat, errEmbed := mp3stegoFS.Open(path)
			if errEmbed == nil {
				eStat, errEStat := embeddedStat.Stat()
				embeddedStat.Close()
				if errEStat == nil && stat.Size() == eStat.Size() {
					return nil // already extracted and valid
				}
			}
		}
		
		content, err := mp3stegoFS.ReadFile(path)
		if err != nil {
			return err
		}
		
		os.MkdirAll(filepath.Dir(outPath), 0755)
		return os.WriteFile(outPath, content, 0755)
	})
	
	if err == nil {
		embeddedBinPath = tmpDir
	} else {
		fmt.Printf("⚠️ Failed to extract embedded binaries: %v\n", err)
	}
}
