#!/bin/bash
# Ekot Web App - Startup script for Synology Task Scheduler
#
# Setup in DSM:
# 1. Control Panel → Task Scheduler → Create → Triggered Task → User-defined script
# 2. General: Name = "Ekot Web App", User = root, Event = Boot-up
# 3. Task Settings: User-defined script = /path/to/ekot/start.sh
#

# Configuration - adjust path to your installation
EKOT_DIR="/volume1/docker/ekot"  # Change this to your actual path
LOG_FILE="$EKOT_DIR/ekot.log"
PID_FILE="$EKOT_DIR/ekot.pid"

# Change to app directory
cd "$EKOT_DIR" || exit 1

# Kill existing process if running
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "$(date): Stopping existing process $OLD_PID" >> "$LOG_FILE"
        kill "$OLD_PID"
        sleep 2
    fi
    rm -f "$PID_FILE"
fi

# Start the server
echo "$(date): Starting Ekot server..." >> "$LOG_FILE"
nohup node server.js >> "$LOG_FILE" 2>&1 &

# Save PID
echo $! > "$PID_FILE"
echo "$(date): Ekot server started with PID $(cat $PID_FILE)" >> "$LOG_FILE"
