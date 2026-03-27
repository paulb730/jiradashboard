import express from 'express';
import { createServer as createViteServer } from 'vite';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API routes FIRST
  app.post('/api/jira/worklogs', async (req, res) => {
    try {
      const { jiraUrl, projects, users, startDate, endDate } = req.body;

      if (!jiraUrl || !projects || !startDate || !endDate) {
        return res.status(400).json({ error: 'Missing required parameters' });
      }

      // Remove trailing slash from jiraUrl if present
      const baseUrl = jiraUrl.replace(/\/$/, '');

      const headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      };

      // 1. Search issues
      const projectKeys = projects.split(',').map((p: string) => `"${p.trim()}"`).join(',');
      const jql = `project in (${projectKeys}) AND worklogDate >= "${startDate}" AND worklogDate <= "${endDate}"`;
      
      const searchRes = await fetch(`${baseUrl}/rest/api/2/search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jql,
          fields: ['summary', 'project'],
          maxResults: 100 // For simplicity, we limit to 100 issues. A real app would paginate.
        })
      });

      const contentType = searchRes.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await searchRes.text();
        throw new Error(`Expected JSON from Jira, but received HTML. This usually means the Jira instance requires authentication (login page returned) or the URL is incorrect. Status: ${searchRes.status}`);
      }

      if (!searchRes.ok) {
        const text = await searchRes.text();
        throw new Error(`Jira API error: ${searchRes.status} ${text}`);
      }

      const searchData = await searchRes.json();
      const issues = searchData.issues || [];

      // 2. Fetch worklogs for each issue
      const worklogs = [];
      const targetUsers = users ? users.split(',').map((u: string) => u.trim().toLowerCase()).filter(Boolean) : [];

      for (const issue of issues) {
        const wlRes = await fetch(`${baseUrl}/rest/api/2/issue/${issue.key}/worklog`, {
          headers
        });
        
        const wlContentType = wlRes.headers.get('content-type');
        if (wlRes.ok && wlContentType && wlContentType.includes('application/json')) {
          const wlData = await wlRes.json();
          for (const wl of wlData.worklogs) {
            const wlDate = wl.started.substring(0, 10);
            if (wlDate >= startDate && wlDate <= endDate) {
              const authorEmail = wl.author.emailAddress?.toLowerCase() || '';
              const authorName = wl.author.displayName?.toLowerCase() || '';
              
              // If users are specified, filter by them
              let matchUser = true;
              if (targetUsers.length > 0) {
                matchUser = targetUsers.some((u: string) => 
                  authorEmail.includes(u) || authorName.includes(u)
                );
              }

              if (matchUser) {
                worklogs.push({
                  id: wl.id,
                  issueKey: issue.key,
                  issueSummary: issue.fields.summary,
                  projectName: issue.fields.project.name,
                  author: wl.author.displayName,
                  authorEmail: wl.author.emailAddress,
                  timeSpentSeconds: wl.timeSpentSeconds,
                  date: wlDate,
                  comment: typeof wl.comment === 'string' ? wl.comment : 'Complex comment format'
                });
              }
            }
          }
        }
      }

      res.json({ worklogs });
    } catch (error: any) {
      console.error('Error fetching Jira data:', error);
      res.status(500).json({ error: error.message || 'Internal server error' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
