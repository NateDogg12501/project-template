fetch('/api/health')
    .then((r) => r.json())
    .then((data) => console.log('backend health:', data))
