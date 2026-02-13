/**
 * Ekot PWA v2.1.6
 * Progressive web app for Sveriges Radio Ekot broadcasts
 * Talks directly to SR's open JSON API — no server proxy needed
 */

(function() {
    'use strict';

    const VERSION = '2.1.6';
    console.log(`Ekot PWA v${VERSION}`);

    // Configuration
    const CONFIG = {
        API_URL: 'https://api.sr.se/api/v2/podfiles?programid=4540&format=json&size=20',
        TIMEZONE: 'Europe/Stockholm',
        SLOTS: [
            { time: '08:00', pollStart: { hour: 8, minute: 20 } },
            { time: '12:30', pollStart: { hour: 13, minute: 0 } },
            { time: '16:45', pollStart: { hour: 17, minute: 5 } },
            { time: '17:45', pollStart: { hour: 18, minute: 10 } }
        ],
        POLL_INTERVALS: {
            ACTIVE: 60000,
            EXTENDED: 300000,
            IDLE: 1800000
        },
        ACTIVE_WINDOW: 10,
        EXTENDED_WINDOW: 30,
        AUDIO_FOCUS_TIMEOUT: 15 * 60 * 1000
    };

    // State
    const state = {
        broadcasts: {},
        currentSlot: null,
        lastFetchDate: null,
        pollTimer: null,
        audioFocusTimer: null,
        isPaused: false
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

    // --- Utility functions ---

    function getStockholmDate() {
        return new Date().toLocaleDateString('sv-SE', { timeZone: CONFIG.TIMEZONE });
    }

    function getStockholmHourMinute() {
        const timeStr = new Date().toLocaleTimeString('sv-SE', {
            timeZone: CONFIG.TIMEZONE,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
        const [hour, minute] = timeStr.split(':').map(Number);
        return { hour, minute };
    }

    function extractSlotFromTitle(title) {
        for (const slot of CONFIG.SLOTS) {
            if (title.includes(slot.time)) {
                return slot.time;
            }
        }
        return null;
    }

    function formatTime(seconds) {
        if (isNaN(seconds) || !isFinite(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    function showStatus(message, isError = false, duration = 3000) {
        elements.statusMessage.textContent = message;
        elements.statusMessage.classList.toggle('error', isError);
        elements.statusMessage.classList.add('visible');
        setTimeout(() => {
            elements.statusMessage.classList.remove('visible');
        }, duration);
    }

    // --- Date parsing for SR JSON API ---

    /**
     * Parse SR API date format "/Date(1770620400000)/" to Date object
     */
    function parseSrDate(srDateStr) {
        const match = srDateStr.match(/\/Date\((\d+)\)\//);
        if (match) {
            return new Date(parseInt(match[1], 10));
        }
        return new Date(srDateStr);
    }

    function srDateToStockholmDate(srDateStr) {
        const date = parseSrDate(srDateStr);
        return date.toLocaleDateString('sv-SE', { timeZone: CONFIG.TIMEZONE });
    }

    // --- Data fetching ---

    /**
     * Parse JSON response from SR API into broadcasts object
     */
    function parseApiResponse(data) {
        const todayStr = getStockholmDate();
        const broadcasts = {};

        if (!data.podfiles) return broadcasts;

        for (const podfile of data.podfiles) {
            const title = podfile.title || '';
            const publishDate = podfile.publishdateutc || '';
            const audioUrl = podfile.url || '';

            // Only process items from today
            const itemDate = srDateToStockholmDate(publishDate);
            if (itemDate !== todayStr) continue;

            // Extract slot from title
            const slot = extractSlotFromTitle(title);
            if (!slot) continue;

            broadcasts[slot] = {
                title,
                pubDate: publishDate,
                timestamp: parseSrDate(publishDate).getTime(),
                audioUrl,
                slot
            };
        }

        return broadcasts;
    }

    /**
     * Fetch broadcasts from SR JSON API
     */
    async function fetchBroadcasts(forceRefresh = false) {
        try {
            const url = forceRefresh
                ? `${CONFIG.API_URL}&_=${Date.now()}`
                : CONFIG.API_URL;

            const response = await fetch(url, {
                cache: forceRefresh ? 'no-store' : 'default'
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            return parseApiResponse(data);
        } catch (error) {
            console.error('Failed to fetch broadcasts:', error);
            showStatus('Kunde inte hämta sändningar', true);
            return null;
        }
    }

    // --- Broadcast state management ---

    function resetForNewDay() {
        state.broadcasts = {};
        state.currentSlot = null;
        state.lastFetchDate = getStockholmDate();
        stopPlayback();
        renderTiles();
    }

    function checkDayChange() {
        const currentDate = getStockholmDate();
        if (state.lastFetchDate && state.lastFetchDate !== currentDate) {
            resetForNewDay();
            return true;
        }
        return false;
    }

    async function updateBroadcasts(forceRefresh = false) {
        checkDayChange();

        const newBroadcasts = await fetchBroadcasts(forceRefresh);
        if (newBroadcasts) {
            Object.assign(state.broadcasts, newBroadcasts);
            state.lastFetchDate = getStockholmDate();
            renderTiles();
        }
    }

    // --- Polling ---

    function calculatePollInterval() {
        const { hour, minute } = getStockholmHourMinute();
        const currentMinutes = hour * 60 + minute;

        for (const slot of CONFIG.SLOTS) {
            const pollStartMinutes = slot.pollStart.hour * 60 + slot.pollStart.minute;
            const diff = currentMinutes - pollStartMinutes;

            if (!state.broadcasts[slot.time]) {
                if (diff >= 0 && diff <= CONFIG.ACTIVE_WINDOW) {
                    return CONFIG.POLL_INTERVALS.ACTIVE;
                }
                if (diff > CONFIG.ACTIVE_WINDOW && diff <= CONFIG.EXTENDED_WINDOW) {
                    return CONFIG.POLL_INTERVALS.EXTENDED;
                }
            }
        }

        return CONFIG.POLL_INTERVALS.IDLE;
    }

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

    // --- Broadcast helpers ---

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

    function getSortedSlots() {
        const latestSlot = findLatestBroadcast();
        const slotTimes = CONFIG.SLOTS.map(s => s.time);

        // Counter-clockwise ring layout:
        //   TL | TR      ring[0] | ring[3]
        //   BL | BR  =>  ring[1] | ring[2]
        // When a new broadcast arrives, the ring rotates clockwise
        // so the latest always lands in top-left.

        // Build the ring in chronological order starting from latest
        let ring;
        if (latestSlot) {
            const index = slotTimes.indexOf(latestSlot);
            ring = slotTimes.slice(index).concat(slotTimes.slice(0, index));
        } else {
            ring = slotTimes;
        }

        // Map ring positions to grid order (left-to-right, top-to-bottom)
        // ring[0]=TL, ring[1]=BL, ring[2]=BR, ring[3]=TR
        return [ring[0], ring[3], ring[1], ring[2]];
    }

    // --- Rendering ---

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
            tile.classList.toggle('paused', isPlaying && state.isPaused);
            tile.dataset.slot = slot;

            const icon = document.createElement('img');
            icon.className = 'tile-icon';
            icon.src = 'assets/icon-tile-384x384.png';
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

        updateDateDisplay();
    }

    function updateDateDisplay() {
        const options = {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            timeZone: CONFIG.TIMEZONE
        };
        elements.dateDisplay.textContent = new Date().toLocaleDateString('sv-SE', options);
    }

    // --- Audio playback ---

    function playBroadcast(slot) {
        const broadcast = state.broadcasts[slot];
        if (!broadcast || !broadcast.audioUrl) {
            showStatus('Ingen sändning tillgänglig', true);
            return;
        }

        stopAudioFocusKeepAlive();

        state.currentSlot = slot;
        state.isPaused = false;

        elements.audioPlayer.src = broadcast.audioUrl;
        elements.audioPlayer.play().catch(error => {
            console.error('Playback error:', error);
            showStatus('Kunde inte spela upp ljudet', true);
        });

        updateMediaSessionMetadata(slot);
        elements.nowPlaying.textContent = `Ekot ${slot}`;
        renderTiles();
    }

    function stopPlayback() {
        stopAudioFocusKeepAlive();
        elements.audioPlayer.pause();
        elements.audioPlayer.src = '';
        state.currentSlot = null;
        state.isPaused = false;
        elements.nowPlaying.textContent = 'Ingen uppspelning';
        elements.playPauseIcon.textContent = '\u25B6';
        elements.currentTime.textContent = '0:00';
        elements.duration.textContent = '0:00';
        elements.progressFill.style.width = '0%';
        renderTiles();
    }

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

    function stopAudioFocusKeepAlive() {
        if (state.audioFocusTimer) {
            clearTimeout(state.audioFocusTimer);
            state.audioFocusTimer = null;
        }
        elements.silencePlayer.pause();
        elements.silencePlayer.src = '';
    }

    function togglePlayPause() {
        if (!elements.audioPlayer.src) {
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

    // --- Seekbar drag ---

    const seekState = { dragging: false };

    function getSeekPercent(clientX) {
        const rect = elements.progressBar.getBoundingClientRect();
        return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    }

    function seekTo(event) {
        if (!elements.audioPlayer.src || !elements.audioPlayer.duration) return;
        const clientX = event.touches ? event.touches[0].clientX : event.clientX;
        const percent = getSeekPercent(clientX);
        elements.audioPlayer.currentTime = percent * elements.audioPlayer.duration;
    }

    function onSeekStart(event) {
        if (!elements.audioPlayer.src || !elements.audioPlayer.duration) return;
        seekState.dragging = true;
        elements.progressBar.classList.add('seeking');
        onSeekMove(event);
    }

    function onSeekMove(event) {
        if (!seekState.dragging) return;
        event.preventDefault();
        const clientX = event.touches ? event.touches[0].clientX : event.clientX;
        const percent = getSeekPercent(clientX);
        // Update visual immediately during drag (no audio seek yet for smoothness)
        elements.progressFill.style.width = `${percent * 100}%`;
        const total = elements.audioPlayer.duration || 0;
        elements.currentTime.textContent = formatTime(percent * total);
    }

    function onSeekEnd(event) {
        if (!seekState.dragging) return;
        seekState.dragging = false;
        elements.progressBar.classList.remove('seeking');
        if (!elements.audioPlayer.src || !elements.audioPlayer.duration) return;
        // Determine final position from the last known position
        const clientX = event.changedTouches
            ? event.changedTouches[0].clientX
            : event.clientX;
        const percent = getSeekPercent(clientX);
        elements.audioPlayer.currentTime = percent * elements.audioPlayer.duration;
    }

    function updateProgress() {
        const current = elements.audioPlayer.currentTime || 0;
        const total = elements.audioPlayer.duration || 0;

        elements.currentTime.textContent = formatTime(current);
        elements.duration.textContent = formatTime(total);

        if (total > 0) {
            elements.progressFill.style.width = `${(current / total) * 100}%`;
        }
    }

    // --- Event listeners ---

    function setupAudioListeners() {
        elements.audioPlayer.addEventListener('play', () => {
            elements.playPauseIcon.textContent = '\u23F8';
            state.isPaused = false;
            renderTiles();
        });

        elements.audioPlayer.addEventListener('pause', () => {
            elements.playPauseIcon.textContent = '\u25B6';
            if (state.currentSlot) {
                state.isPaused = true;
                renderTiles();
            }
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

    function setupControlListeners() {
        elements.playPause.addEventListener('click', togglePlayPause);
        elements.skipBack.addEventListener('click', () => skipTime(-15));
        elements.skipForward.addEventListener('click', () => skipTime(15));

        // Seekbar: mouse drag
        elements.progressBar.addEventListener('mousedown', onSeekStart);
        document.addEventListener('mousemove', onSeekMove);
        document.addEventListener('mouseup', onSeekEnd);

        // Seekbar: touch drag
        elements.progressBar.addEventListener('touchstart', onSeekStart, { passive: false });
        document.addEventListener('touchmove', onSeekMove, { passive: false });
        document.addEventListener('touchend', onSeekEnd);
    }

    // --- Media Session API ---

    function setupMediaSession() {
        if (!('mediaSession' in navigator)) return;

        navigator.mediaSession.setActionHandler('play', () => {
            stopAudioFocusKeepAlive();
            elements.audioPlayer.play();
        });

        navigator.mediaSession.setActionHandler('pause', () => {
            elements.audioPlayer.pause();
            startAudioFocusKeepAlive();
        });

        navigator.mediaSession.setActionHandler('previoustrack', () => skipTime(-15));
        navigator.mediaSession.setActionHandler('nexttrack', () => skipTime(15));

        navigator.mediaSession.setActionHandler('seekbackward', (details) => {
            skipTime(-(details.seekOffset || 15));
        });

        navigator.mediaSession.setActionHandler('seekforward', (details) => {
            skipTime(details.seekOffset || 15);
        });

        navigator.mediaSession.setActionHandler('seekto', (details) => {
            if (details.seekTime !== undefined && elements.audioPlayer.duration) {
                elements.audioPlayer.currentTime = details.seekTime;
            }
        });

        navigator.mediaSession.setActionHandler('stop', () => stopPlayback());
    }

    function updateMediaSessionMetadata(slot) {
        if (!('mediaSession' in navigator)) return;

        navigator.mediaSession.metadata = new MediaMetadata({
            title: `Ekot ${slot}`,
            artist: 'Sveriges Radio',
            album: 'Ekot',
            artwork: [
                { src: 'assets/icon-96x96.png', sizes: '96x96', type: 'image/png' },
                { src: 'assets/icon-192x192.png', sizes: '192x192', type: 'image/png' },
                { src: 'assets/icon-512x512.png', sizes: '512x512', type: 'image/png' }
            ]
        });
    }

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

    // --- Midnight reset ---

    function setupMidnightCheck() {
        setInterval(() => {
            if (checkDayChange()) {
                updateBroadcasts();
            }
        }, 60000);
    }

    // --- Initialize ---

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

        state.lastFetchDate = getStockholmDate();

        setupAudioListeners();
        setupControlListeners();
        setupMediaSession();
        setupMidnightCheck();

        renderTiles();

        await updateBroadcasts(true);

        schedulePoll();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
