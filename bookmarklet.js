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
        position: 'fixed', top: '20px', right: '20px', padding: '10px 20px',
        backgroundColor: '#4f46e5', color: 'white', borderRadius: '5px',
        zIndex: '9999', fontFamily: 'sans-serif', boxShadow: '0 2px 10px rgba(0,0,0,0.2)'
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
