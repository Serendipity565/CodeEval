package main

import (
	"context"
	"fmt"
	"net/http"
	"os"

	"codeeval/server/internal/api"
	"codeeval/server/internal/auth"
	"codeeval/server/internal/config"
	"codeeval/server/internal/evaluator"
	"codeeval/server/internal/store"
	"github.com/gin-gonic/gin"
)

func main() {
	configPath := os.Getenv("CODEEVAL_CONFIG")
	if configPath == "" {
		configPath = "config.yaml"
	}
	cfg, err := config.Load(configPath)
	if err != nil {
		panic(err)
	}
	db, err := store.NewMySQL(cfg)
	if err != nil {
		panic(err)
	}
	if cfg.Seed.Enabled {
		if err := store.SeedMockData(db); err != nil {
			panic(err)
		}
	}
	if os.Getenv("GIN_MODE") == "" {
		gin.SetMode(gin.DebugMode)
	}
	router := gin.New()
	router.Use(gin.Logger(), gin.Recovery(), cors(cfg.Server.CORSOrigins))
	handler := api.New(db, auth.New(cfg.JWT.Secret, cfg.JWT.ExpiresHours), evaluator.NewService(cfg), cfg)
	if err := handler.StartEvaluationWorkers(context.Background()); err != nil {
		panic(err)
	}
	router.GET("/healthz", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"status": "ok"}) })
	handler.Register(router.Group("/api/v1"))
	if err := router.Run(fmt.Sprintf(":%d", cfg.Server.Port)); err != nil {
		panic(err)
	}
}

func cors(origins []string) gin.HandlerFunc {
	allowed := map[string]bool{}
	for _, origin := range origins {
		allowed[origin] = true
	}
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if allowed[origin] {
			c.Header("Access-Control-Allow-Origin", origin)
		}
		c.Header("Vary", "Origin")
		c.Header("Access-Control-Allow-Headers", "Authorization, Content-Type")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
		if c.Request.Method == http.MethodOptions {
			c.Status(http.StatusNoContent)
			c.Abort()
			return
		}
		c.Next()
	}
}
