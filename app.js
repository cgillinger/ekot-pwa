/**
 * Ekot PWA
 * Progressive web app for Sveriges Radio Ekot broadcasts
 * Talks directly to SR's open JSON API — no server proxy needed
 */

(function() {
    'use strict';

    const VERSION = APP_VERSION;
    console.log(`Ekot PWA v${VERSION}`);

    // Detect native HLS support (Safari on iOS/macOS)
    const hlsSupport = (function() {
        const a = document.createElement('audio');
        return a.canPlayType('application/vnd.apple.mpegurl') !== '' ||
               a.canPlayType('application/x-mpegURL') !== '';
    })();

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
        AUDIO_FOCUS_TIMEOUT: 15 * 60 * 1000,
        LIVE_STREAM_URLS: [
            'https://ljud1-cdn.sr.se/lc/p1.m3u8',
            'https://live1.sr.se/p1-aac-128',
            'https://live1.sr.se/p1-mp3-96'
        ],
        LIVE_WINDOW_MINUTES: 30,
        LIVE_STALL_TIMEOUT: 10000
    };

    // State
    const state = {
        broadcasts: {},
        currentSlot: null,
        lastFetchDate: null,
        pollTimer: null,
        audioFocusTimer: null,
        isPaused: false,
        isLive: false,
        liveStreamIndex: 0,
        liveStallTimer: null
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
        silencePlayer: null,
        playerContainer: null
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

    function getPlaybackRange() {
        if (state.isLive) {
            const seekable = elements.audioPlayer.seekable;
            if (seekable.length === 0) return null;
            const start = seekable.start(0);
            const end = seekable.end(seekable.length - 1);
            if (end - start < 1) return null;
            return { start, end };
        }
        const dur = elements.audioPlayer.duration;
        if (!dur) return null;
        return { start: 0, end: dur };
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
            const wasLive = state.isLive;
            const liveSlot = wasLive ? state.currentSlot : null;

            Object.assign(state.broadcasts, newBroadcasts);
            state.lastFetchDate = getStockholmDate();
            renderTiles();

            // Auto-switch from live to podcast when available
            if (wasLive && liveSlot && newBroadcasts[liveSlot]) {
                showStatus('Podd tillgänglig — byter från live', false, 4000);
                playBroadcast(liveSlot);
            }
        }
    }

    // --- Polling ---

    function calculatePollInterval() {
        if (state.isLive) {
            return CONFIG.POLL_INTERVALS.ACTIVE;
        }

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

    // --- Live stream ---

    function isSlotLiveNow(slotTime) {
        if (state.broadcasts[slotTime]) return false;

        const { hour, minute } = getStockholmHourMinute();
        const currentMinutes = hour * 60 + minute;
        const [slotHour, slotMinute] = slotTime.split(':').map(Number);
        const slotStartMinutes = slotHour * 60 + slotMinute;

        const diff = currentMinutes - slotStartMinutes;
        return diff >= 0 && diff <= CONFIG.LIVE_WINDOW_MINUTES;
    }

    function findLiveSlot() {
        for (const slot of CONFIG.SLOTS) {
            if (isSlotLiveNow(slot.time)) {
                return slot.time;
            }
        }
        return null;
    }

    function updatePlayerForLiveMode(isLive) {
        elements.playerContainer.classList.toggle('live-mode', isLive);
        if (!isLive) {
            elements.playerContainer.classList.remove('live-seekable');
        }
        if (isLive) {
            elements.currentTime.textContent = 'LIVE';
            elements.duration.textContent = '';
            elements.progressFill.style.width = '100%';
        } else {
            elements.currentTime.textContent = '0:00';
            elements.duration.textContent = '0:00';
            elements.progressFill.style.width = '0%';
        }
    }

    function clearLiveStallTimer() {
        if (state.liveStallTimer) {
            clearTimeout(state.liveStallTimer);
            state.liveStallTimer = null;
        }
    }

    function playLiveStream(slot) {
        stopAudioFocusKeepAlive();
        clearLiveStallTimer();

        state.currentSlot = slot;
        state.isLive = true;
        state.isPaused = false;
        state.liveStreamIndex = 0;

        updateMediaSessionMetadata(slot);
        elements.nowPlaying.textContent = `Ekot ${slot} — LIVE`;
        updatePlayerForLiveMode(true);
        renderTiles();

        tryNextLiveStream();

        // Poll actively to detect podcast availability
        schedulePoll();
    }

    function tryNextLiveStream() {
        clearLiveStallTimer();

        if (state.liveStreamIndex >= CONFIG.LIVE_STREAM_URLS.length) {
            showStatus('Kunde inte starta liveström', true);
            stopPlayback();
            return;
        }

        const streamUrl = CONFIG.LIVE_STREAM_URLS[state.liveStreamIndex];

        // Skip HLS if browser doesn't support it natively (Safari only)
        if (streamUrl.endsWith('.m3u8') && !hlsSupport) {
            state.liveStreamIndex++;
            tryNextLiveStream();
            return;
        }

        // Stall timeout: if no 'playing' event fires within limit, try next
        state.liveStallTimer = setTimeout(() => {
            console.log('Live stream stalled:', streamUrl);
            state.liveStreamIndex++;
            tryNextLiveStream();
        }, CONFIG.LIVE_STALL_TIMEOUT);

        const onPlaying = () => {
            clearLiveStallTimer();
            elements.audioPlayer.removeEventListener('playing', onPlaying);
        };
        elements.audioPlayer.addEventListener('playing', onPlaying);

        elements.audioPlayer.src = streamUrl;
        elements.audioPlayer.play().catch(() => {
            clearLiveStallTimer();
            elements.audioPlayer.removeEventListener('playing', onPlaying);
            state.liveStreamIndex++;
            tryNextLiveStream();
        });
    }

    // --- Rendering ---

    function renderTiles() {
        const latestSlot = findLatestBroadcast();
        const sortedSlots = getSortedSlots();

        elements.tilesContainer.innerHTML = '';

        sortedSlots.forEach(slot => {
            const broadcast = state.broadcasts[slot];
            const isLive = (!broadcast && isSlotLiveNow(slot)) ||
                           (state.isLive && state.currentSlot === slot && !broadcast);
            const isActive = !!broadcast;
            const isLatest = slot === latestSlot;
            const isPlaying = state.currentSlot === slot;

            const tile = document.createElement('div');
            tile.className = 'tile';
            tile.classList.toggle('active', isActive || isLive);
            tile.classList.toggle('inactive', !isActive && !isLive);
            tile.classList.toggle('live', isLive);
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
            } else if (isLive) {
                tile.addEventListener('click', () => playLiveStream(slot));
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
        clearLiveStallTimer();

        state.currentSlot = slot;
        state.isLive = false;
        state.isPaused = false;
        updatePlayerForLiveMode(false);

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
        clearLiveStallTimer();
        elements.audioPlayer.pause();
        elements.audioPlayer.src = '';
        state.currentSlot = null;
        state.isLive = false;
        state.isPaused = false;
        updatePlayerForLiveMode(false);
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
            const liveSlot = findLiveSlot();
            const latestSlot = findLatestBroadcast();
            if (liveSlot) {
                playLiveStream(liveSlot);
            } else if (latestSlot) {
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
            if (!state.isLive) {
                startAudioFocusKeepAlive();
            }
        }
    }

    function skipTime(seconds) {
        if (!elements.audioPlayer.src) return;
        const range = getPlaybackRange();
        if (!range) return;
        elements.audioPlayer.currentTime = Math.max(
            range.start,
            Math.min(range.end, elements.audioPlayer.currentTime + seconds)
        );
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
        if (!elements.audioPlayer.src) return;
        if (!getPlaybackRange()) return;
        seekState.dragging = true;
        elements.progressBar.classList.add('seeking');
        onSeekMove(event);
    }

    function onSeekMove(event) {
        if (!seekState.dragging) return;
        event.preventDefault();
        const clientX = event.touches ? event.touches[0].clientX : event.clientX;
        const percent = getSeekPercent(clientX);
        elements.progressFill.style.width = `${percent * 100}%`;
        const range = getPlaybackRange();
        if (range) {
            const total = range.end - range.start;
            if (state.isLive) {
                const behind = total * (1 - percent);
                elements.currentTime.textContent = behind < 5 ? 'LIVE' : '\u2212' + formatTime(behind);
            } else {
                elements.currentTime.textContent = formatTime(percent * total);
            }
        }
    }

    function onSeekEnd(event) {
        if (!seekState.dragging) return;
        seekState.dragging = false;
        elements.progressBar.classList.remove('seeking');
        const range = getPlaybackRange();
        if (!range) return;
        const clientX = event.changedTouches
            ? event.changedTouches[0].clientX
            : event.clientX;
        const percent = getSeekPercent(clientX);
        elements.audioPlayer.currentTime = range.start + percent * (range.end - range.start);
    }

    function updateProgress() {
        if (seekState.dragging) return;

        if (state.isLive) {
            const seekable = elements.audioPlayer.seekable;
            const hasRange = seekable.length > 0 &&
                (seekable.end(seekable.length - 1) - seekable.start(0)) > 15;
            elements.playerContainer.classList.toggle('live-seekable', hasRange);

            if (seekable.length === 0) return;

            const start = seekable.start(0);
            const end = seekable.end(seekable.length - 1);
            const current = elements.audioPlayer.currentTime;
            const behind = end - current;

            elements.currentTime.textContent = behind < 5 ? 'LIVE' : '\u2212' + formatTime(behind);
            elements.duration.textContent = 'LIVE';

            const total = end - start;
            if (total > 0) {
                elements.progressFill.style.width = `${((current - start) / total) * 100}%`;
            }
            return;
        }

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
            if (!state.isLive) {
                elements.duration.textContent = formatTime(elements.audioPlayer.duration);
            }
            updateMediaSessionPosition();
        });

        elements.audioPlayer.addEventListener('ended', () => {
            state.currentSlot = null;
            state.isLive = false;
            elements.playPauseIcon.textContent = '\u25B6';
            elements.progressFill.style.width = '0%';
            updatePlayerForLiveMode(false);
            renderTiles();
        });

        elements.audioPlayer.addEventListener('error', () => {
            if (state.isLive) {
                clearLiveStallTimer();
                state.liveStreamIndex++;
                tryNextLiveStream();
                return;
            }
            showStatus('Fel vid uppspelning', true);
            stopPlayback();
        });

        // Stalled: browser stopped receiving data on live stream
        elements.audioPlayer.addEventListener('stalled', () => {
            if (state.isLive && !state.liveStallTimer) {
                state.liveStallTimer = setTimeout(() => {
                    console.log('Live stream stalled during playback');
                    state.liveStreamIndex++;
                    tryNextLiveStream();
                }, CONFIG.LIVE_STALL_TIMEOUT);
            }
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
            if (!state.isLive) {
                startAudioFocusKeepAlive();
            }
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
            if (details.seekTime === undefined) return;
            const range = getPlaybackRange();
            if (!range) return;
            elements.audioPlayer.currentTime = range.start + Math.max(0, Math.min(range.end - range.start, details.seekTime));
        });

        navigator.mediaSession.setActionHandler('stop', () => stopPlayback());
    }

    function updateMediaSessionMetadata(slot) {
        if (!('mediaSession' in navigator)) return;

        const title = state.isLive ? `Ekot ${slot} — LIVE` : `Ekot ${slot}`;
        navigator.mediaSession.metadata = new MediaMetadata({
            title,
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
        const range = getPlaybackRange();
        if (!range) return;
        const duration = range.end - range.start;
        if (duration <= 0) return;

        try {
            navigator.mediaSession.setPositionState({
                duration: duration,
                playbackRate: elements.audioPlayer.playbackRate,
                position: Math.min(duration, Math.max(0, elements.audioPlayer.currentTime - range.start))
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
            // Re-render tiles to update live status indicators
            renderTiles();
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
        elements.playerContainer = document.getElementById('playerContainer');

        const versionLabel = document.getElementById('versionLabel');
        if (versionLabel) versionLabel.textContent = 'v' + VERSION;

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
