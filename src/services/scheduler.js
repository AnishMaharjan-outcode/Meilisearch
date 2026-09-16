import cron from 'node-cron';
import { executeCatalogSync } from '../routes/sync.js';
import { log } from './logger.js';

export function startScheduler() {
    console.log('📅 Scheduler service initialized.');

    // Schedule: Every Saturday at 1:00 AM America/New_York (Richmond, VA timezone)
    // Cron syntax: '0 1 * * 6' ➜ Minute 0, Hour 1 (1:00 AM), Day-of-month *, Month *, Day-of-week 6 (Saturday)
    cron.schedule('0 1 * * 6', async () => {
        log('⏰ Starting scheduled weekly full catalog sync...', 'CRON-SYNC');
        try {
            await executeCatalogSync('CRON-SYNC');
        } catch (error) {
            log(`⚠️ Scheduled full catalog sync could not run: ${error.message}`, 'CRON-SYNC');
        }
    }, {
        scheduled: true,
        timezone: "America/New_York"
    });
}
