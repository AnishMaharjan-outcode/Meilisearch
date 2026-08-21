import fs from 'fs';
import path from 'path';

const LOG_FILE_PATH = path.join(process.cwd(), 'webhook.log');

/**
 * Appends a formatted message with a UTC timestamp and an optional context category tag to the log file and console.
 */
export function log(message, context = '') {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    
    let prefix = '';
    if (context) {
        prefix = `[${context.toUpperCase()}] `;
    }
    
    const formatted = `[${timestamp}] ${prefix}${message}`;
    console.log(`${prefix}${message}`);
    fs.appendFileSync(LOG_FILE_PATH, formatted + '\n', 'utf8');
}

/**
 * Appends a single newline to segment runs
 */
export function logSpacer() {
    fs.appendFileSync(LOG_FILE_PATH, '\n', 'utf8');
}

/**
 * Returns the absolute path of the webhook log file
 */
export function getLogFilePath() {
    return LOG_FILE_PATH;
}

/**
 * Checks if the log file exists
 */
export function logExists() {
    return fs.existsSync(LOG_FILE_PATH);
}
