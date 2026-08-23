import json
from pathlib import Path
from datetime import datetime, timezone

jp = Path(r'D:/Git/MTGEDH/tools/on-cast-trigger-coverage.json')
data = json.loads(jp.read_text(encoding='utf-8'))

# inspect cluster shape
clusters = data.get('clusters')
print('clusters type', type(clusters), 'len', len(clusters) if hasattr(clusters,'__len__') else None)
if isinstance(clusters, list) and clusters:
    print('sample keys', clusters[0].keys())
    print('sample', {k: clusters[0].get(k) for k in list(clusters[0].keys())[:8]})
elif isinstance(clusters, dict):
    k=next(iter(clusters))
    print('dict sample', k, clusters[k])
