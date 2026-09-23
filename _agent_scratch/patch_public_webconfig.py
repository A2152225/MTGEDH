from pathlib import Path
p = Path(r"D:\Git\MTGEDH\client\public\web.config")
w = p.read_text(encoding="utf-8")
if 'name="ReverseProxyAdmin"' in w:
    print("already patched")
else:
    old = '''        <!-- 2) Proxy /socket.io/* to local Node server (WebSocket + polling) -->
        <rule name="ReverseProxySocketIO" stopProcessing="true">
          <match url="^socket\\.io/(.*)" />
          <action type="Rewrite" url="http://127.0.0.1:3001/socket.io/{R:1}" appendQueryString="true" />
        </rule>

        <!-- 3) If file/directory exists serve it; otherwise fallback to index.html for SPA routing -->
        <rule name="SPA-Fallback" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll">
            <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />
            <add input="{REQUEST_FILENAME}" matchType="IsDirectory" negate="true" />
            <add input="{REQUEST_URI}" pattern="^/api" negate="true" />
            <add input="{REQUEST_URI}" pattern="^/socket\\.io" negate="true" />
          </conditions>
          <action type="Rewrite" url="/index.html" />
        </rule>'''
    new = '''        <!-- 2) Proxy /socket.io/* to local Node server (WebSocket + polling) -->
        <rule name="ReverseProxySocketIO" stopProcessing="true">
          <match url="^socket\\.io/(.*)" />
          <action type="Rewrite" url="http://127.0.0.1:3001/socket.io/{R:1}" appendQueryString="true" />
        </rule>

        <!-- 2b) Proxy /admin/* to Node (game delete etc.). Without this, DELETE /admin hits SPA and IIS returns verb-not-allowed. -->
        <rule name="ReverseProxyAdmin" stopProcessing="true">
          <match url="^admin/(.*)" />
          <action type="Rewrite" url="http://127.0.0.1:3001/admin/{R:1}" appendQueryString="true" />
        </rule>

        <!-- 3) If file/directory exists serve it; otherwise fallback to index.html for SPA routing -->
        <rule name="SPA-Fallback" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll">
            <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />
            <add input="{REQUEST_FILENAME}" matchType="IsDirectory" negate="true" />
            <add input="{REQUEST_URI}" pattern="^/api" negate="true" />
            <add input="{REQUEST_URI}" pattern="^/admin" negate="true" />
            <add input="{REQUEST_URI}" pattern="^/socket\\.io" negate="true" />
          </conditions>
          <action type="Rewrite" url="/index.html" />
        </rule>'''
    if old not in w:
        raise SystemExit("public web.config block not found")
    p.write_text(w.replace(old, new, 1), encoding="utf-8")
    print("patched client/public/web.config")
