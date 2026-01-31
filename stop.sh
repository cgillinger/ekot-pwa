#!/bin/bash
# Ekot Web App - Stop script
#

# Configuration - adjust path to your installation
EKOT_DIR="/volume1/docker/ekot"  # Change this to your actual path
LOG_FILE="$EKOT_DIR/ekot.log"
PID_FILE="$EKOT_DIR/ekot.pid"

if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
        echo "$(date): Stopping Ekot server (PID $PID)..." >> "$LOG_FILE"
        kill "$PID"
        rm -f "$PID_FILE"
        echo "$(date): Ekot server stopped" >> "$LOG_FILE"
    else
        echo "Process $PID not running"
        rm -f "$PID_FILE"
    fi
else
    echo "No PID file found"
fi
