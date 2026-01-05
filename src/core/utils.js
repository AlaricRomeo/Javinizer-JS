const fs = require('fs');
const path = require('path');

/**
 * Clean up the temporary directory by removing files older than maxAge
 * 
 * @param {number} maxAgeInHours - Maximum age of files in hours before they are deleted
 */
function cleanupTempDirectory(maxAgeInHours = 24) {
    const tempPath = path.join(process.cwd(), 'data/temp');

    if (!fs.existsSync(tempPath)) {
        return;
    }

    try {
        const files = fs.readdirSync(tempPath);
        const now = Date.now();
        const maxAge = maxAgeInHours * 60 * 60 * 1000;

        files.forEach(file => {
            const filePath = path.join(tempPath, file);

            try {
                const stats = fs.statSync(filePath);

                // Delete file if it's older than specified hours
                if (now - stats.mtimeMs > maxAge) {
                    fs.unlinkSync(filePath);
                    console.log(`[Cleanup] Deleted old temp file: ${file}`);
                }
            } catch (statErr) {
                // Skip files that can't be stat'd (might have been deleted already)
            }
        });
    } catch (err) {
        console.error(`[Cleanup] Error reading temp directory:`, err.message);
    }
}

module.exports = {
    cleanupTempDirectory
};
