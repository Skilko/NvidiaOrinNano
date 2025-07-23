#!/bin/bash

# Check if Ollama is already running
if pgrep -x "ollama" > /dev/null; then
    echo "Ollama is already running"
    exit 0
fi

# Start Ollama in the background
echo "Starting Ollama service..."
nohup ollama serve > /tmp/ollama.log 2>&1 &

# Wait a moment for the service to start
sleep 3

# Check if it started successfully
if pgrep -x "ollama" > /dev/null; then
    echo "Ollama started successfully"
    echo "Service is available at http://localhost:11434"
else
    echo "Failed to start Ollama"
    exit 1
fi