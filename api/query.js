export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(req.body)
  });
  
  const data = await response.json();
  res.json(data);
}
```

4. Click **"Commit changes"**

---

### Part 4 — Update your HTML file

In your `index.html`, find every occurrence of:
```
https://api.anthropic.com/v1/messages
```
Replace each one with:
```
/api/query
