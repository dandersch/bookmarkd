javascript:(async function(){
  /* 1. Configuration - EDIT THESE */
  const SERVER_URL = 'http://localhost:8081';
  const AUTH_USER = '';
  const AUTH_PASS = '';

  /* 2. Capture Page Info */
  const payload = {
    url: window.location.href,
    title: document.title,
    category: "Uncategorized"
  };

  /* 3. Prepare Auth Header */
  const headers = { 'Content-Type': 'application/json' };
  if (AUTH_USER && AUTH_PASS) {
    headers['Authorization'] = 'Basic ' + btoa(AUTH_USER + ':' + AUTH_PASS);
  }

  /* 4. Send the Request */
  try {
    const response = await fetch(`${SERVER_URL}/api/bookmarks`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      /* Quick visual feedback */
      const el = document.createElement('div');
      el.innerText = 'Saved to Bookmarkd!';
      Object.assign(el.style, {
        position: 'fixed', top: '20px', right: '20px', padding: '12px 24px',
        backgroundColor: '#1eb854', color: '#000', borderRadius: '8px',
        zIndex: '9999', fontFamily: 'system-ui, sans-serif', fontWeight: '600',
        boxShadow: '0 4px 16px rgba(0,0,0,0.25)', fontSize: '14px'
      });
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 2000);
    } else {
      alert('Error: ' + response.statusText);
    }
  } catch (err) {
    alert('Bookmarkd Error: ' + err.message + '\n(Check CORS settings on server)');
  }
})();
