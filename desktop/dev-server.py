# Lab dev server: same as `python3 -m http.server`, but tells the webview
# never to cache, so a re-run of launch-aether-lab.sh always shows the new code.
# Usage: python3 dev-server.py <port> <root folder>
import functools, http.server, sys

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Expires', '0')
        super().end_headers()

port, root = int(sys.argv[1]), sys.argv[2]
http.server.ThreadingHTTPServer(('', port), functools.partial(NoCacheHandler, directory=root)).serve_forever()
