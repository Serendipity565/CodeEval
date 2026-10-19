// export-seed captures existing browser-generated results without changing the DB.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"codeeval/server/internal/config"
	"codeeval/server/internal/store"
	mysqlDriver "github.com/go-sql-driver/mysql"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func main() {
	configPath := flag.String("config", "config.yaml", "backend configuration")
	assignmentID := flag.Uint("assignment", 1, "source assignment ID")
	students := flag.String("students", "student01,student02,student03,student04,student05,student06", "demo cohort usernames")
	output := flag.String("output", "internal/store/fixtures/recorded_seed.json", "new output file (never overwritten)")
	flag.Parse()
	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatal(err)
	}
	dsn := mysqlDriver.NewConfig()
	dsn.User = cfg.Database.Username
	dsn.Passwd = cfg.Database.Password
	dsn.Net = "tcp"
	dsn.Addr = fmt.Sprintf("%s:%d", cfg.Database.Host, cfg.Database.Port)
	dsn.DBName = cfg.Database.Name
	dsn.ParseTime = true
	dsn.Timeout = 10 * time.Second
	dsn.ReadTimeout = 30 * time.Second
	dsn.WriteTimeout = 30 * time.Second
	db, err := gorm.Open(mysql.Open(dsn.FormatDSN()), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		log.Fatal("database connection failed")
	}
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatal(err)
	}
	defer sqlDB.Close()
	data, err := store.ExportRecordedSeed(db, *assignmentID, strings.Split(*students, ","))
	if err != nil {
		log.Fatal(err)
	}
	payload, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		log.Fatal(err)
	}
	file, err := os.OpenFile(*output, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		log.Fatal(err)
	}
	if _, err := file.Write(append(payload, '\n')); err != nil {
		file.Close()
		log.Fatal(err)
	}
	if err := file.Close(); err != nil {
		log.Fatal(err)
	}
	fmt.Printf("Recorded %d users, %d submissions and %d test cases in %s\n", len(data.Users), len(data.Submissions), len(data.Assignment.Tests), *output)
}
