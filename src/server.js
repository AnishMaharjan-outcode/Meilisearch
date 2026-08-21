import express from 'express';
import dotenv from 'dotenv';
import routes from './routes/index.js';
import { startScheduler } from './services/scheduler.js';

dotenv.config({ path: ['.env.local', '.env'] });

const app = express();
app.use(express.json());

// Mount centralized routing tree
app.use('/', routes);

// Start the weekly cron scheduler
startScheduler();

// 404 Fallback Handler for unknown routes
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.originalUrl} does not exist.`
  });
});

const PORT = process.env.APP_PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});