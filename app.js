/**
 * Ekot Web App
 * Minimal web app for Sveriges Radio Ekot broadcasts
 */

(function() {
    'use strict';

    // App version - bump this to force cache refresh
    const VERSION = '1.2.1';
    console.log(`Ekot Web App v${VERSION}`);

    // Configuration
    const CONFIG = {
        RSS_URL: '/api/rss', // Proxied through server to avoid CORS
        TIMEZONE: 'Europe/Stockholm',
        // Slots with pollStart = when broadcast ends (earliest availability)
        // Broadcast lengths vary: 08:00 (5-15min), 12:30 (20-25min), 16:45 (15min), 17:45 (20min)
        SLOTS: [
            { time: '08:00', pollStart: { hour: 8, minute: 20 } },   // +20min margin
            { time: '12:30', pollStart: { hour: 13, minute: 0 } },   // +30min margin
            { time: '16:45', pollStart: { hour: 17, minute: 5 } },   // +20min margin
            { time: '17:45', pollStart: { hour: 18, minute: 10 } }   // +25min margin
        ],
        POLL_INTERVALS: {
            ACTIVE: 60000,      // 1 minute during active window
            EXTENDED: 300000,   // 5 minutes during extended window
            IDLE: 1800000       // 30 minutes outside windows
        },
        ACTIVE_WINDOW: 10,      // Minutes after pollStart for active polling
        EXTENDED_WINDOW: 30,    // Minutes after pollStart for extended polling
        AUDIO_FOCUS_TIMEOUT: 15 * 60 * 1000  // 15 minutes in ms - release audio focus after this
    };

    // State
    const state = {
        broadcasts: {},          // Keyed by slot time
        currentSlot: null,       // Currently playing slot
        lastFetchDate: null,     // Last date we fetched for
        pollTimer: null,
        lastEtag: null,
        lastModified: null,
        audioFocusTimer: null   // Timer for releasing audio focus after pause
    };

    // DOM Elements
    const elements = {
        tilesContainer: null,
        audioPlayer: null,
        playPause: null,
        playPauseIcon: null,
        skipBack: null,
        skipForward: null,
        currentTime: null,
        duration: null,
        progressBar: null,
        progressFill: null,
        nowPlaying: null,
        statusMessage: null,
        dateDisplay: null,
        silencePlayer: null
    };

    /**
     * Get current date in Stockholm timezone as YYYY-MM-DD
     */
    function getStockholmDate() {
        const now = new Date();
        return now.toLocaleDateString('sv-SE', { timeZone: CONFIG.TIMEZONE });
    }

    /**
     * Get current time in Stockholm timezone as HH:MM
     */
    function getStockholmTime() {
        const now = new Date();
        return now.toLocaleTimeString('sv-SE', {
            timeZone: CONFIG.TIMEZONE,
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    /**
     * Get current hour and minute in Stockholm timezone
     */
    function getStockholmHourMinute() {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('sv-SE', {
            timeZone: CONFIG.TIMEZONE,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
        const [hour, minute] = timeStr.split(':').map(Number);
        return { hour, minute };
    }

    /**
     * Parse RSS pubDate to Stockholm date string
     */
    function parseRssDateToStockholm(pubDateStr) {
        const date = new Date(pubDateStr);
        return date.toLocaleDateString('sv-SE', { timeZone: CONFIG.TIMEZONE });
    }

    /**
     * Parse RSS pubDate to timestamp
     */
    function parseRssDateToTimestamp(pubDateStr) {
        return new Date(pubDateStr).getTime();
    }

    /**
     * Extract time slot from title (e.g., "Ekot 08:00" -> "08:00")
     */
    function extractSlotFromTitle(title) {
        for (const slot of CONFIG.SLOTS) {
            if (title.includes(slot.time)) {
                return slot.time;
            }
        }
        return null;
    }

    /**
     * Get slot times as simple array
     */
    function getSlotTimes() {
        return CONFIG.SLOTS.map(s => s.time);
    }

    /**
     * Get slot config by time
     */
    function getSlotConfig(time) {
        return CONFIG.SLOTS.find(s => s.time === time);
    }

    /**
     * Format seconds to MM:SS
     */
    function formatTime(seconds) {
        if (isNaN(seconds) || !isFinite(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    /**
     * Show status message
     */
    function showStatus(message, isError = false, duration = 3000) {
        elements.statusMessage.textContent = message;
        elements.statusMessage.classList.toggle('error', isError);
        elements.statusMessage.classList.add('visible');

        setTimeout(() => {
            elements.statusMessage.classList.remove('visible');
        }, duration);
    }

    /**
     * Reset state for new day
     */
    function resetForNewDay() {
        state.broadcasts = {};
        state.currentSlot = null;
        state.lastFetchDate = getStockholmDate();
        stopPlayback();
        renderTiles();
    }

    /**
     * Check if we need to reset for a new day
     */
    function checkDayChange() {
        const currentDate = getStockholmDate();
        if (state.lastFetchDate && state.lastFetchDate !== currentDate) {
            resetForNewDay();
            return true;
        }
        return false;
    }

    /**
     * Parse RSS XML and extract broadcasts
     */
    function parseRss(xmlText) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlText, 'application/xml');

        const parseError = doc.querySelector('parsererror');
        if (parseError) {
            throw new Error('RSS parse error');
        }

        const items = doc.querySelectorAll('item');
        const todayStr = getStockholmDate();
        const broadcasts = {};

        items.forEach(item => {
            const title = item.querySelector('title')?.textContent || '';
            const pubDate = item.querySelector('pubDate')?.textContent || '';
            const enclosure = item.querySelector('enclosure');
            const audioUrl = enclosure?.getAttribute('url') || '';

            // Only process items from today
            const itemDate = parseRssDateToStockholm(pubDate);
            if (itemDate !== todayStr) return;

            // Extract slot from title
            const slot = extractSlotFromTitle(title);
            if (!slot) return;

            // Store broadcast info
            broadcasts[slot] = {
                title,
                pubDate,
                timestamp: parseRssDateToTimestamp(pubDate),
                audioUrl,
                slot
            };
        });

        return broadcasts;
    }

    /**
     * Fetch RSS feed
     */
    async function fetchRss(forceRefresh = false) {
        try {
            const headers = {};

            // Use conditional headers only if not forcing refresh
            if (!forceRefresh) {
                if (state.lastEtag) {
                    headers['If-None-Match'] = state.lastEtag;
                }
                if (state.lastModified) {
                    headers['If-Modified-Since'] = state.lastModified;
                }
            }

            // Add cache-busting for first load to avoid browser cache issues
            const url = forceRefresh
                ? `${CONFIG.RSS_URL}?_=${Date.now()}`
                : CONFIG.RSS_URL;

            const response = await fetch(url, {
                headers,
                cache: forceRefresh ? 'no-store' : 'default'
            });

            // Handle 304 Not Modified
            if (response.status === 304) {
                return null;
            }

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            // Store cache headers
            state.lastEtag = response.headers.get('ETag');
            state.lastModified = response.headers.get('Last-Modified');

            const xmlText = await response.text();
            return parseRss(xmlText);
        } catch (error) {
            console.error('Failed to fetch RSS:', error);
            showStatus('Kunde inte hämta sändningar', true);
            return null;
        }
    }

    /**
     * Update broadcasts and render
     */
    async function updateBroadcasts(forceRefresh = false) {
        checkDayChange();

        const newBroadcasts = await fetchRss(forceRefresh);
        if (newBroadcasts) {
            // Merge new broadcasts with existing
            Object.assign(state.broadcasts, newBroadcasts);
            state.lastFetchDate = getStockholmDate();
            renderTiles();
        }
    }

    /**
     * Calculate optimal poll interval based on current time
     * Polling starts AFTER broadcast ends (pollStart), not when it begins
     */
    function calculatePollInterval() {
        const { hour, minute } = getStockholmHourMinute();
        const currentMinutes = hour * 60 + minute;

        // Check each slot
        for (const slot of CONFIG.SLOTS) {
            const pollStartMinutes = slot.pollStart.hour * 60 + slot.pollStart.minute;
            const diff = currentMinutes - pollStartMinutes;

            // If broadcast for this slot doesn't exist yet
            if (!state.broadcasts[slot.time]) {
                // Active window: pollStart to pollStart+10
                if (diff >= 0 && diff <= CONFIG.ACTIVE_WINDOW) {
                    return CONFIG.POLL_INTERVALS.ACTIVE;
                }
                // Extended window: pollStart+10 to pollStart+30
                if (diff > CONFIG.ACTIVE_WINDOW && diff <= CONFIG.EXTENDED_WINDOW) {
                    return CONFIG.POLL_INTERVALS.EXTENDED;
                }
            }
        }

        return CONFIG.POLL_INTERVALS.IDLE;
    }

    /**
     * Schedule next poll
     */
    function schedulePoll() {
        if (state.pollTimer) {
            clearTimeout(state.pollTimer);
        }

        const interval = calculatePollInterval();
        state.pollTimer = setTimeout(async () => {
            await updateBroadcasts();
            schedulePoll();
        }, interval);
    }

    /**
     * Find the latest broadcast among available slots
     */
    function findLatestBroadcast() {
        let latest = null;
        let latestTimestamp = 0;

        for (const slot of CONFIG.SLOTS) {
            const broadcast = state.broadcasts[slot.time];
            if (broadcast && broadcast.timestamp > latestTimestamp) {
                latestTimestamp = broadcast.timestamp;
                latest = slot.time;
            }
        }

        return latest;
    }

    /**
     * Sort slots with latest first
     */
    function getSortedSlots() {
        const latestSlot = findLatestBroadcast();
        const slotTimes = getSlotTimes();

        if (latestSlot) {
            const index = slotTimes.indexOf(latestSlot);
            if (index > -1) {
                slotTimes.splice(index, 1);
                slotTimes.unshift(latestSlot);
            }
        }

        return slotTimes;
    }

    /**
     * Render tiles
     */
    function renderTiles() {
        const latestSlot = findLatestBroadcast();
        const sortedSlots = getSortedSlots();

        elements.tilesContainer.innerHTML = '';

        sortedSlots.forEach(slot => {
            const broadcast = state.broadcasts[slot];
            const isActive = !!broadcast;
            const isLatest = slot === latestSlot;
            const isPlaying = state.currentSlot === slot;

            const tile = document.createElement('div');
            tile.className = 'tile';
            tile.classList.toggle('active', isActive);
            tile.classList.toggle('inactive', !isActive);
            tile.classList.toggle('latest', isLatest);
            tile.classList.toggle('playing', isPlaying);
            tile.dataset.slot = slot;

            const icon = document.createElement('img');
            icon.className = 'tile-icon';
            icon.src = isActive ? 'assets/icon-96x96.png' : 'assets/icon-gray-96x96.png';
            icon.alt = 'Ekot';

            const timeLabel = document.createElement('span');
            timeLabel.className = 'tile-time';
            timeLabel.textContent = slot;

            tile.appendChild(icon);
            tile.appendChild(timeLabel);

            if (isActive) {
                tile.addEventListener('click', () => playBroadcast(slot));
            }

            elements.tilesContainer.appendChild(tile);
        });

        // Update date display
        updateDateDisplay();
    }

    /**
     * Update date display
     */
    function updateDateDisplay() {
        const date = new Date();
        const options = {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            timeZone: CONFIG.TIMEZONE
        };
        elements.dateDisplay.textContent = date.toLocaleDateString('sv-SE', options);
    }

    /**
     * Play broadcast
     */
    function playBroadcast(slot) {
        const broadcast = state.broadcasts[slot];
        if (!broadcast || !broadcast.audioUrl) {
            showStatus('Ingen sändning tillgänglig', true);
            return;
        }

        // Stop any audio focus keep-alive from a previous pause
        stopAudioFocusKeepAlive();

        // Update state
        state.currentSlot = slot;

        // Set audio source and play (must be synchronous with user gesture)
        elements.audioPlayer.src = broadcast.audioUrl;
        elements.audioPlayer.play().catch(error => {
            console.error('Playback error:', error);
            showStatus('Kunde inte spela upp ljudet', true);
        });

        // Update Media Session metadata for lock screen / headphone controls
        updateMediaSessionMetadata(slot);

        // Update UI
        elements.nowPlaying.textContent = `Ekot ${slot}`;
        renderTiles();
    }

    /**
     * Stop playback
     */
    function stopPlayback() {
        stopAudioFocusKeepAlive();
        elements.audioPlayer.pause();
        elements.audioPlayer.src = '';
        state.currentSlot = null;
        elements.nowPlaying.textContent = 'Ingen uppspelning';
        elements.playPauseIcon.textContent = '\u25B6';
        elements.currentTime.textContent = '0:00';
        elements.duration.textContent = '0:00';
        elements.progressFill.style.width = '0%';
        renderTiles();
    }

    /**
     * Start silent audio to keep audio focus while paused.
     * Automatically releases after CONFIG.AUDIO_FOCUS_TIMEOUT.
     */
    function startAudioFocusKeepAlive() {
        stopAudioFocusKeepAlive();

        elements.silencePlayer.src = 'assets/silence.wav';
        elements.silencePlayer.play().catch(error => {
            console.log('Could not start silence player:', error);
        });

        state.audioFocusTimer = setTimeout(() => {
            console.log('Audio focus timeout reached, releasing');
            stopAudioFocusKeepAlive();
            stopPlayback();
        }, CONFIG.AUDIO_FOCUS_TIMEOUT);
    }

    /**
     * Stop silent audio and clear the focus timeout
     */
    function stopAudioFocusKeepAlive() {
        if (state.audioFocusTimer) {
            clearTimeout(state.audioFocusTimer);
            state.audioFocusTimer = null;
        }
        elements.silencePlayer.pause();
        elements.silencePlayer.src = '';
    }

    /**
     * Toggle play/pause
     */
    function togglePlayPause() {
        if (!elements.audioPlayer.src) {
            // If nothing loaded, play the latest broadcast
            const latestSlot = findLatestBroadcast();
            if (latestSlot) {
                playBroadcast(latestSlot);
            } else {
                showStatus('Inga sändningar idag ännu');
            }
            return;
        }

        if (elements.audioPlayer.paused) {
            stopAudioFocusKeepAlive();
            elements.audioPlayer.play().catch(error => {
                console.error('Playback error:', error);
                showStatus('Kunde inte spela upp ljudet', true);
            });
        } else {
            elements.audioPlayer.pause();
            startAudioFocusKeepAlive();
        }
    }

    /**
     * Skip time
     */
    function skipTime(seconds) {
        if (elements.audioPlayer.src) {
            elements.audioPlayer.currentTime = Math.max(
                0,
                Math.min(
                    elements.audioPlayer.duration || 0,
                    elements.audioPlayer.currentTime + seconds
                )
            );
        }
    }

    /**
     * Seek to position
     */
    function seekTo(event) {
        if (!elements.audioPlayer.src || !elements.audioPlayer.duration) return;

        const rect = elements.progressBar.getBoundingClientRect();
        const percent = (event.clientX - rect.left) / rect.width;
        elements.audioPlayer.currentTime = percent * elements.audioPlayer.duration;
    }

    /**
     * Update progress display
     */
    function updateProgress() {
        const current = elements.audioPlayer.currentTime || 0;
        const total = elements.audioPlayer.duration || 0;

        elements.currentTime.textContent = formatTime(current);
        elements.duration.textContent = formatTime(total);

        if (total > 0) {
            elements.progressFill.style.width = `${(current / total) * 100}%`;
        }
    }

    /**
     * Setup audio event listeners
     */
    function setupAudioListeners() {
        elements.audioPlayer.addEventListener('play', () => {
            elements.playPauseIcon.textContent = '\u23F8';
        });

        elements.audioPlayer.addEventListener('pause', () => {
            elements.playPauseIcon.textContent = '\u25B6';
        });

        elements.audioPlayer.addEventListener('timeupdate', () => {
            updateProgress();
            updateMediaSessionPosition();
        });

        elements.audioPlayer.addEventListener('loadedmetadata', () => {
            elements.duration.textContent = formatTime(elements.audioPlayer.duration);
            updateMediaSessionPosition();
        });

        elements.audioPlayer.addEventListener('ended', () => {
            state.currentSlot = null;
            elements.playPauseIcon.textContent = '\u25B6';
            elements.progressFill.style.width = '0%';
            renderTiles();
        });

        elements.audioPlayer.addEventListener('error', () => {
            showStatus('Fel vid uppspelning', true);
            stopPlayback();
        });
    }

    /**
     * Setup control listeners
     */
    function setupControlListeners() {
        elements.playPause.addEventListener('click', togglePlayPause);
        elements.skipBack.addEventListener('click', () => skipTime(-15));
        elements.skipForward.addEventListener('click', () => skipTime(15));
        elements.progressBar.addEventListener('click', seekTo);
    }

    /**
     * Setup Media Session API for headphone/lock screen controls
     */
    function setupMediaSession() {
        if (!('mediaSession' in navigator)) {
            console.log('Media Session API not supported');
            return;
        }

        // Play/Pause handlers
        navigator.mediaSession.setActionHandler('play', () => {
            stopAudioFocusKeepAlive();
            elements.audioPlayer.play();
        });

        navigator.mediaSession.setActionHandler('pause', () => {
            elements.audioPlayer.pause();
            startAudioFocusKeepAlive();
        });

        // Seek backward (previous track button = -15s)
        navigator.mediaSession.setActionHandler('previoustrack', () => {
            skipTime(-15);
        });

        // Seek forward (next track button = +15s)
        navigator.mediaSession.setActionHandler('nexttrack', () => {
            skipTime(15);
        });

        // Explicit seek handlers (for scrubbing on lock screen)
        navigator.mediaSession.setActionHandler('seekbackward', (details) => {
            const skipSeconds = details.seekOffset || 15;
            skipTime(-skipSeconds);
        });

        navigator.mediaSession.setActionHandler('seekforward', (details) => {
            const skipSeconds = details.seekOffset || 15;
            skipTime(skipSeconds);
        });

        // Seek to specific position
        navigator.mediaSession.setActionHandler('seekto', (details) => {
            if (details.seekTime !== undefined && elements.audioPlayer.duration) {
                elements.audioPlayer.currentTime = details.seekTime;
            }
        });

        // Stop handler
        navigator.mediaSession.setActionHandler('stop', () => {
            stopPlayback();
        });
    }

    /**
     * Update Media Session metadata for current broadcast
     */
    function updateMediaSessionMetadata(slot) {
        if (!('mediaSession' in navigator)) return;

        const broadcast = state.broadcasts[slot];
        const title = broadcast ? `Ekot ${slot}` : 'Ekot';

        navigator.mediaSession.metadata = new MediaMetadata({
            title: title,
            artist: 'Sveriges Radio',
            album: 'Ekot',
            artwork: [
                { src: 'assets/icon-96x96.png', sizes: '96x96', type: 'image/png' },
                { src: 'assets/icon-192x192.png', sizes: '192x192', type: 'image/png' },
                { src: 'assets/icon-512x512.png', sizes: '512x512', type: 'image/png' }
            ]
        });
    }

    /**
     * Update Media Session playback position state
     */
    function updateMediaSessionPosition() {
        if (!('mediaSession' in navigator)) return;
        if (!elements.audioPlayer.duration) return;

        try {
            navigator.mediaSession.setPositionState({
                duration: elements.audioPlayer.duration,
                playbackRate: elements.audioPlayer.playbackRate,
                position: elements.audioPlayer.currentTime
            });
        } catch (e) {
            // setPositionState may not be supported everywhere
        }
    }

    /**
     * Check for midnight reset
     */
    function setupMidnightCheck() {
        // Check every minute for day change
        setInterval(() => {
            if (checkDayChange()) {
                updateBroadcasts();
            }
        }, 60000);
    }

    /**
     * Initialize app
     */
    async function init() {
        // Cache DOM elements
        elements.tilesContainer = document.getElementById('tilesContainer');
        elements.audioPlayer = document.getElementById('audioPlayer');
        elements.silencePlayer = document.getElementById('silencePlayer');
        elements.playPause = document.getElementById('playPause');
        elements.playPauseIcon = document.getElementById('playPauseIcon');
        elements.skipBack = document.getElementById('skipBack');
        elements.skipForward = document.getElementById('skipForward');
        elements.currentTime = document.getElementById('currentTime');
        elements.duration = document.getElementById('duration');
        elements.progressBar = document.getElementById('progressBar');
        elements.progressFill = document.getElementById('progressFill');
        elements.nowPlaying = document.getElementById('nowPlaying');
        elements.statusMessage = document.getElementById('statusMessage');
        elements.dateDisplay = document.getElementById('dateDisplay');

        // Set initial date
        state.lastFetchDate = getStockholmDate();

        // Setup listeners
        setupAudioListeners();
        setupControlListeners();
        setupMediaSession();
        setupMidnightCheck();

        // Initial render (empty state)
        renderTiles();

        // Fetch initial data with cache-busting to ensure fresh data
        await updateBroadcasts(true);

        // Start polling
        schedulePoll();
    }

    // Start app when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
