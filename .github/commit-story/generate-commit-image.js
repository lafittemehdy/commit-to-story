const dotenv = require('dotenv');
const fsSync = require('fs'); // Synchronous fs for existsSync
const path = require('path');
const fs = require('fs').promises; // Keep fs.promises for async operations

// Load environment variables for local development:
// 1. Try to load from '.env' (user's local, gitignored overrides).
// 2. If '.env' is not found, try to load from '.env.development' (committed defaults).
// In GitHub Actions, these are ignored; variables from the workflow 'env' context are used.

const userEnvPath = path.resolve(process.cwd(), '.env');
const developmentEnvPath = path.resolve(process.cwd(), '.env.development');

if (fsSync.existsSync(userEnvPath)) {
  dotenv.config({ path: userEnvPath });
  console.log("Loaded environment variables from local .env file.");
} else if (fsSync.existsSync(developmentEnvPath)) {
  dotenv.config({ path: developmentEnvPath });
  console.log("Local .env file not found. Loaded default environment variables from .env.development.");
} else {
  // This case is mostly for local dev if neither file exists (and .env.development wasn't committed).
  // In GitHub Actions, env vars are set directly, so this warning isn't critical there.
  console.warn("Warning: Neither .env nor .env.development found. Script relies on environment variables being set externally.");
}

const puppeteer = require('puppeteer');

// --- Configuration ---
const config = {
    width: 1080,
    height: 1920,
    templatePath: path.join(__dirname, 'commit-story-template.html'),
};

// --- Get Data from Environment Variables ---
const commitMessageRaw = process.env.COMMIT_MESSAGE || 'No commit message found';
const commitShaFull = process.env.COMMIT_SHA_FULL || 'N/A';
const filesChanged = process.env.FILES_CHANGED || '0';
const linesAdded = process.env.LINES_ADDED || '0';
const linesDeleted = process.env.LINES_DELETED || '0';
const outputPath = process.env.OUTPUT_PATH || 'commit-story.png';

const commitShaShort = commitShaFull.substring(0, 7);

console.log(`Commit SHA: ${commitShaFull}`);
console.log(`Commit Message:\n${commitMessageRaw}`);
console.log(`Files Changed: ${filesChanged}`);
console.log(`Lines Added: ${linesAdded}`);
console.log(`Lines Deleted: ${linesDeleted}`);
console.log(`Output Path: ${outputPath}`);

// --- Helper to escape HTML ---
function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return '';
    return unsafe
        .replace(/&/g, "&") // Ampersand first
        .replace(/</g, "<")
        .replace(/>/g, ">")
        .replace(/"/g, "\\\"") // User suggested fix: escaped quote
        .replace(/'/g, "&#039;"); // Keep HTML entity for single quote
}

// --- Process Commit Message for HTML Injection ---
function formatCommitBodyForHtml(bodyRaw) {
    const lines = bodyRaw.split('\n');
    let html = '';
    let inList = false;

    lines.forEach(line => {
        const trimmedLine = line.trim();
        const isListItem = trimmedLine.startsWith('- ');

        if (isListItem) {
            if (!inList) {
                html += '<ul>\n'; // Start list
                inList = true;
            }
            // Extract text after '- ' and escape it
            const itemText = escapeHtml(trimmedLine.substring(2));
            html += `  <li>${itemText}</li>\n`;
        } else {
            if (inList) {
                html += '</ul>\n'; // End list
                inList = false;
            }
            if (trimmedLine === '') {
                // Represent empty lines as paragraphs with non-breaking space for spacing
                html += '<p>&nbsp;</p>\n';
            } else {
                // Wrap non-list lines in paragraphs and escape
                html += `<p>${escapeHtml(trimmedLine)}</p>\n`;
            }
        }
    });

    if (inList) {
        html += '</ul>\n'; // Close list if it's the last element
    }

    return html;
}

const messageLines = commitMessageRaw.trim().split('\n');
const commitSubject = messageLines[0] || '';
const commitBodyRaw = messageLines.slice(1).join('\n'); // Join body lines back for processing
const commitBodyHtml = formatCommitBodyForHtml(commitBodyRaw);


// --- Create Image using Puppeteer ---
async function createImage() {
    let browser = null;
    try {
        console.log('Reading HTML template...');
        let htmlContent = await fs.readFile(config.templatePath, 'utf-8');

        console.log('Injecting data into template...');
        // Replace placeholders
        htmlContent = htmlContent.replace(/{{COMMIT_SUBJECT}}/g, escapeHtml(commitSubject));
        htmlContent = htmlContent.replace(/{{COMMIT_BODY_HTML}}/g, commitBodyHtml); // Inject processed HTML body
        htmlContent = htmlContent.replace(/{{COMMIT_SHA_SHORT}}/g, escapeHtml(commitShaShort));
        htmlContent = htmlContent.replace(/{{FILES_CHANGED}}/g, escapeHtml(filesChanged));
        htmlContent = htmlContent.replace(/{{FILES_CHANGED_PLURAL}}/g, filesChanged === '1' ? '' : 's');
        htmlContent = htmlContent.replace(/{{LINES_ADDED}}/g, escapeHtml(linesAdded));
        htmlContent = htmlContent.replace(/{{LINES_DELETED}}/g, escapeHtml(linesDeleted));

        console.log('Launching Puppeteer...');
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                `--window-size=${config.width},${config.height}`
            ]
        });

        const page = await browser.newPage();

        console.log('Setting viewport...');
        await page.setViewport({
            width: config.width,
            height: config.height,
            deviceScaleFactor: 1,
        });

        console.log('Setting HTML content...');
        const dataUri = `data:text/html;charset=UTF-8,${encodeURIComponent(htmlContent)}`;
        await page.goto(dataUri, { waitUntil: 'networkidle0' });

        // Give Tailwind CDN a little extra time if needed (optional)
        // await new Promise(resolve => setTimeout(resolve, 300));

        console.log('Taking screenshot...');
        await page.screenshot({
            path: outputPath,
            type: 'png',
            fullPage: false,
            clip: {
                x: 0,
                y: 0,
                width: config.width,
                height: config.height,
            }
        });

        console.log(`Image successfully generated: ${outputPath}`);

    } catch (error) {
        console.error('Error generating image with Puppeteer:', error);
        process.exit(1);
    } finally {
        if (browser) {
            console.log('Closing Puppeteer browser...');
            await browser.close();
        }
    }
}

createImage();