/**
 * Ekot Web App Server
 * Minimal Node.js server for static files and RSS proxy
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8095;
const RSS_URL = 'https://api.sr.se/api/rss/pod/3795';

// MIME types for static files
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml'
};

/**
 * Fetch RSS from Sveriges Radio
 */
function fetchRss(reqHeaders, callback) {
    const options = {
        hostname: 'api.sr.se',
        port: 443,
        path: '/api/rss/pod/3795',
        method: 'GET',
        headers: {
            'User-Agent': 'EkotWebApp/1.0'
        }
    };

    // Forward conditional headers
    if (reqHeaders['if-modified-since']) {
        options.headers['If-Modified-Since'] = reqHeaders['if-modified-since'];
    }
    if (reqHeaders['if-none-match']) {
        options.headers['If-None-Match'] = reqHeaders['if-none-match'];
    }

    const req = https.request(options, (res) => {
        let data = '';

        res.on('data', chunk => {
            data += chunk;
        });

        res.on('end', () => {
            callback(null, {
                statusCode: res.statusCode,
                headers: res.headers,
                body: data
            });
        });
    });

    req.on('error', (error) => {
        callback(error, null);
    });

    req.end();
}

/**
 * Serve static file
 */
function serveStatic(filePath, res) {
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not Found');
            return;
        }

        const ext = path.extname(filePath);
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
}

/**
 * Handle requests
 */
function handleRequest(req, res) {
    const url = req.url.split('?')[0];

    // Handle RSS proxy
    if (url === '/api/rss') {
        fetchRss(req.headers, (error, response) => {
            if (error) {
                res.writeHead(500);
                res.end('Error fetching RSS');
                return;
            }

            const headers = {
                'Content-Type': 'application/rss+xml; charset=utf-8',
                'Access-Control-Allow-Origin': '*'
            };

            // Forward cache headers
            if (response.headers['etag']) {
                headers['ETag'] = response.headers['etag'];
            }
            if (response.headers['last-modified']) {
                headers['Last-Modified'] = response.headers['last-modified'];
            }

            res.writeHead(response.statusCode, headers);
            res.end(response.body);
        });
        return;
    }

    // Serve static files
    let filePath = path.join(__dirname, url === '/' ? 'index.html' : url);

    // Security: prevent directory traversal
    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    // Check if file exists
    fs.access(filePath, fs.constants.F_OK, (err) => {
        if (err) {
            // Try adding .html extension
            if (!path.extname(filePath)) {
                filePath += '.html';
                fs.access(filePath, fs.constants.F_OK, (err2) => {
                    if (err2) {
                        res.writeHead(404);
                        res.end('Not Found');
                    } else {
                        serveStatic(filePath, res);
                    }
                });
            } else {
                res.writeHead(404);
                res.end('Not Found');
            }
        } else {
            serveStatic(filePath, res);
        }
    });
}

// Create and start server
const server = http.createServer(handleRequest);

server.listen(PORT, () => {
    console.log(`Ekot server running at http://localhost:${PORT}`);
    console.log('Press Ctrl+C to stop');
});
